/** M6 生成器（analysis/goals/02-写论文.md §4.5）：**内置纯函数确定性渲染**，
 * 不执行外部脚本/进程（script 型生成器留待后续）。同 spec + 同 inputs →
 * 字节级相同输出；产物禁含时间戳/绝对路径/随机数；LF 换行；数值统一
 * toPrecision(4) 去尾零。缺指标/series → INVALID 并列出缺哪些——绝不
 * 生成占位数据冒充真实。
 *
 * 工程纪律：生成器不调用 LLM（内容由 agent 写进 spec，本模块只做渲染）。 */

import { ServiceError } from '../service.ts'
import { formatNumber } from './metrics.ts'
import {
  validateSpec,
  type ArtifactKind,
  type FormulaSpec,
  type MetricsFile,
  type PlotSpec,
  type PseudocodeSpec,
  type TableSpec,
  type TikzSpec,
} from './types.ts'

/** 每个 \label 的前缀（insertedAt.label 与产物内部一致）。 */
export const KIND_LABEL_PREFIX: Readonly<Record<ArtifactKind, 'tab' | 'fig' | 'alg' | 'eq'>> = {
  table: 'tab',
  plot: 'fig',
  pseudocode: 'alg',
  formula: 'eq',
  tikz: 'fig',
}

/** kind → 产物目录（materials/ 下）。 */
export const KIND_DIR: Readonly<Record<ArtifactKind, 'tables' | 'plots' | 'pseudocode' | 'formulas' | 'figures'>> = {
  table: 'tables',
  plot: 'plots',
  pseudocode: 'pseudocode',
  formula: 'formulas',
  tikz: 'figures',
}

/** kind → 内置生成器版本号（manifest.generator.builtin）。 */
export const BUILTIN_GENERATOR: Readonly<Record<ArtifactKind, 'table-v1' | 'plot-v1' | 'pseudocode-v1' | 'formula-v1' | 'tikz-v1'>> = {
  table: 'table-v1',
  plot: 'plot-v1',
  pseudocode: 'pseudocode-v1',
  formula: 'formula-v1',
  tikz: 'tikz-v1',
}

/** booktabs 表：单数据行，列 = spec.columns（每列一个 metric 的值）。 */
export function renderTable(id: string, spec: TableSpec, metrics: MetricsFile): string {
  const missing = spec.columns
    .map(column => column.metric)
    .filter(metric => metrics.values[metric] === undefined)
  if (missing.length > 0) {
    throw new ServiceError('INVALID', 'metrics（run ' + metrics.runId + '）缺少指标：' + missing.join(', ') + '——先 metrics.import 补数据或修改 spec.columns')
  }
  const headers = spec.columns.map(column => column.header ?? column.metric)
  const cells = spec.columns.map(column => {
    const precision = column.precision ?? 4
    return formatNumber(metrics.values[column.metric]!.value, precision)
  })
  const align = 'l' + 'r'.repeat(Math.max(0, spec.columns.length - 1))
  return [
    '\\begin{table}[t]',
    '\\centering',
    '\\caption{' + (spec.caption ?? spec.title ?? id) + '}',
    '\\label{tab:' + id + '}',
    '\\begin{tabular}{' + align + '}',
    '\\toprule',
    headers.join(' & ') + ' \\',
    '\\midrule',
    cells.join(' & ') + ' \\',
    '\\bottomrule',
    '\\end{tabular}',
    '\\end{table}',
    '',
  ].join('\n')
}

/** pgfplots 数据曲线图：series 坐标固定、无随机布局。 */
export function renderPlot(id: string, spec: PlotSpec, metrics: MetricsFile): string {
  const series = metrics.series?.find(row => row.name === spec.seriesName)
  if (series === undefined) {
    const known = (metrics.series ?? []).map(row => row.name).join(', ')
    throw new ServiceError('INVALID', 'metrics（run ' + metrics.runId + '）没有 series「' + spec.seriesName + '」（现有：' + (known === '' ? '无' : known) + '）——先 metrics.import 或修改 spec.seriesName')
  }
  const coords = series.points.map(point => '(' + formatNumber(point[0]!) + ', ' + formatNumber(point[1]!) + ')').join(' ')
  return [
    '\\begin{figure}[t]',
    '\\centering',
    '\\begin{tikzpicture}',
    '\\begin{axis}[',
    '  xlabel={' + (spec.xLabel ?? 'x') + '},',
    '  ylabel={' + (spec.yLabel ?? 'y') + '},',
    ']',
    '\\addplot coordinates {' + coords + '};',
    '\\end{axis}',
    '\\end{tikzpicture}',
    '\\caption{' + (spec.caption ?? id) + '}',
    '\\label{fig:' + id + '}',
    '\\end{figure}',
    '',
  ].join('\n')
}

