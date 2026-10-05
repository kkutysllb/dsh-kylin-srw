/** 撤稿检查（0203 Task 2.9；0204 Task 3.6 类型区分）：Crossref work
 * message 的撤稿/勘误信号 → `retracted`（标红阻断）或 `corrigendum`
 * （通知不阻断，entry.notice 附加字段）。
 *
 * Crossref 事实面（2026 口径）：撤稿声明是独立 work（`relation.is-retraction-of`
 * 指向原文）；原文侧常见 `updated-by: [{type: 'retraction'|'corrigendum', …}]`。
 * **类型区分（M2 遗留修正）**：`updated-by[].type === 'retraction'`（或
 * withdrawal/removal）才判撤稿；corrigendum/erratum 及 `relation.is-update-of`
 * 是勘误/更新信号——论文没被撤，只提示。无 type 的旧式 updated-by 记录
 * 保守视为勘误信号（不标红）。 */

import { ServiceError } from '../service.ts'
import { gatedFetchJson } from '../literature/http.ts'
import type { RateGate } from '../literature/rate-gate.ts'

export type RetractionState = 'retracted' | 'corrigendum' | 'ok' | 'unknown'

export interface RetractionSignals {
  readonly retracted: boolean
  readonly corrigendum: boolean
}

const RETRACTING_TYPES = new Set(['retraction', 'withdrawal', 'removal'])

/** 从 Crossref work message 提取撤稿/勘误信号（纯函数，单测面）。 */
export function retractionSignalsOf(message: Record<string, unknown>): RetractionSignals {
  let retracted = false
  let corrigendum = false
  const updatedBy = message['updated-by']
  if (Array.isArray(updatedBy)) {
    for (const raw of updatedBy) {
      if (typeof raw !== 'object' || raw === null) {
        corrigendum = true // 无形状的旧式记录：保守视为更新信号，不标红
        continue
      }
      const type = String((raw as Record<string, unknown>)['type'] ?? '').toLowerCase()
      if (RETRACTING_TYPES.has(type)) retracted = true
      else corrigendum = true
    }
  }
  const relations = message['relation']
  if (typeof relations === 'object' && relations !== null) {
    const relation = relations as Record<string, unknown>
    const has = (key: string): boolean => {
      const list = relation[key]
      return Array.isArray(list) && list.length > 0
    }
    // is-retraction-of：本 work 是某文的撤稿声明（按 0204 口径并入撤稿类）
    if (has('is-retraction-of')) retracted = true
    // is-update-of：本 work 是某文的勘误/更新——不是撤稿
    if (has('is-update-of')) corrigendum = true
  }
  return { retracted, corrigendum }
}

/** 命中判定（保留旧名，语义收紧为仅撤稿类信号）。 */
export function isRetracted(message: Record<string, unknown>): boolean {
  return retractionSignalsOf(message).retracted
}

/** 全状态：retracted > corrigendum > ok。 */
export function retractionStateOf(message: Record<string, unknown>): Exclude<RetractionState, 'unknown'> {
  const signals = retractionSignalsOf(message)
  if (signals.retracted) return 'retracted'
  if (signals.corrigendum) return 'corrigendum'
  return 'ok'
}

export interface RetractionCheckDeps {
  readonly gate: RateGate
  readonly mailto?: string
}

/** 按 DOI 查撤稿状态：'retracted' 标红阻断 / 'corrigendum' 通知不阻断 /
 * 'ok' 未命中 / 'unknown'（UNRESOLVED/网络失败，不阻断入库）。 */
export async function checkRetraction(
  deps: RetractionCheckDeps,
  doi: string,
): Promise<RetractionState> {
  const trimmed = doi.trim().replace(/^https?:\/\/doi\.org\//i, '')
  if (trimmed === '') return 'unknown'
  const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(trimmed)}`)
  if (deps.mailto !== undefined && deps.mailto !== '') url.searchParams.set('mailto', deps.mailto)
  try {
    const envelope = await gatedFetchJson<{ message?: Record<string, unknown> }>(deps.gate, url)
    if (typeof envelope.message !== 'object' || envelope.message === null) return 'unknown'
    return retractionStateOf(envelope.message)
  } catch (error: unknown) {
    const code = (error as { code?: string }).code
    if (code === 'UNRESOLVED' || code === 'RATE_LIMITED' || code === 'UPSTREAM' || code === 'DNS_FAIL') return 'unknown'
    throw error
  }
}

/** 导出断言工具（bibtex/import 门用）：retracted 条目默认阻断；
 * corrigendum 不阻断（勘误≠撤稿，论文仍可引用）。 */
export function assertNotRetracted(status: string, key: string): void {
  if (status === 'retracted') {
    throw new ServiceError('RETRACTED', `条目已撤稿，引用被阻断：${key}（M2 提示级；M3 收紧为硬门）`)
  }
}
