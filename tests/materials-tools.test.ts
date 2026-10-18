/** M6：srw_materials 工具真实 dispatch + 输出无损 JSON + 审批矩阵（insert
 * ask、其余豁免）+ materials.* 与 paper.compile（ARTIFACT_DRIFT 前门）经
 * handleSrwRpc 直调（照 tests/patent-tools.test.ts 的 withService 模式）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as nodePathResolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { approvalDecision, srwMaterialsToolDef, srwPaperToolDef, SRW_MATERIALS_TOOL_NAME } from '../src/tools.ts'
import { SrwService } from '../src/service.ts'
import { handleSrwRpc } from '../src/rpc.ts'

/** 无损 JSON 断言（照 tests/tools.test.ts）：值树里不允许出现 undefined。 */
function assertLossless(value: unknown, path = '$'): void {
  if (value === undefined) throw new Error('lossless violated: undefined at ' + path)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLossless(item, path + '[' + index + ']'))
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) assertLossless(item, path + '.' + key)
  }
}

const HEX64 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

const METRICS_PAYLOAD = {
  values: { accuracy: { value: 0.912, stderr: 0.004, n: 3, seed: 42 }, f1: { value: 0.887 } },
  series: [{ name: 'loss', points: [[0, 1], [1, 0.5]] }],
}

type ToolResult = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string; details?: unknown } }

async function withService(run: (service: SrwService, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'srw-materials-tool-'))
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
    await mkdir(join(root, 'lab'), { recursive: true })
    await run(service, root)
    await service.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('srw_materials 审批：insert ask（英文 reason + 双语 displayReason）、其余豁免、未挂载不问', () => {
  const ask = approvalDecision({ name: SRW_MATERIALS_TOOL_NAME, arguments: { action: 'insert', project: 'lab', id: 'tab-main', sectionId: 's3' } }, true)
  assert.equal(ask?.kind, 'ask')
  assert.ok(ask.reason.includes('paper'))
  assert.ok(ask.displayReason.zh.includes('插入'))
  assert.ok(ask.displayReason.en.length > 0)
  for (const action of ['list', 'generate', 'verify', 'remove', 'metrics.import', 'numbers', 'numbers.audit']) {
    assert.equal(approvalDecision({ name: SRW_MATERIALS_TOOL_NAME, arguments: { action } }, true), undefined, action + ' 应豁免')
  }
  assert.equal(approvalDecision({ name: SRW_MATERIALS_TOOL_NAME, arguments: { action: 'insert' } }, false), undefined, '未挂载不问')
  assert.equal(approvalDecision({ name: 'other_tool', arguments: { action: 'insert' } }, true), undefined, '陌生工具不问')
})

test('srw_materials 工具全链：metrics.import → generate → verify → list → numbers → audit → remove；输出全程无损', async () => {
  await withService(async (service) => {
    const def = srwMaterialsToolDef(service)
    assert.equal(def.name, 'srw_materials')
    const run = async (args: Record<string, unknown>): Promise<ToolResult> => await def.execute(args, {}) as ToolResult
    // list（空）
    const empty = await run({ action: 'list', project: 'lab' })
    assert.equal(empty.ok, true)
    assert.equal(empty.value?.count, 0)
    assertLossless(empty)
    // metrics.import
    const imported = await run({ action: 'metrics.import', project: 'lab', runId: 'run-01', metrics: METRICS_PAYLOAD })
    assert.equal(imported.ok, true)
    assert.equal((imported.value?.path as string).includes('run-01'), true)
    assert.equal((imported.value?.sha256 as string).length, 64)
    assertLossless(imported)
    // generate（table）
    const generated = await run({
      action: 'generate', project: 'lab', id: 'tab-main', kind: 'table', provenance: 'measured',
      spec: { runId: 'run-01', caption: 'Main results', columns: [{ metric: 'accuracy', header: 'Acc' }, { metric: 'f1' }] },
    })
    assert.equal(generated.ok, true)
    assert.equal(generated.value?.status, 'verified', '生成即复算')
    assert.equal(generated.value?.inputCount, 2)
    assertLossless(generated)
    // generate：示意默认拒绝 → INVALID 信封（无损）
    const refused = await run({ action: 'generate', project: 'lab', id: 'fig-x', kind: 'tikz', provenance: 'illustrative', spec: { code: 'x' } })
    assert.equal(refused.ok, false)
    assert.equal(refused.error?.code, 'INVALID')
    assertLossless(refused)
    // verify
    const verified = await run({ action: 'verify', project: 'lab', id: 'tab-main' })
    assert.equal(verified.ok, true)
    assert.equal(verified.value?.status, 'verified')
    assertLossless(verified)
    // list（1 条，投影形状）
    const listed = await run({ action: 'list', project: 'lab' })
    assert.equal(listed.value?.count, 1)
    const artifact = listed.value?.artifacts as { id: string; status: string; inserted: number }[]
    assert.equal(artifact[0]?.id, 'tab-main')
    assert.equal(artifact[0]?.status, 'verified')
    assertLossless(listed)
    // numbers：宏表 + numbers.json
    const numbers = await run({ action: 'numbers', project: 'lab' })
    assert.equal(numbers.ok, true)
    assert.equal(numbers.value?.macroCount, 2)
    assert.deepEqual(numbers.value?.macros, ['srwaccuracy', 'srwf1'])
    assertLossless(numbers)
    // numbers.audit：无大纲 → 0 条（不给 false 恐慌）
    const audit = await run({ action: 'numbers.audit', project: 'lab' })
    assert.equal(audit.value?.count, 0)
    assert.equal(audit.value?.truncated, false)
    assertLossless(audit)
    // remove：未插入过 → removed 空数组（幂等）
    const removed = await run({ action: 'remove', project: 'lab', id: 'tab-main' })
    assert.equal(removed.ok, true)
    assertLossless(removed)
    // 未知 action → INVALID
    const bad = await run({ action: 'nope', project: 'lab' })
    assert.equal(bad.error?.code, 'INVALID')
    assertLossless(bad)
  })
})

