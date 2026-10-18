/** Task 1.7：srw_project 审批判定（纯函数）+ 工具四动作 + 技能清单。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodePath from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { approvalDecision, callerFrom, srwProjectToolDef, srwLiteratureToolDef, srwWatchToolDef, srwReadToolDef, searchOutputFor, SRW_TOOL_NAME, SRW_LIT_TOOL_NAME, SRW_WATCH_TOOL_NAME, SRW_READ_TOOL_NAME } from '../src/tools.ts'
import { buildFixturePdf } from './fixture-pdf.ts'
import { resolveCjkFont } from '../src/reading/pdfdoc.ts'
import type { LlmPort } from '../src/reading/translator.ts'
import { stripFrontmatter, registerBundledSkills, type SrwSkillsService } from '../src/skills.ts'
import { SrwService } from '../src/service.ts'
import { WatchManager } from '../src/watch/binding.ts'

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

/** watch fake：注入 WatchManager 依赖（时钟 + 文献都在测试手里）。 */
async function watchHarness(options: { fresh?: number[] } = {}): Promise<{
  manager: WatchManager
  tasks: { id: string; sessionId: string; title: string; prompt: string; everySeconds: number }[]
  runLog: string[]
  root: string
}> {
  const tasks: { id: string; sessionId: string; title: string; prompt: string; everySeconds: number }[] = []
  let seq = 0
  const runLog: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'srw-watch-tool-'))
  const manager = new WatchManager({
    fs: {
      resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel) }),
      contains: (parent: { key: string }, child: { key: string }) => {
        const p = nodePath.resolve(parent.key)
        const c = nodePath.resolve(child.key)
        return c === p || c.startsWith(`${p}/`)
      },
    },
    rootDir: () => root,
    offlineMode: () => false,
    schedule: {
      create: async (sessionId, request) => {
        seq += 1
        const task = { id: `task-${seq}`, sessionId, title: String(request['title'] ?? ''), prompt: String(request['prompt'] ?? ''), everySeconds: typeof request['every_seconds'] === 'number' ? request['every_seconds'] : 0 }
        tasks.push(task)
        return { id: task.id }
      },
      remove: async input => {
        const index = tasks.findIndex(task => task.id === input.id)
        if (index === -1) throw new Error(`no task ${input.id}`)
        tasks.splice(index, 1)
      },
    },
    literature: () => ({
      search: async (source, query) => { runLog.push(`${source}:${query}`); return [{ source, identity: { title: `p-${runLog.length}`, year: 2026 }, authors: ['A'], venue: 'arXiv', abstract: 'x' }] },
      importEntries: async () => ({ added: options.fresh?.[runLog.length - 1] ?? 1, duplicates: 0, retracted: [], enriched: [] }),
    }),
  })
  return { manager, tasks, runLog, root }
}

test('srw_watch 工具：审批矩阵——create/remove 问，run/pause/resume/list 豁免', () => {
  const mounted = true
  for (const action of ['create', 'remove']) {
    const decision = approvalDecision({ name: SRW_WATCH_TOOL_NAME, arguments: { action } }, mounted)
    assert.equal(decision?.kind, 'ask', `${action} 应 ask`)
  }
  for (const action of ['list', 'run', 'pause', 'resume']) {
    const decision = approvalDecision({ name: SRW_WATCH_TOOL_NAME, arguments: { action } }, mounted)
    assert.equal(decision, undefined, `${action} 应豁免（run 授权在建订阅时给过）`)
  }
  assert.equal(approvalDecision({ name: SRW_WATCH_TOOL_NAME, arguments: { action: 'create' } }, false), undefined, '未挂载不问')
})

test('srw_watch 工具：create（绑会话+时钟落任务）→ list → run 幂等 → pause/resume → remove 双删；输出全程无损', async () => {
  const harness = await watchHarness({ fresh: [2, 0] })
  try {
  // 直接构造带 watch 的 service 替身：工具只调 service.watch 与 callerFrom
  const serviceStub = { watch: harness.manager } as unknown as SrwService
  const def = srwWatchToolDef(serviceStub)
  const exec = { agent: { session: { id: 'sess-77', header: { cwd: harness.root } } } }
  const run = (args: Record<string, unknown>) => def.execute(args, exec) as Promise<{ ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string; details: object } }>
  const created = await run({ action: 'create', project: 'review', source: 'openalex', query: 'peer review', everySeconds: 3600 })
  assert.equal(created.ok, true)
  assert.equal(created.value?.scheduled, true)
  assert.equal(typeof created.value?.id, 'string')
  assertLossless(created)
  const id = String(created.value?.id)
  assert.equal(harness.tasks.length, 1)
  assert.equal(harness.tasks[0]?.sessionId, 'sess-77')
  assert.equal(harness.tasks[0]?.everySeconds, 3600)

  const listed = await run({ action: 'list' })
  assert.equal(listed.ok, true)
  assert.equal(listed.value?.count, 1)
  assertLossless(listed)

  const firstRun = await run({ action: 'run', id })
  assert.equal(firstRun.value?.fresh, 2)
  const secondRun = await run({ action: 'run', id })
  assert.equal(secondRun.value?.fresh, 0, '重复 run 幂等')
  assertLossless(secondRun)

  const paused = await run({ action: 'pause', id })
  assert.equal(paused.value?.paused, true)
  assert.equal(harness.tasks.length, 0, '暂停删时钟任务')
  const resumed = await run({ action: 'resume', id })
  assert.equal(resumed.value?.scheduled, true)
  assert.equal(harness.tasks.length, 1, '恢复重建时钟任务')

  const removed = await run({ action: 'remove', id })
  assert.equal(removed.value?.removed, true)
  assert.equal(harness.tasks.length, 0, '删除双删')
  assertLossless(removed)

  const bad = await run({ action: 'run', id: 'sub-nope' })
  assert.equal(bad.ok, false)
  assert.equal(bad.error?.code, 'NOT_FOUND')
  assertLossless(bad)
  } finally {
    await rm(harness.root, { recursive: true, force: true })
  }
})


