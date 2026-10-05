/** 条目身份与去重（0203 Task 2.5）：三级 fallback——DOI → arXiv id →
 * (title 归一化 + year)。同文多源命中合并为一条（信息择优 + seenIn 累积）。
 * 纯函数，无 I/O。
 */
import type { LitCandidate, LitIdentity } from './types.ts';
/** 标题归一：NFKC → 折叠空白 → 去标点（保留字母数字与 CJK）→ casefold。 */
export declare function normalizeTitle(title: string): string;
/** 身份键（三级 fallback 的最高可用级）。 */
export declare function identityKey(identity: LitIdentity): string;
/** arXiv 自赋 DOI（`10.48550/arxiv.<id>`，该前缀专属 arXiv）→ 抽出 arXiv id；
 * 其余 DOI 返回 undefined。跨源去重的前提：openalex/crossref 给的是 DOI 形态，
 * arXiv 源给的是 id 形态，不折叠则同文两键（2026-10-05 桌面端实测踩中）。 */
export declare function arxivIdFromArxivDoi(doi: string): string | undefined;
/** 身份归一：arXiv 自赋 DOI 折叠为 arxivId（doi 键被丢——同物异形）。
 * import 校验层与 identityKey 双端调用：存储带净身份，存量旧键也能合并。 */
export declare function normalizeIdentity(identity: LitIdentity): LitIdentity;
/** 已入库条目的最小形状（library.ts 的 entries 值）——这里只用到身份与 seenIn。 */
export interface ExistingLike {
    readonly identity: LitIdentity;
    readonly seenIn: readonly string[];
}
export interface MergeReport {
    /** 去重后的新条目（不与 existing 重复；seenIn 为命中的源列表）。 */
    readonly fresh: readonly (LitCandidate & {
        readonly seenIn: readonly string[];
    })[];
    /** 每条输入的判定：`new` 新增 / `duplicate:<key>` 与本批或库内重复。 */
    readonly verdicts: readonly {
        readonly source: string;
        readonly title: string;
        readonly verdict: string;
    }[];
}
/** 批内合并 + 与库内既有条目去重。
 * - 批内同 key：择优（信息量分高者），seenIn 并集；
 * - 与 existing 同 key：记 duplicate，不入 fresh。
 */
export declare function mergeInto(candidates: readonly LitCandidate[], existing?: readonly ExistingLike[]): MergeReport;