test('RPC：materials.metrics.import/generate/list 直调；paper.compile 触发 ARTIFACT_DRIFT（tools 与 rpc 双门）', async () => {
  await withService(async (service, root) => {
    const signal = new AbortController().signal
    const call = async (endpoint: string, payload: unknown): Promise<ToolResult> =>
      await handleSrwRpc(service, endpoint, payload, signal) as ToolResult
    // metrics.import + generate 经 RPC
    const imported = await call('materials.metrics.import', { project: 'lab', runId: 'r1', metrics: METRICS_PAYLOAD })
    assert.equal(imported.ok, true)
    assertLossless(imported)
    const generated = await call('materials.generate', {
      project: 'lab', id: 'tab-drift', kind: 'table', provenance: 'measured',
      spec: { runId: 'r1', columns: [{ metric: 'accuracy' }] },
    })
    assert.equal(generated.ok, true)
    // RPC 直返 Artifact 全形（status 在 verification 里；工具层才投影成 status）
    assert.equal((generated.value?.verification as { status: string }).status, 'verified')
    assertLossless(generated)
    // materials.list
    const listed = await call('materials.list', { project: 'lab' })
    assert.equal(listed.ok, true)
    assert.equal((listed.value?.artifacts as unknown[]).length, 1)
    assertLossless(listed)
    // 错误信封 details 必须是对象（vendored 客户端校验）
    const badPayload = await call('materials.generate', { project: 'lab', id: 'x', kind: 'table', provenance: 'measured', spec: 'nope' })
    assert.equal(badPayload.error?.code, 'INVALID')
    assert.deepEqual(badPayload.error?.details, {})
    const notFound = await call('materials.verify', { project: 'lab', id: 'ghost' })
    assert.equal(notFound.error?.code, 'NOT_FOUND')
    assert.deepEqual(notFound.error?.details, {})
    // 伪造一条已插入记录 + 手改副本 → compile 前门 ARTIFACT_DRIFT（mismatch 副本让编译失败）
    const manifest = {
      schemaVersion: 1,
      artifacts: [{
        id: 'tab-drift',
        kind: 'table',
        provenance: 'measured',
        path: 'materials/tables/tab-drift.tex',
        spec: { runId: 'r1', columns: [{ metric: 'accuracy' }] },
        generator: { builtin: 'table-v1', specSha256: HEX64('spec') },
        inputs: [],
        output: { sha256: HEX64('old-output'), bytes: 10 },
        verification: { status: 'verified', method: 'recompute', checkedAt: '2026-10-18T00:00:00.000Z', detail: 'fixture' },
        insertedAt: [{ sectionId: 's1', file: 'sections/01-introduction.tex', label: 'tab:tab-drift', target: 'paper/figs/tab-drift.tex', targetSha256: HEX64('original-copy') }],
        illustrative: { allowed: false },
      }],
    }
    await mkdir(join(root, 'lab', 'paper', 'figs'), { recursive: true })
    await writeFile(join(root, 'lab', 'materials', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    // 副本被手改：现哈希 ≠ 记录 targetSha256
    await writeFile(join(root, 'lab', 'paper', 'figs', 'tab-drift.tex'), 'tampered content', 'utf8')
    // RPC paper.compile 先过门 → GATE/ARTIFACT_DRIFT（不进编译）
    const rpcDrift = await call('paper.compile', { project: 'lab' })
    assert.equal(rpcDrift.ok, false)
    assert.equal(rpcDrift.error?.code, 'GATE')
    assert.ok(rpcDrift.error?.message.includes('ARTIFACT_DRIFT'))
    assert.deepEqual(rpcDrift.error?.details, {})
    assertLossless(rpcDrift)
    // tools 侧 srw_paper compile 同一门（tools.ts:compile 分支）
    const paperTool = srwPaperToolDef(service)
    const toolDrift = await paperTool.execute({ action: 'compile', project: 'lab' }, {}) as ToolResult
    assert.equal(toolDrift.ok, false)
    assert.equal(toolDrift.error?.code, 'GATE')
    assert.ok(toolDrift.error?.message.includes('ARTIFACT_DRIFT'))
    assertLossless(toolDrift)
    // 恢复副本为记录哈希 → 门放行（fixture 无 main.tex，编译在自身前置处报 NOT_FOUND——
    // 失败原因不再来自素材门，即证明漂移门已放行）
    await writeFile(join(root, 'lab', 'paper', 'figs', 'tab-drift.tex'), 'original-copy', 'utf8')
    const passed = await call('paper.compile', { project: 'lab' })
    assert.equal(passed.error?.code, 'NOT_FOUND')
    assert.notEqual(passed.error?.code, 'GATE')
  })
})
