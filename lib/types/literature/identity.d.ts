/** 条目身份与去重（0203 Task 2.5 / P0-3）：
 * 三级 fallback——DOI → arXiv id → **title 弱键（不含 year）**。
 *
 * P0-3 两个修正：
 * 1. title 键去掉 year——同一篇论文在不同源/不同快照的 year 可能为 0 或漂移，
 *    旧键 `title:<sha1>:<year>` 会永久两键；新键 `title:<sha1>`。
 * 2. 弱键合并加守卫——标题键相同还不足以判同文：作者（任一重合）或 year
 *    相差 ≤1 或 venue 相同才算同文；否则在合并输出里保留两条（不同 key），
 *    等人工确认（possibleDuplicate 关系本轮不做）。
 *
 * arXiv 自赋 DOI 折叠为 arxivId 时把原 DOI 保留在 `identity.canonicalDoi`，
 * 避免 BibTeX/引用丢失 DOI。纯函数，无 I/O。
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
/** 身份归一：arXiv 自赋 DOI 折叠为 arxivId；原 DOI 保留到 `canonicalDoi`
 * （P0-3：DOI 不再丢，BibTeX/全文解析可回取）。import 校验层与 identityKey
 * 双端调用：存储带净身份，存量旧键也能合并。 */
export declare function normalizeIdentity(identity: LitIdentity): LitIdentity;
/** 合并守卫的输入面（库条目/候选都满足）。 */
export interface WorkLike {
    readonly identity: LitIdentity;
    readonly authors?: readonly string[];
    readonly venue?: string;
}
/** P0-3 弱键合并守卫：作者任一重合 / year 差 ≤1 / venue 相同 → 判同文。
 * 年份未知（0）视为同文（无法区分时宁可先合并，迁移时会报告冲突供复核）。 */
export declare function sameWork(left: WorkLike, right: WorkLike): boolean;
/** 已入库条目的最小形状（library.ts 的 entries 值）。
 * `key` 是库内实际键（迁移前可能是旧 `title:<sha1>:<year>` 键）——
 * upsert 匹配用**重算后的 identityKey**，命中后回写到的却是实际键。 */
export interface ExistingLike extends WorkLike {
    readonly seenIn: readonly string[];
    readonly key?: string;
}
export interface MergeReport {
    /** 去重后的新条目（不与 existing 重复；seenIn 为命中的源列表）。
     * `key` 是库内应使用的键：非标题键 = identityKey；标题键冲突时带稳定
     * 判别后缀（`title:<sha1>:<year+venue hash>`），保证两条不同论文不互相覆盖。 */
    readonly fresh: readonly (LitCandidate & {
        readonly seenIn: readonly string[];
        readonly key: string;
    })[];
    /** 每条输入的判定：`new` 新增 / `duplicate:<key>` 与本批或库内重复 /
     * `merged:<key>` 批内合并；`key` 是该输入最终归属的库内键。 */
    readonly verdicts: readonly {
        readonly source: string;
        readonly title: string;
        readonly verdict: string;
        readonly key: string;
    }[];
}
/** 标题键冲突时的稳定判别键（迁移/库存储共用）：base 未被占用则返回 base，
 * 否则返回 `title:<sha1>:<year+venue hash>`（重复冲突再加 -2/-3）。 */
export declare function disambiguatedTitleKey(identity: LitIdentity, venue: string | undefined, taken: ReadonlySet<string>): string;
/** 批内合并 + 与库内既有条目去重。
 * - 强键（DOI/arXiv）：同 key 即同文（信息择优 / 记 duplicate）；
 * - 弱键（title）：同 key 还要过 `sameWork` 守卫；守卫失败 → 新条目 + 判别键；
 * - 与 existing 匹配按**重算后的 identityKey**（P0-3 迁移前旧键也能命中）。
 */
export declare function mergeInto(candidates: readonly LitCandidate[], existing?: readonly ExistingLike[]): MergeReport;
