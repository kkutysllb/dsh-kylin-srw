/** M9-lite：srw_patent 工具真实 dispatch + 输出无损 JSON + patent.state 经
 * handleSrwRpc 直调（照 tests/tools.test.ts 的 withService / assertLossless
 * 模式）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve as nodePathResolve } from 'node:path'
import { approvalDecision, srwPatentToolDef, SRW_PATENT_TOOL_NAME } from '../src/tools.ts'
import { SrwService } from '../src/service.ts'
import { handleSrwRpc } from '../src/rpc.ts'

/** 无损 JSON 断言（照 tests/tools.test.ts）：值树里不允许出现 undefined。 */
function assertLossless(value: unknown, path = '$'): void {
  if (value === undefined) throw new Error(`lossless violated: undefined at ${path}`)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLossless(item, `${path}[${index}]`))
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) assertLossless(item, `${path}.${key}`)
  }
}

async function withService(run: (service: SrwService, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'srw-patent-tool-'))
  try {
    const fsLike = {
      resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePathResolve(opts?.cwd ?? process.cwd(), rel) }),
      contains: (parent: { key: string }, child: { key: string }) => {
        const p = nodePathResolve(parent.key)
        const c = nodePathResolve(child.key)
        return c === p || c.startsWith(p + '/')
      },
    }
    const service = await SrwService.open({ fs: fsLike }, {})
    await service.setRoot(root)
    await mkdirProject(root)
    await run(service, root)
    await service.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function mkdirProject(root: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(root, 'lab'), { recursive: true })
}

type ToolResult = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string } }

test('srw_patent 审批：create ask（双语）、其余动作豁免、未挂载不问', () => {
  const create = approvalDecision({ name: SRW_PATENT_TOOL_NAME, arguments: { action: 'create', project: 'lab', patentId: 'p-1', title: 'T' } }, true)
  assert.equal(create?.kind, 'ask')
  assert.ok(create.reason.includes('patent'))
  assert.ok(create.displayReason.zh.includes('专利档案'))
  for (const action of ['state', 'disclosure.get', 'disclosure.save', 'event.add', 'publication.check']) {
    assert.equal(approvalDecision({ name: SRW_PATENT_TOOL_NAME, arguments: { action } }, true), undefined, action)
  }
  assert.equal(approvalDecision({ name: SRW_PATENT_TOOL_NAME, arguments: { action: 'create' } }, false), undefined)
  // 陌生工具不问
  assert.equal(approvalDecision({ name: 'other', arguments: { action: 'create' } }, true), undefined)
})

