/** 撤稿检查（0203 Task 2.9）：Crossref work message 的 `updated-by` /
 * `relation is-retraction-of` / `relation is-update-of` 信号 → 命中即
 * `status='retracted'`。fixture 两态单测；真网在 Task 2.11 活体。
 *
 * Crossref 表达撤稿的事实面（2026 口径）：撤稿声明是一篇独立 work，
 * 其 `relation.is-retraction-of` 指向原文 DOI；原文侧常见 `updated-by`。
 * 两向任一命中即判。 */
import type { RateGate } from '../literature/rate-gate.ts';
export interface RetractionSignals {
    readonly updatedBy: boolean;
    readonly isRetractionOf: boolean;
}
/** 从 Crossref work message 提取撤稿信号（纯函数，单测面）。 */
export declare function retractionSignalsOf(message: Record<string, unknown>): RetractionSignals;
/** 命中判定：任一信号即撤稿。 */
export declare function isRetracted(message: Record<string, unknown>): boolean;
export interface RetractionCheckDeps {
    readonly gate: RateGate;
    readonly mailto?: string;
}
/** 按 DOI 查撤稿状态：命中 → 'retracted'；未命中 → 'ok'；
 * DOI 解析失败（UNRESOLVED/网络）→ 'unknown'（不阻断入库，M3 收紧）。 */
export declare function checkRetraction(deps: RetractionCheckDeps, doi: string): Promise<'retracted' | 'ok' | 'unknown'>;
/** 导出断言工具（bibtex/import 门用）：retracted 条目默认阻断。 */
export declare function assertNotRetracted(status: string, key: string): void;
