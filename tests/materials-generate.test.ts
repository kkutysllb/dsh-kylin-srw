/** M6：五类渲染器确定性（同输入两次输出全等）+ label 正确 + 缺数据
 * INVALID + 数值格式化。全部纯函数断言，无 IO。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ServiceError } from '../src/service.ts'
import {
  renderArtifact, renderFormula, renderPlot, renderPseudocode, renderTable, renderTikz,
} from '../src/materials/generate.ts'
import { formatNumber } from '../src/materials/metrics.ts'
import type { MetricsFile } from '../src/materials/types.ts'

const code = (error: unknown): string => (error instanceof ServiceError ? error.code : 'non-ServiceError:' + String(error))

const metrics: MetricsFile = {
  schemaVersion: 1,
  runId: 'run-01',
  values: {
    accuracy: { value: 0.912, stderr: 0.004 },
    f1: { value: 2 / 3 },
  },
  series: [{ name: 'loss', xLabel: 'Epoch', points: [[0, 1], [1, 0.5], [2, 0.3333]] }],
}

test('renderTable：booktabs 结构 + tab label + 缺指标 INVALID + 确定性', () => {
  const spec = { runId: 'run-01', caption: 'Main results', columns: [{ metric: 'accuracy', header: 'Acc' }, { metric: 'f1' }] }
  const tex = renderTable('tab-main', spec, metrics)
  // 确定性：同 id + 同 spec + 同 metrics 两次输出字节级相同
  assert.equal(renderTable('tab-main', spec, metrics), tex)
  // 不含时间戳/绝对路径
  assert.ok(!tex.includes('2026') && !tex.includes('/Users/'))
  // booktabs 与 label（tab:<id>）
  for (const marker of ['\\begin{table}[t]', '\\toprule', '\\midrule', '\\bottomrule', '\\label{tab:tab-main}', '\\caption{Main results}']) {
    assert.ok(tex.includes(marker), marker)
  }
  // 数值 toPrecision(4) 去尾零：0.912 与 0.6667（2/3）
  assert.ok(tex.includes('0.912'))
  assert.ok(tex.includes('0.6667'))
  // 表头：自定义 header + 缺省用指标名；列对齐 lr（首列左对齐、数值列右对齐）
  assert.ok(tex.includes('Acc & f1 \\'))
  assert.ok(tex.includes('\\begin{tabular}{lr}'))
  // 缺指标 → INVALID 并列出缺哪些（不生成占位数据）
  const missing = (() => { try { renderTable('tab-main', { runId: 'run-01', columns: [{ metric: 'accuracy' }, { metric: 'auc' }] }, metrics); return null } catch (error) { return error } })()
  assert.equal(code(missing), 'INVALID')
  assert.ok(missing instanceof ServiceError && missing.message.includes('auc'))
})

test('renderPlot：pgfplots 坐标 + fig label + 缺 series INVALID + 确定性', () => {
  const spec = { runId: 'run-01', seriesName: 'loss', caption: 'Training loss', xLabel: 'Epoch', yLabel: 'Loss' }
  const tex = renderPlot('fig-loss', spec, metrics)
  assert.equal(renderPlot('fig-loss', spec, metrics), tex)
  for (const marker of ['\\begin{figure}[t]', '\\begin{tikzpicture}', '\\begin{axis}[', 'xlabel={Epoch}', 'ylabel={Loss}', '\\addplot coordinates {(0, 1) (1, 0.5) (2, 0.3333)};', '\\label{fig:fig-loss}']) {
    assert.ok(tex.includes(marker), marker)
  }
  // 缺 series → INVALID 列出现有名
  const missing = (() => { try { renderPlot('fig-loss', { runId: 'run-01', seriesName: 'acc-curve' }, metrics); return null } catch (error) { return error } })()
  assert.equal(code(missing), 'INVALID')
  assert.ok(missing instanceof ServiceError && missing.message.includes('acc-curve') && missing.message.includes('loss'))
})

test('renderPseudocode：algorithmic 行前缀（FOR/RETURN → 指令，其余 STATE）+ alg label', () => {
  const spec = { caption: 'Training loop', steps: ['FOR batch in loader', 'loss = step(batch)', 'RETURN loss'] }
  const tex = renderPseudocode('alg-train', spec)
  assert.equal(renderPseudocode('alg-train', spec), tex)
  for (const marker of ['\\begin{algorithm}', '\\caption{Training loop}', '\\label{alg:alg-train}', '\\begin{algorithmic}[1]', '\\FOR{batch in loader}', '\\STATE loss = step(batch)', '\\RETURN loss']) {
    assert.ok(tex.includes(marker), marker)
  }
})

test('renderFormula / renderTikz：equation/figure 原样嵌入 + eq/fig label', () => {
  const formula = renderFormula('eq-loss', { latex: 'L = \\frac{1}{n}\\sum_i \\ell(y_i, \\hat y_i)' })
  assert.equal(renderFormula('eq-loss', { latex: 'L = \\frac{1}{n}\\sum_i \\ell(y_i, \\hat y_i)' }), formula)
  for (const marker of ['\\begin{equation}', 'L = \\frac{1}{n}\\sum_i \\ell(y_i, \\hat y_i)', '\\label{eq:eq-loss}', '\\end{equation}']) {
    assert.ok(formula.includes(marker), marker)
  }
  const tikzCode = '\\node (a) at (0,0) {Input};\\n\\node (b) at (2,0) {Encoder};'
  const tikz = renderTikz('fig-arch', { code: tikzCode, caption: 'Architecture' })
  assert.equal(renderTikz('fig-arch', { code: tikzCode, caption: 'Architecture' }), tikz)
  assert.ok(tikz.includes(tikzCode), 'TikZ 原码原样嵌入')
  assert.ok(tikz.includes('\\label{fig:fig-arch}'))
  assert.ok(tikz.includes('\\caption{Architecture}'))
})

test('renderArtifact：spec 校验前置（INVALID）+ 按 kind 分发', () => {
  // table 缺 runId → spec 校验 INVALID
  const badSpec = (() => { try { renderArtifact('tab-x', 'table', { columns: [{ metric: 'accuracy' }] }, metrics); return null } catch (error) { return error } })()
  assert.equal(code(badSpec), 'INVALID')
  assert.ok(badSpec instanceof ServiceError && badSpec.message.includes('runId'))
  // table 无 metrics → INVALID（绝不占位）
  const noMetrics = (() => { try { renderArtifact('tab-x', 'table', { runId: 'r1', columns: [{ metric: 'accuracy' }] }, undefined); return null } catch (error) { return error } })()
  assert.equal(code(noMetrics), 'INVALID')
  // 分发正确：pseudocode 不需要 metrics 也能渲染
  const pseudo = renderArtifact('alg-x', 'pseudocode', { steps: ['do it'] }, undefined)
  assert.ok(pseudo.includes('\\STATE do it'))
})

test('formatNumber：toPrecision(4) 去尾零；-0 归一；非有限数 INVALID', () => {
  assert.equal(formatNumber(0.912), '0.912')
  assert.equal(formatNumber(0.9), '0.9')
  assert.equal(formatNumber(2 / 3), '0.6667')
  assert.equal(formatNumber(1.1), '1.1')
  assert.equal(formatNumber(-0), '0')
  assert.equal(formatNumber(0.0001), '0.0001')
  // 指数带（<1e-7）保留 toPrecision 原样（确定性优先，不再去尾零）
  assert.equal(formatNumber(0.00001), '0.00001')
  assert.equal(formatNumber(0.0000001), '1.000e-7')
  assert.equal(formatNumber(1234.5), '1235')
  // 自定义精度
  assert.equal(formatNumber(0.912345, 2), '0.91')
  // 非有限数拒绝
  assert.equal(code((() => { try { formatNumber(Number.NaN); return null } catch (error) { return error } })()), 'INVALID')
  assert.equal(code((() => { try { formatNumber(Number.POSITIVE_INFINITY); return null } catch (error) { return error } })()), 'INVALID')
})
