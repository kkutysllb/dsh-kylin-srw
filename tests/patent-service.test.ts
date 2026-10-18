/** M9-lite：PatentService 全链（照 writer-service.test.ts 的 fakeFs 模式）：
 * create → disclosure 往返 → eventAdd → publicationCheck；另覆盖护栏
 * fail-closed、CONFLICT/NOT_FOUND/INVALID 与 list 坏文件跳过。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { PatentService } from '../src/patent/service.ts'
import { ServiceError } from '../src/service.ts'

function fakeFs() {
  return {
    resolve: (rel: string, opts?: { cwd?: string }) => ({ key: pathResolve(opts?.cwd ?? process.cwd(), rel) }),
    contains: (parent: { key: string }, child: { key: string }) => {
      const p = pathResolve(parent.key)
      const c = pathResolve(child.key)
      return c === p || c.startsWith(p + '/')
    },
  }
}

async function makeService(): Promise<{ service: PatentService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'srw-patent-'))
  const service = new PatentService({ fs: fakeFs(), rootDir: () => root })
  await mkdir(join(root, 'demo'), { recursive: true })
  return { service, root }
}

const code = (error: unknown): string => (error instanceof ServiceError ? error.code : `non-ServiceError:${String(error)}`)

test('全链：create → disclosure 往返 → eventAdd → publicationCheck', async () => {
  const { service, root } = await makeService()
  try {
    // create：建目录 + patent.json(status idea) + 空 events.jsonl
    const meta = await service.create('demo', { patentId: 'p-2026-001', title: '一种向量加法加速方法', inventors: ['张三'], applicants: ['某大学'] })
    assert.equal(meta.status, 'idea')
    assert.equal(meta.kind, 'invention')
    const base = join(root, 'demo', '.srw', 'patent', 'p-2026-001')
    const stored = JSON.parse(await readFile(join(base, 'patent.json'), 'utf8')) as { status: string }
    assert.equal(stored.status, 'idea')
    assert.equal(await readFile(join(base, 'events.jsonl'), 'utf8'), '', 'events.jsonl 建为空')
    // get/list 往返
    assert.deepEqual(await service.get('demo', 'p-2026-001'), meta)
    assert.equal((await service.list('demo')).length, 1)
    // create 重复 → INVALID（重复建档）；坏 id → INVALID；项目不存在 → NOT_FOUND
    assert.equal(code(await service.create('demo', { patentId: 'p-2026-001', title: 'X' }).then(() => null).catch(error => error)), 'INVALID')
    assert.equal(code(await service.create('demo', { patentId: 'Bad_Id', title: 'X' }).then(() => null).catch(error => error)), 'INVALID')
    assert.equal(code(await service.create('no-such', { patentId: 'p-2', title: 'X' }).then(() => null).catch(error => error)), 'NOT_FOUND')
    // disclosure 往返（整体替换 + 校验）
    assert.equal(await service.disclosureGet('demo', 'p-2026-001'), undefined, '未保存过 → undefined')
    const saved = await service.disclosureSave('demo', 'p-2026-001', {
      technicalField: '向量计算',
      backgroundArt: '现有串行加法带宽受限。',
      problem: '如何在小数据块下打满带宽',
      solution: '按缓存行聚合写回',
      embodiments: ['实施例 1：4096 维 float32……'],
      beneficialEffects: [{ text: '带宽利用率 +30%' }],
      attachments: [],
    })
    assert.equal(saved.beneficialEffects[0]!.evidence, 'TODO', '缺 evidence 归一为 TODO')
    const loaded = await service.disclosureGet('demo', 'p-2026-001')
    assert.deepEqual(loaded, saved)
    const bad = await service.disclosureSave('demo', 'p-2026-001', { technicalField: '只剩一个字段' })
      .then(() => null).catch(error => error)
    assert.equal(code(bad), 'INVALID')
    assert.ok(bad instanceof ServiceError && bad.message.includes('solution'), '错误清单含缺字段名（中文）')
    // publicationCheck（事件登记前）：无 filing + 默认 now → risk（先申请后公开）
    const before = await service.publicationCheck('demo', 'p-2026-001')
    assert.equal(before.check.verdict, 'risk')
    assert.ok(before.check.advice.some(advice => advice.includes('先申请')))
    // eventAdd：合法入一行；非法拒
    const event = await service.eventAdd('demo', 'p-2026-001', {
      kind: 'preprint-published', description: 'arXiv 上传', publicAt: '2026-09-01T00:00:00.000Z', source: 'https://arxiv.org/abs/x',
    })
    assert.equal(event.graceCase, 'none')
    const lines = (await readFile(join(base, 'events.jsonl'), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 1)
    assert.equal((JSON.parse(lines[0]!) as { kind: string }).kind, 'preprint-published')
    assert.equal(code(await service.eventAdd('demo', 'p-2026-001', { kind: 'blog', description: 'x', publicAt: '2026-09-01T00:00:00.000Z' }).then(() => null).catch(error => error)), 'INVALID')
    // publicationCheck（事件在册）：已公开 + 无 filing → blocked（不可逆）
    const blocked = await service.publicationCheck('demo', 'p-2026-001', '2026-10-18T00:00:00.000Z')
    assert.equal(blocked.check.verdict, 'blocked', '事件 publicAt 已过 → 不可逆')
    assert.ok(blocked.check.reasons.some(reason => reason.includes('preprint-published@2026-09-01')))
    // 手工回填 filing（filedAt 在公开后 5 个月，graceCase none）→ risk
    const withFiling = { ...blocked.patent, status: 'filed', filing: { applicationNo: 'CN202610000000.X', filedAt: '2026-10-01T00:00:00.000Z', jurisdiction: 'CN' } }
    await writeFile(join(base, 'patent.json'), JSON.stringify(withFiling, null, 2), 'utf8')
    const risked = await service.publicationCheck('demo', 'p-2026-001', '2026-11-01T00:00:00.000Z')
    assert.equal(risked.check.verdict, 'risk', '申请前 17 天公开且无宽限情形 → 新颖性丧失')
    // 查不存在的专利
    assert.equal(code(await service.get('demo', 'p-404').then(() => null).catch(error => error)), 'NOT_FOUND')
    assert.equal(code(await service.publicationCheck('demo', 'p-404').then(() => null).catch(error => error)), 'NOT_FOUND')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('list：坏目录名/坏 JSON 跳过；空项目返回空数组', async () => {
  const { service, root } = await makeService()
  try {
    await service.create('demo', { patentId: 'good-1', title: '好的' })
    const patentRoot = join(root, 'demo', '.srw', 'patent')
    await mkdir(join(patentRoot, 'Bad_Dir'), { recursive: true })
    await mkdir(join(patentRoot, 'badjson'), { recursive: true })
    await writeFile(join(patentRoot, 'badjson', 'patent.json'), '{oops', 'utf8')
    const listed = await service.list('demo')
    assert.equal(listed.length, 1)
    assert.equal(listed[0]!.patentId, 'good-1')
    const empty = new PatentService({ fs: fakeFs(), rootDir: () => root })
    await mkdir(join(root, 'empty'), { recursive: true })
    assert.deepEqual(await empty.list('empty'), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('护栏：fs 缺席 fail-closed；路径越界/非法 slug 拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-patent-guard-'))
  try {
    await mkdir(join(root, 'demo'), { recursive: true })
    // fs 注入缺席 → PathSafetyError（fail-closed，绝不静默放行）
    const unguarded = new PatentService({ fs: undefined, rootDir: () => root })
    await assert.rejects(
      () => unguarded.create('demo', { patentId: 'p-1', title: 'X' }),
      (error: unknown) => error instanceof Error && error.name === 'PathSafetyError',
    )
    const service = new PatentService({ fs: fakeFs(), rootDir: () => root })
    // project 带路径穿越 → INVALID（SLUG_RE 前置）
    assert.equal(code(await service.create('../escape', { patentId: 'p-1', title: 'X' }).then(() => null).catch(error => error)), 'INVALID')
    assert.equal(code(await service.get('demo', 'a/b').then(() => null).catch(error => error)), 'INVALID')
    // 总根未设置 → NO_PROVIDER（错误码仅 INVALID/NOT_FOUND/NO_PROVIDER）
    const noRoot = new PatentService({ fs: fakeFs(), rootDir: () => undefined })
    assert.equal(code(await noRoot.list('demo').then(() => null).catch(error => error)), 'NO_PROVIDER')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
