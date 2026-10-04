/** OpenAlex 适配器（0203 Task 2.3）：`per_page` 钳 ≤100，cursor 翻页
 * （`meta.next_cursor` 为 null/缺失即止）。归一化剥离 doi 的
 * `https://doi.org/` 前缀；OA 链接取 `open_access.oa_url`，
 * PDF 取 `best_oa_location.pdf_url`。 */
import type { RateGate } from './rate-gate.ts';
import type { LitCandidate } from './types.ts';
export declare const OPENALEX_API = "https://api.openalex.org/works";
export declare const OPENALEX_PER_PAGE_MAX = 100;
/** 剥 DOI 前缀（OpenAlex 给 `https://doi.org/10.xxxx/yy`）。 */
export declare function stripDoiPrefix(doi: string): string;
/** 归一化一页 results（fixture 单测面）。 */
export declare function parseOpenAlexResults(results: readonly unknown[]): LitCandidate[];
/** 检索 URL。 */
export declare function searchOpenAlexUrl(query: string, perPage: number, cursor?: string): URL;
export interface OpenAlexSearchDeps {
    readonly gate: RateGate;
}
/** 真网检索：cursor 循环到 limit 或 next_cursor=null（每页经 RateGate）。 */
export declare function searchOpenAlex(deps: OpenAlexSearchDeps, query: string, limit?: number): Promise<LitCandidate[]>;
