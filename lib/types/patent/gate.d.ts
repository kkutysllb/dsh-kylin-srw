/** 公开时序门（M9-lite 最值钱的单点）：先申请、后公开。纯函数——输入
 * 已校验的 patent/events 与「计划公开时点」，输出四档判定 + 中文
 * reasons/advice；不落盘、不外联、不构成法律意见。
 *
 * 判定规则（analysis/goals/03-写专利.md §4 交叉 + 任务口径）：
 * 1) filing.filedAt 存在且 ≤ publicationAt → safe；
 * 2) 已公开事件（publicAt ≤ publicationAt）且无 filing → blocked（不可逆）；
 * 3) 有 filing 且事件 publicAt < filedAt：差距 ≤ 6 个月且 graceCase ≠ none
 *    → grace（须代理人确认适用）；否则 → risk（新颖性已丧失）；
 * 4) 无 filing、无已公开事件 → risk（先申请后公开）；
 * 5) 事件全部在 filedAt 之后 → safe。
 * 多事件取最严：blocked > risk > grace > safe；每条 reason 带事件
 * publicAt/kind；advice 至少一条。 */
import type { PatentMeta, PublicEvent } from './types.ts';
export type PublicationVerdict = 'safe' | 'grace' | 'risk' | 'blocked';
export interface PublicationCheckInput {
    readonly patent: PatentMeta;
    readonly events: readonly PublicEvent[];
    /** 计划公开时点（投稿/预印本/答辩/开源的时刻），缺省语义由调用方补 now。 */
    readonly publicationAt: string;
    /** 「未来」判定基准（缺省当前时刻；测试显式传入保证确定性）。 */
    readonly now?: string;
}
export interface PublicationCheck {
    readonly verdict: PublicationVerdict;
    readonly reasons: readonly string[];
    readonly advice: readonly string[];
}
/** 公开事件落入宽限期窗口：filedAt - publicAt ≤ 6 个月（日历月）。 */
export declare function withinGraceWindow(publicAtMs: number, filedAtMs: number): boolean;
export declare function checkPublication(input: PublicationCheckInput): PublicationCheck;
