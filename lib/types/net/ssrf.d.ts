/** SSRF 守卫（0102 §12 红线 / 0203 Task 2.7）：照宿主策略自实现（宿主实现
 * 不在 package exports）——parseFetchUrl → resolvePublicAddresses（任一
 * 地址非公网**整组拒绝**）→ 钉死 IP 连接（lookup 钩子跳过二次解析，防
 * TOCTOU 重绑定）→ 重定向逐跳重验（跨源拒绝，宿主屏升级 http→https 同 host
 * 例外）。白名单叠加在所有检查之外（收窄为必须，放宽无意义）。
 */
import http from 'node:http';
/** parseFetchUrl：仅 http/https、拒 URL 内凭据、长度 ≤2048。 */
export declare function parseFetchUrl(raw: string): URL;
/** 是否公网地址（IPv4/IPv6 全覆盖）：回环/私网/link-local/未指定/CGNAT/
 * NAT64 前缀 / IPv4-mapped 一律非公网。 */
export declare function isPublicIp(ip: string): boolean;
/** DNS 解析注入 seam（测试用；缺省真实 lookup）。 */
export type ResolveAddresses = (hostname: string) => Promise<string[]>;
/** 解析并校验：返回**全部公网地址**（任一非公网 → 整组拒绝）。
 * `allowPrivate` 仅测试降级（本地回环靶机）——产品代码绝不传。 */
export declare function resolvePublicAddresses(hostname: string, resolve?: ResolveAddresses, { allowPrivate }?: {
    allowPrivate?: boolean;
}): Promise<string[]>;
/** 白名单断言（域名精确匹配；配置只可加不可减）。 */
export declare function assertWhitelisted(hostname: string, allowed: ReadonlySet<string>): void;
/** 重定向策略：同 host 且 https 升级（http→https）允许；其余跨源一律拒绝。 */
export declare function isAllowedRedirect(from: URL, to: URL): boolean;
export interface PinnedResponse {
    readonly status: number;
    readonly headers: http.IncomingHttpHeaders;
    readonly stream: http.IncomingMessage;
}
/** 钉死连接：request 带 lookup 钩子直接回调已校验 IP（跳过 DNS 二次解析），
 * TLS SNI/Host 头仍用原 hostname。lookup 回调按 options.all 双形态响应
 * （all:true 要地址对象数组——实测传单值形式得 "Invalid IP address: undefined"）。 */
export declare function pinnedRequest(target: URL, validatedIp: string, options?: {
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
}): Promise<PinnedResponse>;
