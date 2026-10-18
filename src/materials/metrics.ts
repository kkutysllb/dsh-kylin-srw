/** metrics 契约助手（M6，analysis/goals/02-写论文.md §4.4）：选择器语法
 * （'#accuracy' 取 values；'#series:loss' 取 series）、数值格式化
 * （toPrecision(4) 去尾零）、数字宏名（\srw<Name>）、metrics.json 落盘
 * 序列化、裸数字扫描（numbers.audit 的纯函数面）。全部无 IO、无时间源——
 * 同输入同输出。 */

import { ServiceError } from '../service.ts'
import { METRIC_NAME_RE } from './types.ts'

/** 数值格式化：toPrecision(4)（可调 1..17）去尾零；非有限数 → INVALID。
 * 确定性要求：无时间戳/无 locale 介入，同输入恒同输出。 */
export function formatNumber(value: number, precision = 4): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ServiceError('INVALID', '数值非法：' + String(value) + '（metrics.value 必须是有限数字）')
  }
  const digits = Math.min(Math.max(Math.trunc(precision), 1), 17)
  let text = value.toPrecision(digits)
  if (!/[eE]/.test(text) && text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '')
  }
  return text === '-0' ? '0' : text
}

export type Selector =
  | { readonly kind: 'metric'; readonly name: string }
  | { readonly kind: 'series'; readonly name: string }

/** 解析选择器：'#accuracy' → { kind:'metric', name:'accuracy' }；
 * '#series:loss' → { kind:'series', name:'loss' }；其余 → undefined。 */
export function parseSelector(raw: string): Selector | undefined {
  if (typeof raw !== 'string' || !raw.startsWith('#')) return undefined
  const body = raw.slice(1)
  if (body.startsWith('series:')) {
    const name = body.slice('series:'.length)
    return name === '' ? undefined : { kind: 'series', name }
  }
  return body === '' ? undefined : { kind: 'metric', name: body }
}

/** 数字宏名：metric 'accuracy' → 宏 'srwaccuracy'（\newcommand{\srwaccuracy}{…}）。 */
export function macroNameFor(metric: string): string {
  if (!METRIC_NAME_RE.test(metric)) {
    throw new ServiceError('INVALID', '指标名 ' + JSON.stringify(metric) + ' 须匹配 ^[A-Za-z][A-Za-z0-9_]*$ 才能生成数字宏')
  }
  return 'srw' + metric
}

/** metrics.json 落盘文本（确定性序列化：键序固定 schemaVersion→runId→values→series）。 */
export function metricsFileText(
  runId: string,
  payload: { readonly values: Readonly<Record<string, unknown>>; readonly series?: readonly unknown[] },
): string {
  const merged: Record<string, unknown> = { schemaVersion: 1, runId, values: payload.values }
  if (payload.series !== undefined) merged['series'] = payload.series
  return JSON.stringify(merged, null, 2) + '\n'
}

export interface BareNumberHit {
  readonly line: number
  readonly text: string
}

const BARE_NUMBER_RE = /\b\d+\.\d+\b/g

/** 裸数字扫描（整文件纯函数面）：逐行找 /\b\d+\.\d+\b/；跳过注释行
 * （trim 后以 % 开头）与 \newcommand 定义行。每行至多记一条。 */
export function scanBareNumbers(text: string): readonly BareNumberHit[] {
  const hits: BareNumberHit[] = []
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('%')) continue
    if (line.includes('\\newcommand')) continue
    BARE_NUMBER_RE.lastIndex = 0
    if (BARE_NUMBER_RE.test(line)) hits.push({ line: index + 1, text: trimmed })
  }
  return hits
}

/** 数字宏表（paper/generated/srw-numbers.tex）的确定性文本。 */
export function numbersTexText(macros: readonly { readonly name: string; readonly value: number }[]): string {
  const lines = [
    '% 由 srw 生成勿手改（materials.numbers；源 = experiments/manual/<runId>/metrics.json）',
    ...macros.map(macro => '\\newcommand{\\' + macro.name + '}{' + formatNumber(macro.value) + '}'),
    '',
  ]
  return lines.join('\n')
}
