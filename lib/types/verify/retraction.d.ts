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
import type { RateGate } from '../literature/rate-gate.ts';
export type RetractionState = 'retracted' | 'corrigendum' | 'ok' | 'unknown';
export interface RetractionSignals {
    readonly retracted: boolean;
    readonly corrigendum: boolean;
}
/** 从 Crossref work message 提取撤稿/勘误信号（纯函数，单测面）。 */
export declare function retractionSignalsOf(message: Record<string, unknown>): RetractionSignals;
/** 命中判定（保留旧名，语义收紧为仅撤稿类信号）。 */
export declare function isRetracted(message: Record<string, unknown>): boolean;
/** 全状态：retracted > corrigendum > ok。 */
export declare function retractionStateOf(message: Record<string, unknown>): Exclude<RetractionState, 'unknown'>;
export interface RetractionCheckDeps {
    readonly gate: RateGate;
    readonly mailto?: string;
}
/** 按 DOI 查撤稿状态：'retracted' 标红阻断 / 'corrigendum' 通知不阻断 /
 * 'ok' 未命中 / 'unknown'（UNRESOLVED/网络失败，不阻断入库）。 */
export declare function checkRetraction(deps: RetractionCheckDeps, doi: string): Promise<RetractionState>;
/** 导出断言工具（bibtex/import 门用）：retracted 条目默认阻断；
 * corrigendum 不阻断（勘误≠撤稿，论文仍可引用）。 */
export declare function assertNotRetracted(status: string, key: string): void;
