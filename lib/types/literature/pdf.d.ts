/** PDF 获取（0203 Task 2.7）：白名单域 + SSRF 三步逐跳重验 + 跨源重定向
 * 拒绝 + 字节上限流式落盘 + sha256。流式写 tmp、校验通过后 rename。
 * `allowPrivateForTest` 仅供本地回环测试降级（产品代码绝不传）。 */
import { type SrwFsLike } from '../host.ts';
import { type ResolveAddresses } from '../net/ssrf.ts';
import type { RateGate } from './rate-gate.ts';
/** 出网字节上限：200 MiB（arXiv PDF 现实上限的宽松余量）。 */
export declare const PDF_MAX_BYTES: number;
export declare const DEFAULT_PDF_HOSTS: readonly string[];
export interface FetchPdfOptions {
    readonly allowedHosts?: ReadonlySet<string>;
    readonly maxBytes?: number;
    readonly resolveAddresses?: ResolveAddresses;
    /** 仅测试：允许回环/私网地址（本地 http 服务器靶）。 */
    readonly allowPrivateForTest?: boolean;
}
export interface FetchPdfResult {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly contentType: string;
}
/** 主入口：下载 → 流式落盘（tmp）→ sha256 → rename。 */
export declare function fetchPdf(gate: RateGate, rawUrl: string, destAbs: string, fs: SrwFsLike | undefined, rootDir: string, options?: FetchPdfOptions): Promise<FetchPdfResult>;
/** 按候选链接顺序尝试（pdfUrl 优先，其次 oaUrl）。 */
export declare function fetchPdfFor(gate: RateGate, urls: readonly (string | undefined)[], destAbs: string, fs: SrwFsLike | undefined, rootDir: string, options?: FetchPdfOptions): Promise<FetchPdfResult>;
/** 文件存在探测（视图层 has-pdf 回填判断）。 */
export declare function fileExists(absPath: string): Promise<boolean>;