test('srw_patent 工具全链：state → create → disclosure 往返 → event.add → publication.check；输出全程无损', async () => {
  await withService(async (service) => {
    const def = srwPatentToolDef(service)
    assert.equal(def.name, 'srw_patent')
    const run = async (args: Record<string, unknown>): Promise<ToolResult> => await def.execute(args, {}) as ToolResult
    // state（空）
    const empty = await run({ action: 'state', project: 'lab' })
    assert.equal(empty.ok, true)
    assert.equal(empty.value?.count, 0)
    assertLossless(empty)
    // state 单档案（未建 → 错误信封）
    const missing = await run({ action: 'state', project: 'lab', patentId: 'p-1' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error?.code, 'NOT_FOUND')
    assertLossless(missing)
    // create
    const created = await run({ action: 'create', project: 'lab', patentId: 'p-1', title: '一种测试方法', inventors: ['张三'] })
    assert.equal(created.ok, true)
    assert.ok(String(created.value?.created).includes('status=idea'))
    assertLossless(created)
    // state 单档案（hasDisclosure=false）
    const state1 = await run({ action: 'state', project: 'lab', patentId: 'p-1' })
    assert.equal(state1.ok, true)
    assert.equal(state1.value?.hasDisclosure, false)
    assertLossless(state1)
    // disclosure.get（none）
    const none = await run({ action: 'disclosure.get', project: 'lab', patentId: 'p-1' })
    assert.equal(none.value?.status, 'none')
    assertLossless(none)
    // disclosure.save → get 往返
    const saved = await run({
      action: 'disclosure.save', project: 'lab', patentId: 'p-1',
      disclosure: {
        technicalField: '向量计算', backgroundArt: '现有方案慢。', problem: '如何提速',
        solution: '分块并行', embodiments: ['实施例 1'], beneficialEffects: [{ text: '2x' }],
      },
    })
    assert.equal(saved.ok, true)
    assertLossless(saved)
    const got = await run({ action: 'disclosure.get', project: 'lab', patentId: 'p-1' })
    assert.equal(got.value?.status, 'saved')
    const disclosure = got.value?.disclosure as { technicalField: string; beneficialEffects: { evidence: string }[] }
    assert.equal(disclosure.technicalField, '向量计算')
    assert.equal(disclosure.beneficialEffects[0]?.evidence, 'TODO')
    assertLossless(got)
    // disclosure.save 校验失败 → INVALID
    const badSave = await run({ action: 'disclosure.save', project: 'lab', patentId: 'p-1', disclosure: { technicalField: '' } })
    assert.equal(badSave.ok, false)
    assert.equal(badSave.error?.code, 'INVALID')
    assertLossless(badSave)
    // event.add
    const added = await run({
      action: 'event.add', project: 'lab', patentId: 'p-1',
      event: { kind: 'paper-submitted', description: '投了会议', publicAt: '2026-09-15T00:00:00.000Z' },
    })
    assert.equal(added.ok, true)
    const addedEvent = added.value?.event as { graceCase: string; source?: string }
    assert.equal(addedEvent.graceCase, 'none')
    assert.equal('source' in addedEvent, false, '可选 source 缺省不得带 undefined 键')
    assertLossless(added)
    // publication.check（已公开 + 无 filing → blocked）
    const checked = await run({ action: 'publication.check', project: 'lab', patentId: 'p-1', publicationAt: '2026-10-18T00:00:00.000Z' })
    assert.equal(checked.ok, true)
    const check = checked.value?.check as { verdict: string; reasons: string[]; advice: string[] }
    assert.equal(check.verdict, 'blocked')
    assert.ok(check.reasons.length >= 1 && check.advice.length >= 1)
    assertLossless(checked)
    // 坏 action / 缺参
    assert.equal(((await run({ action: 'nope' })) as ToolResult).error?.code, 'INVALID')
    assert.equal(((await run({ action: 'create', project: 'lab', patentId: 'p-2' })) as ToolResult).error?.code, 'INVALID')
  })
})

test('patent.* 经 handleSrwRpc 直调：state/create/disclosure/check + 错误信封 details:空对象', async () => {
  await withService(async (service) => {
    const signal = new AbortController().signal
    const call = async (endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string; details: unknown } }> =>
      await handleSrwRpc(service, endpoint, payload, signal) as { ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string; details: unknown } }
    // state 空
    const empty = await call('patent.state', { project: 'lab' })
    assert.equal(empty.ok, true)
    assert.equal((empty.value?.patents as unknown[]).length, 0)
    assertLossless(empty)
    // create
    const created = await call('patent.create', { project: 'lab', patentId: 'p-rpc', title: '一种RPC方法', inventors: ['李四'], applicants: [] })
    assert.equal(created.ok, true)
    const meta = created.value as { patentId: string; status: string }
    assert.equal(meta.patentId, 'p-rpc')
    assert.equal(meta.status, 'idea')
    assertLossless(created)
    // state 单档案
    const one = await call('patent.state', { project: 'lab', patentId: 'p-rpc' })
    assert.equal(one.value?.hasDisclosure, false)
    assertLossless(one)
    // disclosure save/get
    const saved = await call('patent.disclosure.save', {
      project: 'lab', patentId: 'p-rpc',
      disclosure: { technicalField: 'f', backgroundArt: 'b', problem: 'p', solution: 's', embodiments: ['e1'], beneficialEffects: [], attachments: [] },
    })
    assert.equal(saved.ok, true)
    const got = await call('patent.disclosure.get', { project: 'lab', patentId: 'p-rpc' })
    assert.equal((got.value as { technicalField: string }).technicalField, 'f')
    assertLossless(got)
    // event.add + publication.check
    await call('patent.event.add', { project: 'lab', patentId: 'p-rpc', event: { kind: 'thesis', description: '答辩', publicAt: '2026-05-01T00:00:00.000Z' } })
    const check = await call('patent.publication.check', { project: 'lab', patentId: 'p-rpc', publicationAt: '2026-06-01T00:00:00.000Z' })
    assert.equal((check.value?.check as { verdict: string }).verdict, 'blocked')
    assertLossless(check)
    // 错误信封：缺 project / 非法 payload / NOT_FOUND —— details 必须是对象
    const noProject = await call('patent.state', {})
    assert.equal(noProject.ok, false)
    assert.equal(noProject.error?.code, 'INVALID')
    assert.deepEqual(noProject.error?.details, {})
    const badDisclosure = await call('patent.disclosure.save', { project: 'lab', patentId: 'p-rpc', disclosure: 'not-an-object' })
    assert.equal(badDisclosure.error?.code, 'INVALID')
    assert.deepEqual(badDisclosure.error?.details, {})
    const notFound = await call('patent.publication.check', { project: 'lab', patentId: 'p-404' })
    assert.equal(notFound.error?.code, 'NOT_FOUND')
    assert.deepEqual(notFound.error?.details, {})
  })
})
