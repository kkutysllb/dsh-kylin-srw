/** PDF 获取（0203 Task 2.7）：白名单域 + SSRF 三步逐跳重验 + 跨源重定向
 * 拒绝 + 字节上限流式落盘 + sha256。流式写 tmp、校验通过后 rename。
 * `allowPrivateForTest` 仅供本地回环测试降级（产品代码绝不传）。 */

import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { withDeadline } from '../net/deadline.ts'
import {
  assertWhitelisted,
  isAllowedRedirect,
  parseFetchUrl,
  pinnedRequest,
  resolvePublicAddresses,
  type ResolveAddresses,
} from '../net/ssrf.ts'
import type { RateGate } from './rate-gate.ts'

/** 出网字节上限：200 MiB（arXiv PDF 现实上限的宽松余量）。 */
export const PDF_MAX_BYTES = 200 * 1024 * 1024
const PDF_DEADLINE_MS = 120_000
const MAX_REDIRECTS = 5

export const DEFAULT_PDF_HOSTS: readonly string[] = [
  'export.arxiv.org',
  'arxiv.org',
  'api.openalex.org',
  'api.crossref.org',
  'data.crossref.org',
]

export interface FetchPdfOptions {
  readonly allowedHosts?: ReadonlySet<string>
  readonly maxBytes?: number
  readonly resolveAddresses?: ResolveAddresses
  /** 仅测试：允许回环/私网地址（本地 http 服务器靶）。 */
  readonly allowPrivateForTest?: boolean
}

export interface FetchPdfResult {
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly contentType: string
}

function hostsFor(options: FetchPdfOptions): ReadonlySet<string> {
  return options.allowedHosts ?? new Set(DEFAULT_PDF_HOSTS)
}

/** 单跳获取（GET），返回响应流；429/503 上报 RateGate。
 * 3xx 抛出携带响应的标记对象，由 openFollowingRedirects 处理。 */
async function openStream(
  gate: RateGate,
  target: URL,
  options: FetchPdfOptions,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; stream: IncomingMessage }> {
  const domain = target.hostname
  await gate.acquire(domain)
  const addresses = await resolvePublicAddresses(domain, options.resolveAddresses, { allowPrivate: options.allowPrivateForTest === true })
  let response: Awaited<ReturnType<typeof pinnedRequest>>
  try {
    response = await withDeadline(PDF_DEADLINE_MS, signal => pinnedRequest(target, addresses[0] ?? '', { signal }))
  } catch (error: unknown) {
    if (error instanceof ServiceError) throw error
    throw new ServiceError('UPSTREAM', `PDF 请求失败：${domain}（${error instanceof Error ? error.message : String(error)}）`)
  }
  if (response.status === 429 || response.status === 503) {
    const retryAfter = response.headers['retry-after']
    const seconds = Array.isArray(retryAfter) ? Number(retryAfter[0]) : Number(retryAfter)
    await gate.reportFailure(domain, Number.isFinite(seconds) && seconds > 0 ? seconds : undefined)
    throw new ServiceError('RATE_LIMITED', `${domain} 限流（HTTP ${response.status}）`)
  }
  if (response.status >= 300 && response.status < 400) {
    throw response as unknown as Error // 重定向由调用方处理（携带响应取 location）
  }
  if (response.status !== 200) {
    throw new ServiceError('UPSTREAM', `${domain} 返回 HTTP ${response.status}`)
  }
  await gate.reportSuccess(domain)
  return response
}

