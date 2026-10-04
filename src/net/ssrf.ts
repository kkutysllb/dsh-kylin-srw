/** SSRF 守卫（0102 §12 红线 / 0203 Task 2.7）：照宿主策略自实现（宿主实现
 * 不在 package exports）——parseFetchUrl → resolvePublicAddresses（任一
 * 地址非公网**整组拒绝**）→ 钉死 IP 连接（lookup 钩子跳过二次解析，防
 * TOCTOU 重绑定）→ 重定向逐跳重验（跨源拒绝，宿主屏升级 http→https 同 host
 * 例外）。白名单叠加在所有检查之外（收窄为必须，放宽无意义）。
 */

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import dns from 'node:dns'
import { ServiceError } from '../service.ts'

const MAX_URL_LENGTH = 2048

/** parseFetchUrl：仅 http/https、拒 URL 内凭据、长度 ≤2048。 */
export function parseFetchUrl(raw: string): URL {
  if (raw.length > MAX_URL_LENGTH) {
    throw new ServiceError('INVALID', `URL 超长（>${MAX_URL_LENGTH}）`)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ServiceError('INVALID', `URL 无法解析：${JSON.stringify(raw.slice(0, 100))}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServiceError('INVALID', `仅允许 http/https，收到 ${url.protocol}`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new ServiceError('INVALID', 'URL 内嵌凭据被拒绝')
  }
  return url
}

/** 是否公网地址（IPv4/IPv6 全覆盖）：回环/私网/link-local/未指定/CGNAT/
 * NAT64 前缀 / IPv4-mapped 一律非公网。 */
export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number, number, number]
    if (a === 0 || a === 10 || a === 127) return false // unspecified / 私网 / 回环
    if (a === 169 && b === 254) return false // link-local
    if (a === 172 && b >= 16 && b <= 31) return false // 私网
    if (a === 192 && b === 168) return false // 私网
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    if (a >= 224) return false // 组播/保留
    return true
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    if (lower === '::' || lower === '::1') return false
    if (lower.startsWith('fe80:')) return false // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return false // ULA 私网
    if (lower.startsWith('64:ff9b:')) return false // NAT64 前缀
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped：剥壳按 IPv4 判
      const v4 = lower.slice('::ffff:'.length)
      return net.isIPv4(v4) ? isPublicIp(v4) : false
    }
    if (lower.startsWith('ff')) return false // 组播
    return true
  }
  return false
}

/** DNS 解析注入 seam（测试用；缺省真实 lookup）。 */
export type ResolveAddresses = (hostname: string) => Promise<string[]>

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true })
  return records.map(record => record.address)
}

/** 解析并校验：返回**全部公网地址**（任一非公网 → 整组拒绝）。
 * `allowPrivate` 仅测试降级（本地回环靶机）——产品代码绝不传。 */
export async function resolvePublicAddresses(
  hostname: string,
  resolve: ResolveAddresses = defaultResolve,
  { allowPrivate = false }: { allowPrivate?: boolean } = {},
): Promise<string[]> {
  let addresses: string[]
  try {
    addresses = await resolve(hostname)
  } catch (error: unknown) {
    throw new ServiceError('DNS_FAIL', `域名解析失败：${hostname}（${error instanceof Error ? error.message : String(error)}）`)
  }
  if (addresses.length === 0) {
    throw new ServiceError('DNS_FAIL', `域名无地址：${hostname}`)
  }
  if (allowPrivate) return addresses
  const bad = addresses.filter(address => !isPublicIp(address))
  if (bad.length > 0) {
    throw new ServiceError('SSRF_BLOCKED', `域名 ${hostname} 解析到非公网地址（${bad.join(', ')}），整组拒绝`)
  }
  return addresses
}

/** 白名单断言（域名精确匹配；配置只可加不可减）。 */
export function assertWhitelisted(hostname: string, allowed: ReadonlySet<string>): void {
  if (!allowed.has(hostname)) {
    throw new ServiceError('SSRF_BLOCKED', `域名不在白名单：${hostname}`)
  }
}

/** 重定向策略：同 host 且 https 升级（http→https）允许；其余跨源一律拒绝。 */
export function isAllowedRedirect(from: URL, to: URL): boolean {
  return from.protocol === 'http:' && to.protocol === 'https:' && from.hostname === to.hostname
}

export interface PinnedResponse {
  readonly status: number
  readonly headers: http.IncomingHttpHeaders
  readonly stream: http.IncomingMessage
}

/** 钉死连接：request 带 lookup 钩子直接回调已校验 IP（跳过 DNS 二次解析），
 * TLS SNI/Host 头仍用原 hostname。lookup 回调按 options.all 双形态响应
 * （all:true 要地址对象数组——实测传单值形式得 "Invalid IP address: undefined"）。 */
export function pinnedRequest(
  target: URL,
  validatedIp: string,
  options: { readonly headers?: Record<string, string>; readonly signal?: AbortSignal } = {},
): Promise<PinnedResponse> {
  const mod = target.protocol === 'https:' ? https : http
  return new Promise<PinnedResponse>((resolve, reject) => {
    const request = mod.request(target, {
      method: 'GET',
      headers: options.headers,
      signal: options.signal,
      lookup: (_hostname, lookupOptions, callback) => {
        const family = net.isIP(validatedIp) === 6 ? 6 : 4
        if (typeof lookupOptions === 'object' && lookupOptions !== null && lookupOptions.all === true) {
          callback(null, [{ address: validatedIp, family }])
        } else {
          callback(null, validatedIp, family)
        }
      },
    })
    request.on('response', stream => {
      resolve({ status: stream.statusCode ?? 0, headers: stream.headers, stream })
    })
    request.on('error', error => { reject(error) })
    request.end()
  })
}
