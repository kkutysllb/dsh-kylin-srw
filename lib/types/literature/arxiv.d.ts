/** arXiv 适配器（0203 Task 2.2）：Atom 解析手写（arXiv Atom 形状稳定、
 * 无 CDATA；实体解码自实现）+ `id_list` 批量（≤100/批分片）。
 * 事实（0102 §5.3）：arXiv API 走 https 唯一——http 得空响应；所有派生
 * URL 一律 forceHttps。限速：export.arxiv.org 1 req/3s（RateGate 域表）。
 */
import type { RateGate } from './rate-gate.ts';
import type { LitCandidate } from './types.ts';
export declare const ARXIV_API = "https://export.arxiv.org/api/query";
/** id_list 单批上限（arXiv 文档口径）。 */
export declare const ARXIV_ID_BATCH = 100;
/** http→https（arXiv 对 http 返回空响应；所有派生链接统一升级）。 */
export declare function forceHttps(url: string): string;
/** 从 arXiv abs 链接提取 id 含版本：`…/abs/2401.12345v2` → `2401.12345v2`；
 * 老式分类 id（`cond-mat/0703123v1`）取 `/abs/` 后整体两段。 */
export declare function arxivIdFromUrl(idUrl: string): string;
/** 解析 Atom feed 的全部 entry（feed 头部忽略；无 entry 返回空数组）。 */
export declare function parseArxivAtom(xml: string): LitCandidate[];
/** 检索 URL：query 统一挂 all: 字段（用户已带 `ti:`/`au:` 前缀则透传原样）。 */
export declare function searchArxivUrl(query: string, limit: number): URL;
/** id_list 批量 URL：≤100/批由调用方分片（本函数只负责拼）。 */
export declare function fetchByIdsUrl(ids: readonly string[]): URL;
/** id_list 分片。 */
export declare function chunkIds(ids: readonly string[]): string[][];
export interface ArxivSearchDeps {
    readonly gate: RateGate;
}
/** 真网检索（fixture 测试打 parseArxivAtom；此函数只做装配）。 */
export declare function searchArxiv(deps: ArxivSearchDeps, query: string, limit?: number): Promise<LitCandidate[]>;
/** 批量按 id 取（自动分片，多批串行——RateGate 本就要求串行礼貌）。 */
export declare function fetchArxivByIds(deps: ArxivSearchDeps, ids: readonly string[]): Promise<LitCandidate[]>;