/** algorithmic 指令前缀映射：'FOR x in xs' 渲染为 \FOR{x in xs}；其余为 \STATE。 */
function pseudocodeLine(step: string): string {
  const match = /^(FOR|IF|ELSIF|ELSE|WHILE|RETURN|ENDFOR|ENDIF|ENDWHILE)\b\s*(.*)$/.exec(step)
  if (match === null) return '\\STATE ' + step
  const keyword = match[1] ?? ''
  const rest = match[2] ?? ''
  switch (keyword) {
    case 'FOR': return '\\FOR{' + rest + '}'
    case 'WHILE': return '\\WHILE{' + rest + '}'
    case 'IF': return '\\IF{' + rest + '}'
    case 'ELSIF': return '\\ELSIF{' + rest + '}'
    case 'ELSE': return '\\ELSE'
    case 'RETURN': return '\\RETURN ' + rest
    case 'ENDFOR': return '\\ENDFOR'
    case 'ENDIF': return '\\ENDIF'
    case 'ENDWHILE': return '\\ENDWHILE'
    default: return '\\STATE ' + step
  }
}

/** 伪代码：algorithm + algorithmic[1]，行内允许原始 LaTeX（确定性文本渲染）。 */
export function renderPseudocode(id: string, spec: PseudocodeSpec): string {
  return [
    '\\begin{algorithm}',
    '\\caption{' + (spec.caption ?? id) + '}',
    '\\label{alg:' + id + '}',
    '\\begin{algorithmic}[1]',
    ...spec.steps.map(pseudocodeLine),
    '\\end{algorithmic}',
    '\\end{algorithm}',
    '',
  ].join('\n')
}

/** 公式：equation + \label。MVP 不做 sympy 子进程——状态恒
 * unverifiable/structural（G-M2 的诚实形态），引用须脚注「未验证」。 */
export function renderFormula(id: string, spec: FormulaSpec): string {
  return [
    '\\begin{equation}',
    spec.latex,
    '\\label{eq:' + id + '}',
    '\\end{equation}',
    '',
  ].join('\n')
}

/** TikZ 架构/流程图：figure 包 raw code（spec.code 原样嵌入）+ \label。 */
export function renderTikz(id: string, spec: TikzSpec): string {
  return [
    '\\begin{figure}[t]',
    '\\centering',
    spec.code,
    '\\caption{' + (spec.caption ?? id) + '}',
    '\\label{fig:' + id + '}',
    '\\end{figure}',
    '',
  ].join('\n')
}

/** 分发入口（generate 与复算重渲染共用）：先过 spec 校验，再按 kind 渲染。
 * table/plot 必须带已解析的 metrics；其余 kinds 的 metrics 忽略。 */
export function renderArtifact(
  id: string,
  kind: ArtifactKind,
  spec: Record<string, unknown>,
  metrics: MetricsFile | undefined,
): string {
  const errors = validateSpec(kind, spec)
  if (errors.length > 0) throw new ServiceError('INVALID', 'spec 校验失败：' + errors.join('；'))
  switch (kind) {
    case 'table':
      if (metrics === undefined) throw new ServiceError('INVALID', 'table 渲染需要已解析的 metrics')
      return renderTable(id, spec as unknown as TableSpec, metrics)
    case 'plot':
      if (metrics === undefined) throw new ServiceError('INVALID', 'plot 渲染需要已解析的 metrics')
      return renderPlot(id, spec as unknown as PlotSpec, metrics)
    case 'pseudocode':
      return renderPseudocode(id, spec as unknown as PseudocodeSpec)
    case 'formula':
      return renderFormula(id, spec as unknown as FormulaSpec)
    case 'tikz':
      return renderTikz(id, spec as unknown as TikzSpec)
  }
}