/** 跟随重定向获取最终 200 响应；每跳 parseFetchUrl→白名单→公网校验。 */
async function openFollowingRedirects(
  gate: RateGate,
  startUrl: URL,
  options: FetchPdfOptions,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; stream: IncomingMessage }> {
  const hosts = hostsFor(options)
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertWhitelisted(current.hostname, hosts)
    try {
      return await openStream(gate, current, options)
    } catch (error: unknown) {
      if (!(error instanceof Object) || !('status' in error) || typeof (error as { status: unknown }).status !== 'number'
        || ((error as { status: number }).status < 300 || (error as { status: number }).status >= 400)) {
        throw error
      }
      const redirectResponse = error as unknown as { status: number; headers: Record<string, string | string[] | undefined>; stream: IncomingMessage }
      redirectResponse.stream.destroy()
      if (hop === MAX_REDIRECTS) {
        throw new ServiceError('UPSTREAM', `重定向次数超限（>${MAX_REDIRECTS}）`)
      }
      const locationRaw = redirectResponse.headers['location']
      const location = Array.isArray(locationRaw) ? locationRaw[0] : locationRaw
      if (location === undefined || location === '') {
        throw new ServiceError('UPSTREAM', `HTTP ${redirectResponse.status} 缺 Location`)
      }
      const next = parseFetchUrl(new URL(location, current).toString())
      if (!isAllowedRedirect(current, next)) {
        throw new ServiceError('SSRF_BLOCKED', `跨源重定向被拒绝：${current.origin} → ${next.origin}`)
      }
      current = next
    }
  }
  throw new ServiceError('UPSTREAM', 'unreachable')
}

/** 主入口：下载 → 流式落盘（tmp）→ sha256 → rename。 */
export async function fetchPdf(
  gate: RateGate,
  rawUrl: string,
  destAbs: string,
  fs: SrwFsLike | undefined,
  rootDir: string,
  options: FetchPdfOptions = {},
): Promise<FetchPdfResult> {
  const startUrl = parseFetchUrl(rawUrl)
  await assertInsideRoot(fs, rootDir, destAbs)
  const maxBytes = options.maxBytes ?? PDF_MAX_BYTES

  const response = await openFollowingRedirects(gate, startUrl, options)
  const contentTypeHeader = response.headers['content-type']
  const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] ?? '' : contentTypeHeader ?? ''

  await mkdir(dirname(destAbs), { recursive: true })
  const tmp = `${destAbs}.srw-tmp-${process.pid}-${Date.now().toString(36)}`
  const hash = createHash('sha256')
  let total = 0

  try {
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmp)
      response.stream.on('data', (chunk: Buffer | string) => {
        total += chunk.length
        if (total > maxBytes) {
          response.stream.destroy()
          out.destroy()
          reject(new ServiceError('SIZE_LIMIT', `PDF 超过字节上限（>${maxBytes}）`))
          return
        }
        hash.update(chunk)
        out.write(chunk)
      })
      response.stream.on('error', reject)
      response.stream.on('end', () => { out.end(() => { resolve() }) })
      out.on('error', reject)
    })
  } catch (error: unknown) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  if (total === 0) {
    await rm(tmp, { force: true }).catch(() => {})
    throw new ServiceError('UPSTREAM', 'PDF 响应为空')
  }
  await rename(tmp, destAbs)
  return { path: destAbs, sha256: hash.digest('hex'), bytes: total, contentType }
}

/** 按候选链接顺序尝试（pdfUrl 优先，其次 oaUrl）。 */
export async function fetchPdfFor(
  gate: RateGate,
  urls: readonly (string | undefined)[],
  destAbs: string,
  fs: SrwFsLike | undefined,
  rootDir: string,
  options: FetchPdfOptions = {},
): Promise<FetchPdfResult> {
  let lastError: unknown
  for (const url of urls) {
    if (url === undefined || url === '') continue
    try {
      return await fetchPdf(gate, url, destAbs, fs, rootDir, options)
    } catch (error: unknown) {
      lastError = error
    }
  }
  if (lastError !== undefined) throw lastError
  throw new ServiceError('NO_PDF', '条目没有可用的 PDF 链接（pdfUrl/oaUrl 均缺省）')
}

/** 文件存在探测（视图层 has-pdf 回填判断）。 */
export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath)
    return true
  } catch {
    return false
  }
}
