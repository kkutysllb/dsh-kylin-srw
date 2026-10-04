/** Task 1.7：srw_project 审批判定（纯函数）+ 工具四动作 + 技能清单。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodePath from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { approvalDecision, callerFrom, srwProjectToolDef, srwLiteratureToolDef, searchOutputFor, SRW_TOOL_NAME, SRW_LIT_TOOL_NAME } from '../src/tools.ts'
import { stripFrontmatter, registerBundledSkills, type SrwSkillsService } from '../src/skills.ts'
import { SrwService } from '../src/service.ts'

const exec = (name: string, args?: unknown) => ({ name, arguments: args, signal: new AbortController().signal })

test('approval：create/remove 问、list/open 豁免、未挂载与陌生工具不问', () => {
  const askCreate = approvalDecision(exec(SRW_TOOL_NAME, { action: 'create', slug: 'a', title: 'T' }), true)
  assert.equal(askCreate?.kind, 'ask')
  assert.ok(askCreate.reason.length > 0)
  assert.ok(askCreate.displayReason.zh.includes('创建'))
  assert.equal(approvalDecision(exec(SRW_TOOL_NAME, { action: 'remove', slug: 'a' }), true)?.kind, 'ask')
  assert.equal(approvalDecision(exec(SRW_TOOL_NAME, { action: 'list' }), true), undefined)
  assert.equal(approvalDecision(exec(SRW_TOOL_NAME, { action: 'open', slug: 'a' }), true), undefined)
  // 未挂载（非根 Agent）一律不问——工具根本不可达
  assert.equal(approvalDecision(exec(SRW_TOOL_NAME, { action: 'remove' }), false), undefined)
  // 陌生工具不问
  assert.equal(approvalDecision(exec('other_tool', { action: 'remove' }), true), undefined)
  // action 缺失不问（工具自身报 INVALID）
  assert.equal(approvalDecision(exec(SRW_TOOL_NAME, {}), true), undefined)
})

test('callerFrom：从 exec.agent.session 提取 id/cwd', () => {
  assert.deepEqual(callerFrom({ agent: { session: { id: 's1', header: { cwd: '/w' } } } }), { sessionId: 's1', cwd: '/w' })
  assert.deepEqual(callerFrom({}), { sessionId: undefined, cwd: undefined })
})

async function withService(run: (service: SrwService, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'srw-tools-'))
  try {
    const fsLike = {
      resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel) }),
      contains: (parent: { key: string }, child: { key: string }) => {
        const p = nodePath.resolve(parent.key)
        const c = nodePath.resolve(child.key)
        return c === p || c.startsWith(`${p}/`)
      },
    }
    const service = await SrwService.open({ fs: fsLike }, {})
    await service.setRoot(root)
    await run(service, root)
    await service.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('srw_project 工具：list/create/open/remove 与错误信封', async () => {
  await withService(async (service) => {
    const def = srwProjectToolDef(service)
    assert.equal(def.name, 'srw_project')
    const run = async (args: unknown) => await def.execute(args, { agent: { session: { id: 's1', header: { cwd: '/w' } } } })
    // list 空
    const empty = await run({ action: 'list' }) as { ok: boolean; value: { count: number } }
    assert.equal(empty.ok, true)
    assert.equal(empty.value.count, 0)
    // create → list 1 → open → remove
    const created = await run({ action: 'create', slug: 'tool-proj', title: '工具项目', field: 'nlp' }) as { ok: boolean; value: { created: string } }
    assert.equal(created.ok, true)
    assert.match(created.value.created, /tool-proj/)
    const listed = await run({ action: 'list' }) as { ok: true; value: { count: number; projects: string[] } }
    assert.equal(listed.value.count, 1)
    const opened = await run({ action: 'open', slug: 'tool-proj' }) as { ok: true; value: { opened: string } }
    assert.match(opened.value.opened, /stage=idea/)
    assert.equal(service.indexGlobal().activeProject, 'tool-proj')
    const removed = await run({ action: 'remove', slug: 'tool-proj' }) as { ok: true; value: { removed: string } }
    assert.equal(removed.value.removed, 'tool-proj')
    // 错误信封：坏 action / 缺 slug / 重复 create
    assert.equal(((await run({ action: 'bogus' })) as { ok: false; error: { code: string } }).error.code, 'INVALID')
    assert.equal(((await run({ action: 'create', slug: 'x' })) as { ok: false; error: { code: string } }).error.code, 'INVALID')
    await run({ action: 'create', slug: 'dup', title: 'D' })
    assert.equal(((await run({ action: 'create', slug: 'dup', title: 'D' })) as { ok: false; error: { code: string } }).error.code, 'CONFLICT')
    // output.render 走 text
    const rendered = def.output.render({}, { a: 1 })
    assert.deepEqual(rendered, [{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }])
  })
})

test('技能：清单与 SKILL.md 存在、frontmatter 可剥、注册器逐个调用', () => {
  const root = new URL('..', import.meta.url).pathname
  const manifest = JSON.parse(readFileSync(join(root, 'skills', 'manifest.json'), 'utf8')) as { skills: { name: string; dir: string }[] }
  assert.ok(manifest.skills.length >= 1)
  for (const item of manifest.skills) {
    assert.ok(existsSync(join(root, 'skills', item.dir, 'SKILL.md')), item.dir)
  }
  const raw = readFileSync(join(root, 'skills', 'manifest.json', '..', manifest.skills[0]!.dir, 'SKILL.md'), 'utf8')
  assert.ok(raw.startsWith('---'))
  const body = stripFrontmatter(raw)
  assert.ok(!body.startsWith('---'))
  assert.ok(body.includes('选题卡'))
  // 注册器：fake skills 服务收到 name/description/content/resourceBase
  const registered: string[] = []
  const fake: SrwSkillsService = {
    register: (entry) => {
      registered.push(entry.name)
      assert.equal(entry.source, 'runtime')
      assert.ok(entry.description.length > 0)
      assert.ok(entry.content.length > 0)
      assert.equal(entry.resourceBase?.kind, 'directory')
      return () => {}
    },
  }
  const dispose = registerBundledSkills(fake, root)
  assert.deepEqual(registered, manifest.skills.map(item => item.name))
  dispose()
})

/** 无损 JSON 断言：值树里不允许出现 undefined（宿主工具结果校验 lossless
 * 往返——显式 `key: undefined` 会被 JSON.stringify 丢键而破坏往返）。 */
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

