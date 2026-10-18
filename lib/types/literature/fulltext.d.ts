/** 全文获取（P0-4）：DOI/条目 → Unpaywall（OA 定位）→ 域确认（root.json
 * fulltext.confirmedHosts 或调用方显式 allowHost）→ 既有 SSRF 四步 + 钉 IP
 * 公开域解析下载 → content-type/魔数门 → 落盘 PDF + 证据 JSON。
 *
 * 红线：只取 OA（Unpaywall is_oa / 条目自带 OA 链接），不携带 cookie/机构
 * 凭据、不绕付费墙；所有出网复用 RateGate + gatedFetchJson（Unpaywall）与
 * fetchPdf（SSRF），本模块不新增裸 fetch。
 *
 * 失败分型（稳定错误码）：PAYWALLED / HOST_NOT_ALLOWED / CONTENT_NOT_PDF /
 * UNRESOLVED / SSRF_BLOCKED（沿用 SSRF 层）/ RATE_LIMITED（沿用 RateGate）。
 */
import { type SrwFsLike } from '../host.ts';
import { type ResolveAddresses } from '../net/ssrf.ts';
import { type FetchPdfOptions, type FetchPdfResult } from './pdf.ts';
import type { RateGate } from './rate-gate.ts';
import type { LitIdentity } from './types.ts';
/** 全文获取的最小条目面（LitEntry 结构上兼容）。 */
export interface FulltextEntry {
    readonly key: string;
    readonly identity: LitIdentity;
    readonly authors: readonly string[];
    readonly venue: string;
    readonly abstract: string;
    readonly pdfUrl?: string;
    readonly oaUrl?: string;
}
export interface FulltextDeps {
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: string;
    readonly gate: RateGate;
    /** Unpaywall 必填邮箱（root.json unpaywallEmail；缺 → 无直链时报 INVALID）。 */
    readonly unpaywallEmail?: string;
    /** 已确认的出版商/仓储域（root.json fulltext.confirmedHosts）。 */
    readonly confirmedHosts?: readonly string[];
    /** 测试注入：Unpaywall JSON 取数（缺省 gatedFetchJson）。 */
    readonly fetchUnpaywallJson?: (url: URL) => Promise<unknown>;
    /** 测试注入：PDF 下载（缺省 fetchPdf）。 */
    readonly download?: (gate: RateGate, url: string, destAbs: string, fs: SrwFsLike | undefined, rootDir: string, options?: FetchPdfOptions) => Promise<FetchPdfResult>;
    /** 测试注入：DNS 解析（本地靶机用）。 */
    readonly resolveAddresses?: ResolveAddresses;
    /** 仅测试：允许回环/私网地址（本地 http 靶）。 */
    readonly allowPrivateForTest?: boolean;
    readonly maxBytes?: number;
    readonly now?: () => Date;
}
export type FulltextSource = 'unpaywall' | 'publisher' | 'direct';
export interface FulltextEvidence {
    readonly finalUrl: string;
    readonly host: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly retrievedAt: string;
    readonly source: FulltextSource;
}
export interface FulltextResult {
    readonly ok: true;
    readonly key: string;
    readonly paperKey: string;
    readonly file: string;
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly contentType: string;
    readonly host: string;
    readonly finalUrl: string;
    readonly source: FulltextSource;
    readonly evidencePath: string;
    readonly evidence: FulltextEvidence;
    readonly confirmedHosts: readonly string[];
}
/** identityKey 去非法字符（`doi:10.1038/nature12373` → `doi-10-1038-nature12373`）。 */
export declare function keySlug(key: string): string;
/** DOI 归一与形态校验（Unpaywall/Crossref 路径共用；非法 → INVALID）。 */
export declare function normalizeDoi(input: string): string;
/** Unpaywall URL：`https://api.unpaywall.org/v2/<doi>?email=<mailto>`。 */
export declare function unpaywallUrlFor(doi: string, email: string): URL;
export interface UnpaywallLocation {
    readonly url: string;
    readonly source: 'unpaywall';
}
export interface UnpaywallParse {
    readonly isOa: boolean;
    readonly locations: readonly UnpaywallLocation[];
}
/** 解析 Unpaywall 响应（best_oa_location 优先，其次 oa_locations）。 */
export declare function parseUnpaywall(payload: unknown): UnpaywallParse;
/** 主入口：取一条全文。成功返回落盘/证据信息；失败抛稳定错误码。 */
export declare function fetchFulltext(deps: FulltextDeps, project: string, entry: FulltextEntry | undefined, options?: {
    readonly doi?: string;
    readonly allowHost?: string;
}): Promise<FulltextResult>;
/** 兼容别名（调用方语义不同名，实现同一入口）。 */
export declare const downloadFulltext: typeof fetchFulltext;
/** 若条目 key 需要 keySlug（证据命名）——暴露给测试/服务层复用。 */
export declare function paperKeyOf(key: string): string;
