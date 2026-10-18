/** OpenAlex 适配器（0203 Task 2.3）：`per_page` 钳 ≤100，cursor 翻页
 * （`meta.next_cursor` 为 null/缺失即止）。归一化剥离 doi 的
 * `https://doi.org/` 前缀；OA 链接取 `open_access.oa_url`，
 * PDF 取 `best_oa_location.pdf_url`；摘要优先明文 `abstract`，否则按
 * `abstract_inverted_index` 的 position 还原；消费 `is_retracted` 与
 * `id`（剥 `https://openalex.org/` 前缀存 openalexId）。 */
import type { RateGate } from './rate-gate.ts';
import type { LitCandidate } from './types.ts';
export declare const OPENALEX_API = "https://api.openalex.org/works";
export declare const OPENALEX_PER_PAGE_MAX = 100;
/** 剥 DOI 前缀（OpenAlex 给 `https://doi.org/10.xxxx/yy`）。 */
export declare function stripDoiPrefix(doi: string): string;
/** 剥 OpenAlex Work id 的 `https://openalex.org/` 前缀（已裸 id 原样返回）。 */
export declare function stripOpenAlexIdPrefix(id: string): string;
/** 从 `abstract_inverted_index`（`{word: [positions…]}`）按 position 升序
 * 还原摘要（空格连接）。真实 API 只给这个字段，之前只读 `abstract` 导致摘要
 * 恒空（P0-4）。容忍 null/数组/非对象/坏位置：坏词丢弃、不抛；无可用位置
 * 时返回空串。 */
export declare function abstractFromInvertedIndex(value: unknown): string;
/** 归一化一页 results（fixture 单测面）。 */
export declare function parseOpenAlexResults(results: readonly unknown[]): LitCandidate[];
/** 检索 URL。 */
export declare function searchOpenAlexUrl(query: string, perPage: number, cursor?: string): URL;
export interface OpenAlexSearchDeps {
    readonly gate: RateGate;
}
/** 真网检索：cursor 循环到 limit 或 next_cursor=null（每页经 RateGate）。 */
export declare function searchOpenAlex(deps: OpenAlexSearchDeps, query: string, limit?: number): Promise<LitCandidate[]>;