test('tools：输出无损 JSON——arXiv 型候选（无 oaUrl）不再炸 lossless（回归门）', () => {
  // 2026-10-04 桌面端实测：显式 key: undefined 使宿主报 value is not lossless JSON，
  // arXiv 源从不设 oaUrl → search 100% 失败。修复后投影不得含 undefined 值。
  const sparse = {
    source: 'arxiv' as const,
    identity: { arxivId: '2401.00001v2', title: 'Sparse Survey', year: 2024 },
    authors: ['A'],
    venue: 'arXiv',
    abstract: 'abs',
    // pdfUrl/oaUrl 均缺省（源没给）
  }
  const out = searchOutputFor([sparse, { ...sparse, pdfUrl: 'https://arxiv.org/pdf/x' }])
  assertLossless(out)
  const first = out.items[0] as Record<string, unknown>
  const second = out.items[1] as Record<string, unknown>
  assert.equal('pdfUrl' in first, false)
  assert.equal('oaUrl' in first, false)
  assert.equal(second.pdfUrl, 'https://arxiv.org/pdf/x')
  // 往返等价（JSON 无损的最终判据）
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out)
  // 深层 identity 也过门（含可选 doi/arxivId 缺省形态）
  assertLossless({ identity: sparse.identity })
})

test('tools：全动作输出无损——离线 fake 下 search 报 OFFLINE、lib/import/bibtex 输出过门', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'srw-lossless-'))
  try {
    const nodePath = await import('node:path')
    const fsLike = {
      resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel) }),
      contains: (parent: { key: string }, child: { key: string }) => {
        const p = nodePath.resolve(parent.key)
        const c = nodePath.resolve(child.key)
        return c === p || c.startsWith(`${p}/`)
      },
    }
    const service = await SrwService.open({ fs: fsLike }, { offlineMode: true })
    await service.setRoot(root)
    const projectDef = srwProjectToolDef(service)
    const litDef = srwLiteratureToolDef(service)
    const run = (def: { execute: (args: unknown, exec: unknown) => Promise<unknown> }, args: unknown) =>
      def.execute(args, { agent: { session: { id: 's1', header: { cwd: root } } } })
    // 建项目 → 入库（本地写，offline 跳过撤稿核查）→ lib → bibtex，全部输出过无损门
    const created = await run(projectDef, { action: 'create', slug: 'lossless', title: '无损' })
    assertLossless(created)
    const imported = await run(litDef, {
      action: 'import', project: 'lossless',
      items: [{ source: 'arxiv', identity: { arxivId: '2401.00001v2', title: 'Sparse Survey', year: 2024 }, authors: ['A'], venue: 'arXiv', abstract: 'abs' }],
    })
    assertLossless(imported)
    const lib = await run(litDef, { action: 'lib', project: 'lossless' })
    assertLossless(lib)
    const bib = await run(litDef, { action: 'bibtex', project: 'lossless' })
    assertLossless(bib)
    // offline search 明确 OFFLINE（不炸 lossless）
    const search = await run(litDef, { action: 'search', source: 'arxiv', query: 'x' }) as { ok: boolean; error?: { code: string; message: string; details: object } }
    assert.equal(search.ok, false)
    assert.equal(search.error?.code, 'OFFLINE')
    assertLossless(search)
    await service.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
