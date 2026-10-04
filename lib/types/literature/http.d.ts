/** 文献 API 的统一出网口（0203 Task 2.2）：RateGate 限速 + withDeadline
 * 超时 + 手动重定向（API 域固定常量，Task 2.7 的完整 SSRF 三步只用于
 * 用户/agent 提供的 URL）+ 429/503 上报退避。
 *
 * 只接受本模块构造的 https URL；查询串编码交给 URL/URLSearchParams。
 */
import type { RateGate } from './rate-gate.ts';
export interface GatedFetchResult {
    readonly status: number;
    readonly text: string;
}
/** GET 并以文本返回（Atom/XML/JSON 皆可，解析交给调用方）。 */
export declare function gatedFetchText(gate: RateGate, url: URL): Promise<string>;
/** GET 并解析 JSON（坏 JSON → UPSTREAM）。 */
export declare function gatedFetchJson<T>(gate: RateGate, url: URL): Promise<T>;
