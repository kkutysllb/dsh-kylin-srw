/** Crossref 适配器（0203 Task 2.4）：礼貌池（`mailto` 参数，来自 config
 * `politeMailto`）+ DOI 解析（404 → UNRESOLVED）。归一化 `message` 内层。 */
import type { RateGate } from './rate-gate.ts';
import type { LitCandidate } from './types.ts';
export declare const CROSSREF_API = "https://api.crossref.org/works";
/** 归一化一条 Crossref work message。 */
export declare function parseCrossrefWork(message: Record<string, unknown>): LitCandidate;
/** 检索 URL（礼貌 mailto）。 */
export declare function searchCrossrefUrl(query: string, rows: number, mailto?: string): URL;
/** DOI 解析 URL。 */
export declare function resolveDoiUrl(doi: string, mailto?: string): URL;
export interface CrossrefSearchDeps {
    readonly gate: RateGate;
    /** 礼貌池邮箱（缺省可用但享受不到 faster pool）。 */
    readonly mailto?: string;
}
/** 真网检索。 */
export declare function searchCrossref(deps: CrossrefSearchDeps, query: string, limit?: number): Promise<LitCandidate[]>;
/** DOI 解析：404 → UNRESOLVED（假 DOI 判定）。 */
export declare function resolveDoi(deps: CrossrefSearchDeps, doi: string): Promise<LitCandidate>;