test('srw_read：全部动作豁免审批（授权来自会话显式意图）', () => {
  for (const action of ['status', 'extract', 'translate', 'notes', 'export']) {
    assert.equal(approvalDecision(exec(SRW_READ_TOOL_NAME, { action }), true), undefined, action)
  }
})

test('srw_read 工具：status 待译清单 → 分批 translate → remaining 归零 → export 归档', { skip: resolveCjkFont() === undefined ? '本机无 CJK 字体（export 归档 PDF 渲染需要）' : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-read-tool-'))
  try {
    const fsLike = {
      resolve: (rel: string, opts?: { cwd?: string }) => ({ key: nodePath.resolve(opts?.cwd ?? process.cwd(), rel) }),
      contains: (parent: { key: string }, child: { key: string }) => {
        const p = nodePath.resolve(parent.key)
        const c = nodePath.resolve(child.key)
        return c === p || c.startsWith(`${p}/`)
      },
    }
    const fakeLlm = {
      stream: async function* (request: Parameters<LlmPort['stream']>[0]) {
        const src = request.messages[0]?.content[0]?.text ?? ''
        const body = src.split('<src>')[1]?.split('</src>')[0] ?? ''
        yield { type: 'text-delta' as const, index: 0, text: `【中译】${body.slice(0, 16)}` }
        yield { type: 'usage' as const, usage: { totalTokens: 20 } }
        yield { type: 'finish' as const, reason: { kind: 'stop' } }
      },
    } satisfies LlmPort
    const service = await SrwService.open({
      fs: fsLike,
      llm: fakeLlm,
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
    }, {})
    await service.setRoot(root)
    const def = srwReadToolDef(service)
    const run = (args: Record<string, unknown>) => def.execute(args, {}) as Promise<{ ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string } }>
    try {
      await mkdir(join(root, 'demo', 'literature', 'pdf'), { recursive: true })
      const pdf = buildFixturePdf([
        // y=726：距页缘 66pt——furniture 带（<62pt）外，否则标题会被当页眉杂讯
        { x: 60, y: 726, text: 'Attention Is All You Need', size: 16 },
        ...Array.from({ length: 8 }, (_u, i) => ({ x: 60, y: 700 - i * 14, text: `Body paragraph line ${i} of the reading tool test.` })),
      ])
      await writeFile(join(root, 'demo', 'literature', 'pdf', 'tool-paper-123.pdf'), pdf)

      const extracted = await run({ action: 'extract', project: 'demo', paperKey: 'tool-paper', pdfPath: 'literature/pdf/tool-paper-123.pdf' })
      assert.equal(extracted.ok, true)
      assert.equal((extracted.value?.blocks as number) >= 2, true)
      assertLossless(extracted)

      const st1 = await run({ action: 'status', project: 'demo', paperKey: 'tool-paper' })
      assert.equal(st1.ok, true)
      const pending1 = st1.value?.pendingIds as string[]
      assert.equal(pending1.length, st1.value?.blocks, '未译时待译=全部块')
      const batch1 = pending1.slice(0, 1)
      const tr1 = await run({ action: 'translate', project: 'demo', paperKey: 'tool-paper', keys: batch1 })
      assert.equal(tr1.ok, true)
      assert.equal(tr1.value?.translated, batch1.length)
      assert.equal((tr1.value?.remaining as number) > 0, true, '分批后仍有剩余')
      assertLossless(tr1)

      const st2 = await run({ action: 'status', project: 'demo', paperKey: 'tool-paper' })
      assert.equal((st2.value?.pendingIds as string[]).length, (st2.value?.blocks as number) - batch1.length, 'status 待译清单扣除已译批')

      const tr2 = await run({ action: 'translate', project: 'demo', paperKey: 'tool-paper' })
      assert.equal(tr2.ok, true)
      assert.equal(tr2.value?.remaining, 0, '剩余全量翻译后归零')

      const notes = await run({ action: 'notes', project: 'demo', paperKey: 'tool-paper' })
      assert.equal(notes.ok, true, 'notes 动作可用（无节时只生成导读）')
      assert.equal(notes.value?.guideReady, true)
      assert.equal(notes.value?.pending, 0)
      assertLossless(notes)

      const archived = await run({ action: 'export', project: 'demo', paperKey: 'tool-paper' })
      assert.equal(archived.ok, true)
      assert.match(String(archived.value?.path), /^demo\/readings\/\d{4}-\d{2}-\d{2}\/tool-paper\.pdf$/)
      assertLossless(archived)

      const bad = await run({ action: 'status', project: 'demo', paperKey: 'no-such' })
      assert.equal(bad.ok, true, 'status 未抽取也返回（extracted=false）')
      assert.equal(bad.value?.extracted, false)

      const unknown = await run({ action: 'nope' })
      assert.equal(unknown.ok, false)
      assert.equal(unknown.error?.code, 'INVALID')
    } finally {
      await service.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})