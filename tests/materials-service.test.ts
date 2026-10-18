/** M6：MaterialsService 全链证明链（照 patent-service.test.ts 的 fakeFs 模式
 * + 真 WriterService 造 paper）：importMetrics → generate（生成即复算 verified）
 * → 篡改 metrics → verify mismatch → insert GATE → 还原复绿 → insert ok（幂等）
 * → 手改 paper/figs 副本 → checkInsertions GATE（ARTIFACT_DRIFT）→
 * numbersGenerate/numbersAudit → removeInserted；另覆盖 illustrative 默认拒绝、
 * formula/pseudocode 恒 unverifiable、缺源/坏 runId/护栏负例。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { MaterialsService } from '../src/materials/service.ts'
import { ServiceError } from '../src/service.ts'
import { WriterService } from '../src/writer/service.ts'
import { nodeRun } from '../src/writer/run.ts'

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

async function makeHarness(): Promise<{ root: string; materials: MaterialsService; writer: WriterService }> {
  const root = await mkdtemp(join(tmpdir(), 'srw-materials-'))
  await mkdir(join(root, 'demo'), { recursive: true })
  const materials = new MaterialsService({ fs: fakeFs(), rootDir: () => root })
  const writer = new WriterService({ fs: fakeFs(), rootDir: () => root, run: nodeRun })
  return { root, materials, writer }
}

const codeOf = (error: unknown): string => (error instanceof ServiceError ? error.code : 'non-ServiceError:' + String(error))

const METRICS_PAYLOAD = {
  values: {
    accuracy: { value: 0.912, stderr: 0.004, n: 3, seed: 42 },
    f1: { value: 0.887 },
  },
  series: [{ name: 'loss', points: [[0, 1], [1, 0.5], [2, 0.3333]] }],
}
const TABLE_SPEC = { runId: 'run-01', caption: 'Main results', columns: [{ metric: 'accuracy', header: 'Acc' }, { metric: 'f1' }] }
const PLOT_SPEC = { runId: 'run-01', seriesName: 'loss', xLabel: 'Epoch', yLabel: 'Loss' }

test('证明链全链：导入 → 生成(即复算) → 篡改 → mismatch 阻断 → 复绿 → 插入 → 漂移门 → 宏/审计 → 撤销', async () => {
  const { root, materials, writer } = await makeHarness()
  try {
    // 真 WriterService 造 paper：venue → 骨架（大纲草稿 s1..s7 绑定 sections/*.tex）
    await writer.venueApply('demo', 'ieee-journal')
    await writer.scaffold('demo', { title: 'M6 Proof Chain Test' })

    // ① metrics 手工导入：metrics.json + run.json（source manual）
    const imported = await materials.importMetrics('demo', { runId: 'run-01', metrics: METRICS_PAYLOAD })
    assert.equal(imported.path, 'experiments/manual/run-01/metrics.json')
    assert.equal(imported.runId, 'run-01')
    const metricsAbs = join(root, 'demo', 'experiments', 'manual', 'run-01', 'metrics.json')
    const metricsOriginal = await readFile(metricsAbs, 'utf8')
    assert.ok(metricsOriginal.includes('"accuracy"'))
    const runMeta = JSON.parse(await readFile(join(root, 'demo', 'experiments', 'manual', 'run-01', 'run.json'), 'utf8')) as { source: string; runId: string }
    assert.equal(runMeta.source, 'manual')
    assert.equal(runMeta.runId, 'run-01')

    // ② 生成表格：生成即复算 → verified/recompute；inputs 逐列 selector 记 sha256
    const table = await materials.generate('demo', { id: 'tab-main', kind: 'table', provenance: 'measured', spec: TABLE_SPEC })
    assert.equal(table.verification.status, 'verified')
    assert.equal(table.verification.method, 'recompute')
    assert.equal(table.path, 'materials/tables/tab-main.tex')
    assert.deepEqual(table.inputs.map(input => input.selector), ['#accuracy', '#f1'])
    assert.ok(table.inputs.every(input => input.sha256.length === 64))
    assert.equal(await readFile(join(root, 'demo', 'materials', 'tables', 'tab-main.tex'), 'utf8').then(text => text.includes('0.912')), true)
    // 确定性再生成：同 spec + 同 inputs → 同 output 哈希；manifest 幂等（仍 1 条）
    const regenerated = await materials.generate('demo', { id: 'tab-main', kind: 'table', provenance: 'measured', spec: TABLE_SPEC })
    assert.equal(regenerated.output.sha256, table.output.sha256)
    assert.equal((await materials.manifest('demo')).artifacts.length, 1)

    // ③ 生成曲线（plot）也 verified
    const plot = await materials.generate('demo', { id: 'fig-loss', kind: 'plot', provenance: 'measured', spec: PLOT_SPEC })
    assert.equal(plot.verification.status, 'verified')

    // ④ verify 幂等复绿
    const verified = await materials.verify('demo', 'tab-main')
    assert.equal(verified.verification.status, 'verified')

    // ⑤ 篡改 metrics（外部直改文件）→ verify mismatch + manifest 状态同步
    const tampered = JSON.parse(metricsOriginal) as { values: { accuracy: { value: number } } }
    tampered.values.accuracy.value = 0.9
    await writeFile(metricsAbs, JSON.stringify(tampered, null, 2) + '\n', 'utf8')
    const mismatched = await materials.verify('demo', 'tab-main')
    assert.equal(mismatched.verification.status, 'mismatch')
    const manifestAfter = await materials.manifest('demo')
    assert.equal(manifestAfter.artifacts.find(a => a.id === 'tab-main')?.verification.status, 'mismatch')

    // ⑥ G-M1 溯源门：mismatch 状态禁止插入
    const gate = await materials.insert('demo', 'tab-main', 's3').then(() => null).catch((error: unknown) => error)
    assert.equal(codeOf(gate), 'GATE')
    assert.ok(gate instanceof ServiceError && gate.message.includes('G-M1'))

    // ⑦ 还原 metrics → verified → 插入 s3（节末追加 \input{figs/tab-main}）
    await writeFile(metricsAbs, metricsOriginal, 'utf8')
    assert.equal((await materials.verify('demo', 'tab-main')).verification.status, 'verified')
    const inserted = await materials.insert('demo', 'tab-main', 's3')
    assert.equal(inserted.inserted.sectionId, 's3')
    assert.equal(inserted.inserted.file, 'sections/03-method.tex')
    assert.equal(inserted.inserted.label, 'tab:tab-main')
    assert.equal(inserted.inserted.target, 'paper/figs/tab-main.tex')
    assert.equal(inserted.artifact.insertedAt.length, 1)
    const sectionText = await readFile(join(root, 'demo', 'paper', 'sections', '03-method.tex'), 'utf8')
    assert.ok(sectionText.includes('\\input{figs/tab-main}'))
    const copyText = await readFile(join(root, 'demo', 'paper', 'figs', 'tab-main.tex'), 'utf8')
    assert.equal(copyText, await readFile(join(root, 'demo', 'materials', 'tables', 'tab-main.tex'), 'utf8'))
    assert.equal(inserted.inserted.targetSha256.length, 64)

    // ⑧ 幂等再插入：\input 行不重复、insertedAt 不重复
    await materials.insert('demo', 'tab-main', 's3')
    const sectionAgain = await readFile(join(root, 'demo', 'paper', 'sections', '03-method.tex'), 'utf8')
    assert.equal(sectionAgain.split('\\input{figs/tab-main}').length - 1, 1)
    assert.equal((await materials.manifest('demo')).artifacts.find(a => a.id === 'tab-main')?.insertedAt.length, 1)

    // ⑨ 手改插入副本 → verify mismatch + 编译前门 ARTIFACT_DRIFT
    await writeFile(join(root, 'demo', 'paper', 'figs', 'tab-main.tex'), copyText + '\n% 手改', 'utf8')
    const driftedVerify = await materials.verify('demo', 'tab-main')
    assert.equal(driftedVerify.verification.status, 'mismatch', '副本漂移也要能被 verify 发现')
    const drift = await materials.checkInsertions('demo').then(() => null).catch((error: unknown) => error)
    assert.equal(codeOf(drift), 'GATE')
    assert.ok(drift instanceof ServiceError && drift.message.includes('ARTIFACT_DRIFT'))
    // 恢复副本（以产物为准重写）→ 复绿
    await writeFile(join(root, 'demo', 'paper', 'figs', 'tab-main.tex'), copyText, 'utf8')
    assert.equal((await materials.verify('demo', 'tab-main')).verification.status, 'verified')
    assert.equal((await materials.checkInsertions('demo')).checked, 1)

    // ⑩ 手改 materials 产物本体 → mismatch；恢复后复绿
    const artifactAbs = join(root, 'demo', 'materials', 'tables', 'tab-main.tex')
    await writeFile(artifactAbs, copyText + '\n% 手改产物', 'utf8')
    assert.equal((await materials.verify('demo', 'tab-main')).verification.status, 'mismatch')
    await writeFile(artifactAbs, copyText, 'utf8')
    assert.equal((await materials.verify('demo', 'tab-main')).verification.status, 'verified')

    // ⑪ 数字宏 + 裸数字审计（G1 确认后写一节带裸数字的正文）
    await writer.outlineConfirm('demo')
    await writer.sectionWrite('demo', 's5', 'Accuracy reaches 0.912 on the benchmark.\n% 注释里的 0.999 不算未溯源\nMacro-only line with srwaccuracy placeholder.')
    const numbers = await materials.numbersGenerate('demo')
    assert.equal(numbers.texPath, 'paper/generated/srw-numbers.tex')
    const accuracy = numbers.macros.find(macro => macro.metric === 'accuracy')
    assert.ok(accuracy !== undefined && accuracy.name === 'srwaccuracy' && accuracy.value === 0.912)
    assert.ok(accuracy.path.includes('run-01'))
    const tex = await readFile(join(root, 'demo', 'paper', 'generated', 'srw-numbers.tex'), 'utf8')
    assert.ok(tex.includes('% 由 srw 生成勿手改'))
    assert.ok(tex.includes('\\newcommand{\\srwaccuracy}{0.912}'))
    assert.ok(tex.includes('\\newcommand{\\srwf1}{0.887}'))
    assert.ok((await readFile(join(root, 'demo', 'paper', 'generated', 'numbers.json'), 'utf8')).includes('"srwaccuracy"'))
    const audit = await materials.numbersAudit('demo')
    assert.equal(audit.count, 1, '只算裸数字：注释行与 newcommand 行不算')
    assert.equal(audit.truncated, false)
    assert.equal(audit.findings[0]?.file, 'sections/05-results.tex')
    assert.equal(audit.findings[0]?.line, 1)
    assert.ok(audit.findings[0]?.text.includes('0.912'))

    // ⑫ 撤销插入：删副本 + 清节内 \input + 清 insertedAt
    const removed = await materials.removeInserted('demo', 'tab-main')
    assert.ok(removed.removed.includes('paper/figs/tab-main.tex'))
    assert.ok(removed.removed.includes('paper/sections/03-method.tex'))
    await readFile(join(root, 'demo', 'paper', 'figs', 'tab-main.tex'), 'utf8').then(
      () => assert.fail('副本应已删除'),
      () => { /* ENOENT 符合预期 */ },
    )
    const sectionCleaned = await readFile(join(root, 'demo', 'paper', 'sections', '03-method.tex'), 'utf8')
    assert.ok(!sectionCleaned.includes('\\input{figs/tab-main}'))
    assert.deepEqual((await materials.manifest('demo')).artifacts.find(a => a.id === 'tab-main')?.insertedAt, [])
    assert.equal((await materials.checkInsertions('demo')).checked, 0, 'insertedAt 清空后门零开销')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('状态语义：illustrative 默认拒绝/显式放行；formula/pseudocode 恒 unverifiable/structural', async () => {
  const { root, materials } = await makeHarness()
  try {
    await materials.importMetrics('demo', { runId: 'r1', metrics: METRICS_PAYLOAD })
    // 示意默认拒绝（红线）
    const refused = await materials.generate('demo', { id: 'fig-arch', kind: 'tikz', provenance: 'illustrative', spec: { code: '\\draw (0,0) -- (1,1);' } }).then(() => null).catch((error: unknown) => error)
    assert.equal(codeOf(refused), 'INVALID')
    // 显式放行 → illustrative 且 verify 保持（不复算）
    const illustrative = await materials.generate('demo', { id: 'fig-arch', kind: 'tikz', provenance: 'illustrative', spec: { code: '\\draw (0,0) -- (1,1);', caption: '示意架构' }, allowIllustrative: true })
    assert.equal(illustrative.verification.status, 'illustrative')
    assert.equal(illustrative.illustrative.allowed, true)
    assert.equal((await materials.verify('demo', 'fig-arch')).verification.status, 'illustrative')
    // formula：MVP 无 sympy → 恒 unverifiable/structural（G-M2 诚实形态）
    const formula = await materials.generate('demo', { id: 'eq-loss', kind: 'formula', provenance: 'derived', spec: { latex: 'L = \\frac{1}{n} \\sum_i \\ell_i' } })
    assert.equal(formula.verification.status, 'unverifiable')
    assert.equal(formula.verification.method, 'structural')
    assert.equal((await materials.verify('demo', 'eq-loss')).verification.method, 'structural')
    // pseudocode：结构验证
    const pseudo = await materials.generate('demo', { id: 'alg-x', kind: 'pseudocode', provenance: 'derived', spec: { steps: ['FOR x in xs', 'RETURN x'] } })
    assert.equal(pseudo.verification.status, 'unverifiable')
    assert.equal((await materials.verify('demo', 'alg-x')).verification.status, 'unverifiable')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('负例：坏 runId/坏 payload/缺 metrics 文件/坏 JSON/未知 id/无 manifest 门零开销/护栏 fail-closed', async () => {
  const { root, materials } = await makeHarness()
  try {
    // runId 形状
    for (const bad of ['../escape', 'has space', '']) {
      const bad1 = await materials.importMetrics('demo', { runId: bad, metrics: METRICS_PAYLOAD }).then(() => null).catch((error: unknown) => error)
      assert.equal(codeOf(bad1), 'INVALID')
    }
    // payload 形状：values 缺失 / 全空
    assert.equal(codeOf(await materials.importMetrics('demo', { runId: 'r1', metrics: {} }).then(() => null).catch((error: unknown) => error)), 'INVALID')
    assert.equal(codeOf(await materials.importMetrics('demo', { runId: 'r1', metrics: { values: {} } }).then(() => null).catch((error: unknown) => error)), 'INVALID')
    // generate：metrics 文件缺失（无 metrics 不生成）→ INVALID
    const noMetrics = await materials.generate('demo', { id: 'tab-x', kind: 'table', provenance: 'measured', spec: { runId: 'no-such', columns: [{ metric: 'accuracy' }] } }).then(() => null).catch((error: unknown) => error)
    assert.equal(codeOf(noMetrics), 'INVALID')
    assert.ok(noMetrics instanceof ServiceError && noMetrics.message.includes('metrics.import'))
    // metrics 文件坏 JSON → INVALID（论文数字不允许静默丢源）
    await materials.importMetrics('demo', { runId: 'r2', metrics: METRICS_PAYLOAD })
    await writeFile(join(root, 'demo', 'experiments', 'manual', 'r2', 'metrics.json'), '{oops', 'utf8')
    assert.equal(codeOf(await materials.generate('demo', { id: 'tab-y', kind: 'table', provenance: 'measured', spec: { runId: 'r2', columns: [{ metric: 'accuracy' }] } }).then(() => null).catch((error: unknown) => error)), 'INVALID')
    // 未知 id → NOT_FOUND
    assert.equal(codeOf(await materials.verify('demo', 'no-such').then(() => null).catch((error: unknown) => error)), 'NOT_FOUND')
    assert.equal(codeOf(await materials.insert('demo', 'no-such', 's1').then(() => null).catch((error: unknown) => error)), 'NOT_FOUND')
    assert.equal(codeOf(await materials.removeInserted('demo', 'no-such').then(() => null).catch((error: unknown) => error)), 'NOT_FOUND')
    // 无 manifest 的项目：编译前门零开销放行
    await mkdir(join(root, 'empty'), { recursive: true })
    assert.deepEqual(await materials.checkInsertions('empty'), { ok: true, checked: 0 })
    // 大纲缺失：insert 对已验证素材报 NOT_FOUND（先骨架）
    await materials.importMetrics('demo', { runId: 'r3', metrics: METRICS_PAYLOAD })
    const tab = await materials.generate('demo', { id: 'tab-z', kind: 'table', provenance: 'measured', spec: { runId: 'r3', columns: [{ metric: 'accuracy' }] } })
    assert.equal(tab.verification.status, 'verified')
    assert.equal(codeOf(await materials.insert('demo', 'tab-z', 's1').then(() => null).catch((error: unknown) => error)), 'NOT_FOUND')
    // 护栏：fs 缺席 fail-closed；总根未设置 NO_PROVIDER
    const unguarded = new MaterialsService({ fs: undefined, rootDir: () => root })
    await assert.rejects(() => unguarded.manifest('demo'), (error: unknown) => error instanceof Error && error.name === 'PathSafetyError')
    const noRoot = new MaterialsService({ fs: fakeFs(), rootDir: () => undefined })
    assert.equal(codeOf(await noRoot.manifest('demo').then(() => null).catch((error: unknown) => error)), 'NO_PROVIDER')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
