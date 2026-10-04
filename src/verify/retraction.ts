/** 撤稿检查（0203 Task 2.9）：Crossref work message 的 `updated-by` /
 * `relation is-retraction-of` / `relation is-update-of` 信号 → 命中即
 * `status='retracted'`。fixture 两态单测；真网在 Task 2.11 活体。
 *
 * Crossref 表达撤稿的事实面（2026 口径）：撤稿声明是一篇独立 work，
 * 其 `relation.is-retraction-of` 指向原文 DOI；原文侧常见 `updated-by`。
 * 两向任一命中即判。 */

import { ServiceError } from '../service.ts'
import { gatedFetchJson } from '../literature/http.ts'
import type { RateGate } from '../literature/rate-gate.ts'

export interface RetractionSignals {
  readonly updatedBy: boolean
  readonly isRetractionOf: boolean
}

/** 从 Crossref work message 提取撤稿信号（纯函数，单测面）。 */
export function retractionSignalsOf(message: Record<string, unknown>): RetractionSignals {
  const updatedBy = Array.isArray(message['updated-by']) && message['updated-by'].length > 0
  let isRetractionOf = false
  const relations = message['relation']
  if (typeof relations === 'object' && relations !== null) {
    const relation = relations as Record<string, unknown>
    for (const key of ['is-retraction-of', 'is-update-of']) {
      const list = relation[key]
      if (Array.isArray(list) && list.length > 0) {
        isRetractionOf = true
        break
      }
    }
  }
  return { updatedBy, isRetractionOf }
}

/** 命中判定：任一信号即撤稿。 */
export function isRetracted(message: Record<string, unknown>): boolean {
  const signals = retractionSignalsOf(message)
  return signals.updatedBy || signals.isRetractionOf
}

export interface RetractionCheckDeps {
  readonly gate: RateGate
  readonly mailto?: string
}

/** 按 DOI 查撤稿状态：命中 → 'retracted'；未命中 → 'ok'；
 * DOI 解析失败（UNRESOLVED/网络）→ 'unknown'（不阻断入库，M3 收紧）。 */
export async function checkRetraction(
  deps: RetractionCheckDeps,
  doi: string,
): Promise<'retracted' | 'ok' | 'unknown'> {
  const trimmed = doi.trim().replace(/^https?:\/\/doi\.org\//i, '')
  if (trimmed === '') return 'unknown'
  const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(trimmed)}`)
  if (deps.mailto !== undefined && deps.mailto !== '') url.searchParams.set('mailto', deps.mailto)
  try {
    const envelope = await gatedFetchJson<{ message?: Record<string, unknown> }>(deps.gate, url)
    if (typeof envelope.message !== 'object' || envelope.message === null) return 'unknown'
    return isRetracted(envelope.message) ? 'retracted' : 'ok'
  } catch (error: unknown) {
    const code = (error as { code?: string }).code
    if (code === 'UNRESOLVED' || code === 'RATE_LIMITED' || code === 'UPSTREAM' || code === 'DNS_FAIL') return 'unknown'
    throw error
  }
}

/** 导出断言工具（bibtex/import 门用）：retracted 条目默认阻断。 */
export function assertNotRetracted(status: string, key: string): void {
  if (status === 'retracted') {
    throw new ServiceError('RETRACTED', `条目已撤稿，引用被阻断：${key}（M2 提示级；M3 收紧为硬门）`)
  }
}
