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

import { open, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { parseFetchUrl, type ResolveAddresses } from '../net/ssrf.ts'
import { addConfirmedHost } from '../workspace/root.ts'
import { citekeyOf } from './bibtex.ts'
import { gatedFetchJson } from './http.ts'
import { DEFAULT_PDF_HOSTS, fetchPdf, type FetchPdfOptions, type FetchPdfResult } from './pdf.ts'
import type { RateGate } from './rate-gate.ts'
import type { LitIdentity } from './types.ts'

/** 全文获取的最小条目面（LitEntry 结构上兼容）。 */
export interface FulltextEntry {
  readonly key: string
  readonly identity: LitIdentity
  readonly authors: readonly string[]
  readonly venue: string
  readonly abstract: string
  readonly pdfUrl?: string
  readonly oaUrl?: string
}

export interface FulltextDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: string
  readonly gate: RateGate
  /** Unpaywall 必填邮箱（root.json unpaywallEmail；缺 → 无直链时报 INVALID）。 */
  readonly unpaywallEmail?: string
  /** 已确认的出版商/仓储域（root.json fulltext.confirmedHosts）。 */
  readonly confirmedHosts?: readonly string[]
  /** 测试注入：Unpaywall JSON 取数（缺省 gatedFetchJson）。 */
  readonly fetchUnpaywallJson?: (url: URL) => Promise<unknown>
  /** 测试注入：PDF 下载（缺省 fetchPdf）。 */
  readonly download?: (
    gate: RateGate,
    url: string,
    destAbs: string,
    fs: SrwFsLike | undefined,
    rootDir: string,
    options?: FetchPdfOptions,
  ) => Promise<FetchPdfResult>
  /** 测试注入：DNS 解析（本地靶机用）。 */
  readonly resolveAddresses?: ResolveAddresses
  /** 仅测试：允许回环/私网地址（本地 http 靶）。 */
  readonly allowPrivateForTest?: boolean
  readonly maxBytes?: number
  readonly now?: () => Date
}

export type FulltextSource = 'unpaywall' | 'publisher' | 'direct'

export interface FulltextEvidence {
  readonly finalUrl: string
  readonly host: string
  readonly sha256: string
  readonly bytes: number
  readonly retrievedAt: string
  readonly source: FulltextSource
}

export interface FulltextResult {
  readonly ok: true
  readonly key: string
  readonly paperKey: string
  readonly file: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly contentType: string
  readonly host: string
  readonly finalUrl: string
  readonly source: FulltextSource
  readonly evidencePath: string
  readonly evidence: FulltextEvidence
  readonly confirmedHosts: readonly string[]
}

/** identityKey 去非法字符（`doi:10.1038/nature12373` → `doi-10-1038-nature12373`）。 */
export function keySlug(key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return slug === '' ? 'key' : slug
}

/** DOI 归一与形态校验（Unpaywall/Crossref 路径共用；非法 → INVALID）。 */
export function normalizeDoi(input: string): string {
  const trimmed = input.trim().replace(/^https?:\/\/doi\.org\//i, '')
  if (trimmed === '') throw new ServiceError('INVALID', 'DOI 不能为空')
  if (!/^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i.test(trimmed) || trimmed.includes('..')) {
    throw new ServiceError('INVALID', `DOI 形态非法：${JSON.stringify(input.slice(0, 100))}`)
  }
  return trimmed.toLowerCase()
}

/** Unpaywall URL：`https://api.unpaywall.org/v2/<doi>?email=<mailto>`。 */
export function unpaywallUrlFor(doi: string, email: string): URL {
  const address = email.trim()
  if (address === '' || !address.includes('@')) {
    throw new ServiceError('INVALID', 'Unpaywall 邮箱非法：在 <root>/.srw/root.json 配置 unpaywallEmail')
  }
  const url = new URL(`https://api.unpaywall.org/v2/${normalizeDoi(doi)}`)
  url.searchParams.set('email', address)
  return url
}

interface UnpaywallLocationLike {
  readonly url?: unknown
  readonly url_for_pdf?: unknown
  readonly pdf_url?: unknown
}

export interface UnpaywallLocation {
  readonly url: string
  readonly source: 'unpaywall'
}

export interface UnpaywallParse {
  readonly isOa: boolean
  readonly locations: readonly UnpaywallLocation[]
}

function locationUrls(location: UnpaywallLocationLike): string[] {
  const out: string[] = []
  for (const raw of [location.pdf_url, location.url_for_pdf, location.url]) {
    if (typeof raw === 'string' && /^https?:\/\//i.test(raw)) out.push(raw)
  }
  return out
}

/** 解析 Unpaywall 响应（best_oa_location 优先，其次 oa_locations）。 */
export function parseUnpaywall(payload: unknown): UnpaywallParse {
  if (typeof payload !== 'object' || payload === null) return { isOa: false, locations: [] }
  const record = payload as Record<string, unknown>
  const isOa = record['is_oa'] === true
  // 显式 closed：即使响应里残留 location 也不得当作 OA（不绕付费墙）
  if (record['is_oa'] === false) return { isOa: false, locations: [] }
  const locations: UnpaywallLocation[] = []
  const seen = new Set<string>()
  const push = (location: unknown): void => {
    if (typeof location !== 'object' || location === null) return
    for (const url of locationUrls(location as UnpaywallLocationLike)) {
      if (seen.has(url)) continue
      seen.add(url)
      locations.push({ url, source: 'unpaywall' })
    }
  }
  push(record['best_oa_location'])
  if (Array.isArray(record['oa_locations'])) {
    for (const location of record['oa_locations']) push(location)
  }
  return { isOa, locations }
}

function normalizeAllowHost(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase()
  if (trimmed === '') return undefined
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return url.hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

function pdfFilenameOf(entry: FulltextEntry): string {
  const title = entry.identity.title.trim()
  const base = title === '' ? keySlug(entry.key) : citekeyOf(entry as unknown as Parameters<typeof citekeyOf>[0])
  const safe = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()
  return `${safe === '' ? keySlug(entry.key) : safe}.pdf`
}

/** 读取文件头 5 字节（`%PDF-` 魔数门）。 */
async function readMagic(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(5)
    const { bytesRead } = await handle.read(buffer, 0, 5, 0)
    return buffer.subarray(0, bytesRead).toString('latin1')
  } finally {
    await handle.close()
  }
}

async function writeEvidence(
  deps: FulltextDeps,
  project: string,
  paperKey: string,
  evidence: FulltextEvidence,
): Promise<string> {
  const path = join(deps.rootDir, project, 'literature', 'fulltext', `${paperKey}.json`)
  await assertInsideRoot(deps.fs, deps.rootDir, path)
  await mkdir(join(path, '..'), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    await writeFile(tmp, JSON.stringify(evidence, null, 2) + '\n', 'utf8')
    await rename(tmp, path)
  } catch (error: unknown) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  return path
}

function classifyDownloadError(error: unknown): unknown {
  if (!(error instanceof ServiceError)) return error
  // 出版商 401/402/403 通常是付费墙（不是网络故障）
  if (error.code === 'UPSTREAM' && /HTTP (401|402|403)\b/.test(error.message)) {
    return new ServiceError('PAYWALLED', `目标拒绝匿名访问（付费墙）：${error.message}`)
  }
  // OA 链接过期/被移除：归 UNRESOLVED（Resolver 给出的位置无法下载）
  if (error.code === 'UPSTREAM' && /HTTP 404\b/.test(error.message)) {
    return new ServiceError('UNRESOLVED', `开放获取链接已失效（404）：${error.message}`)
  }
  return error
}

function classifyUnpaywallError(error: unknown, doi: string): unknown {
  if (!(error instanceof ServiceError)) {
    return new ServiceError('UPSTREAM', `Unpaywall 请求失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (error.code === 'UNRESOLVED' || /HTTP 404\b/.test(error.message)) {
    return new ServiceError('UNRESOLVED', `Unpaywall 无此 DOI 记录：${doi}`)
  }
  return error
}

/** 主入口：取一条全文。成功返回落盘/证据信息；失败抛稳定错误码。 */
export async function fetchFulltext(
  deps: FulltextDeps,
  project: string,
  entry: FulltextEntry | undefined,
  options: { readonly doi?: string; readonly allowHost?: string } = {},
): Promise<FulltextResult> {
  if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
  const requestedDoi = options.doi !== undefined
    ? normalizeDoi(options.doi)
    : entry?.identity.doi !== undefined
      ? normalizeDoi(entry.identity.doi)
      : entry?.identity.canonicalDoi !== undefined
        ? normalizeDoi(entry.identity.canonicalDoi)
        : undefined
  const doi = requestedDoi
  if (entry === undefined && doi === undefined) {
    throw new ServiceError('INVALID', '全文获取需要 key 或 doi')
  }
  const target: FulltextEntry = entry ?? {
    key: `doi:${doi}`,
    identity: { ...(doi === undefined ? {} : { doi }), title: '', year: 0 },
    authors: [],
    venue: '',
    abstract: '',
  }

  const direct: { url: string; source: FulltextSource }[] = []
  if (entry?.pdfUrl !== undefined && entry.pdfUrl !== '') direct.push({ url: entry.pdfUrl, source: 'direct' })
  if (entry?.oaUrl !== undefined && entry.oaUrl !== '' && entry.oaUrl !== entry.pdfUrl) {
    direct.push({ url: entry.oaUrl, source: 'publisher' })
  }

  let unpaywall: UnpaywallParse | undefined
  let unpaywallError: unknown
  if (doi !== undefined) {
    const email = deps.unpaywallEmail
    if (email === undefined || email.trim() === '') {
      if (direct.length === 0) {
        throw new ServiceError('INVALID', '未配置 Unpaywall 邮箱：在 <root>/.srw/root.json 设置 unpaywallEmail（Unpaywall 必填真实邮箱）后重试')
      }
    } else {
      try {
        const url = unpaywallUrlFor(doi, email)
        const payload = await (deps.fetchUnpaywallJson ?? (async (request: URL) => await gatedFetchJson<unknown>(deps.gate, request)))(url)
        unpaywall = parseUnpaywall(payload)
      } catch (error: unknown) {
        unpaywallError = classifyUnpaywallError(error, doi)
        if (direct.length === 0) throw unpaywallError
      }
    }
  }

  const candidates: { url: string; source: FulltextSource }[] = []
  const seenUrls = new Set<string>()
  for (const candidate of [...(unpaywall?.locations ?? []), ...direct]) {
    if (seenUrls.has(candidate.url)) continue
    seenUrls.add(candidate.url)
    candidates.push(candidate)
  }
  if (candidates.length === 0) {
    if (unpaywallError !== undefined) throw unpaywallError
    if (unpaywall?.isOa === false) {
      throw new ServiceError('PAYWALLED', `DOI ${doi ?? ''} 未开放获取（Unpaywall is_oa=false）`)
    }
    throw new ServiceError('UNRESOLVED', '没有可用的开放获取链接（Unpaywall/条目均未给 PDF）')
  }

  const parsedCandidates: { url: URL; source: FulltextSource }[] = []
  for (const candidate of candidates) {
    try {
      parsedCandidates.push({ url: parseFetchUrl(candidate.url), source: candidate.source })
    } catch { /* 坏链接跳过：不是可发起的出网目标 */ }
  }
  if (parsedCandidates.length === 0) {
    throw new ServiceError('UNRESOLVED', '开放获取链接均无法解析为 URL')
  }

  const confirmed = new Set<string>([
    ...DEFAULT_PDF_HOSTS.map(host => host.toLowerCase()),
    ...(deps.confirmedHosts ?? []).map(host => host.trim().toLowerCase()).filter(host => host !== ''),
  ])
  const allowHost = options.allowHost === undefined ? undefined : normalizeAllowHost(options.allowHost)
  if (allowHost !== undefined && parsedCandidates.some(candidate => candidate.url.hostname.toLowerCase() === allowHost)
    && !confirmed.has(allowHost)) {
    // 用户显式确认：写回 root.json，后续同域无需再次 allowHost
    await addConfirmedHost(deps.rootDir, allowHost)
    confirmed.add(allowHost)
  }

  const allowed = parsedCandidates.filter(candidate => confirmed.has(candidate.url.hostname.toLowerCase()))
  if (allowed.length === 0) {
    const hosts = [...new Set(parsedCandidates.map(candidate => candidate.url.hostname))].join(', ')
    const first = parsedCandidates[0]?.url.hostname ?? ''
    throw new ServiceError('HOST_NOT_ALLOWED',
      `PDF 域未确认：${hosts}——确认该域后重试并传 allowHost:"${first}"（会写回 root.json fulltext.confirmedHosts）`)
  }

  const now = deps.now ?? (() => new Date())
  const paperKey = keySlug(target.key)
  let lastError: unknown
  for (const candidate of allowed) {
    if (candidate.url.protocol !== 'https:' && deps.allowPrivateForTest !== true) {
      lastError = new ServiceError('HOST_NOT_ALLOWED', `全文只允许 https：${candidate.url.toString()}`)
      continue
    }
    const dest = join(deps.rootDir, project, 'literature', 'pdf', pdfFilenameOf(target))
    await assertInsideRoot(deps.fs, deps.rootDir, dest)
    const downloadOptions: FetchPdfOptions = {
      allowedHosts: confirmed,
      ...(deps.resolveAddresses === undefined ? {} : { resolveAddresses: deps.resolveAddresses }),
      ...(deps.allowPrivateForTest === true ? { allowPrivateForTest: true } : {}),
      ...(deps.maxBytes === undefined ? {} : { maxBytes: deps.maxBytes }),
    }
    try {
      const download = deps.download ?? fetchPdf
      const result = await download(deps.gate, candidate.url.toString(), dest, deps.fs, deps.rootDir, downloadOptions)
      const magic = await readMagic(dest)
      if (magic !== '%PDF-') {
        await rm(dest, { force: true }).catch(() => {})
        lastError = new ServiceError('CONTENT_NOT_PDF',
          `目标不是 PDF（magic=${JSON.stringify(magic)}，content-type=${result.contentType === '' ? 'unknown' : result.contentType}）：${candidate.url.hostname}`)
        continue
      }
      const evidence: FulltextEvidence = {
        finalUrl: candidate.url.toString(),
        host: candidate.url.hostname.toLowerCase(),
        sha256: result.sha256,
        bytes: result.bytes,
        retrievedAt: now().toISOString(),
        source: candidate.source,
      }
      const evidencePath = await writeEvidence(deps, project, paperKey, evidence)
      return {
        ok: true,
        key: target.key,
        paperKey,
        file: join(project, 'literature', 'pdf', pdfFilenameOf(target)),
        path: dest,
        sha256: result.sha256,
        bytes: result.bytes,
        contentType: result.contentType,
        host: evidence.host,
        finalUrl: evidence.finalUrl,
        source: evidence.source,
        evidencePath,
        evidence,
        confirmedHosts: [...confirmed].sort(),
      }
    } catch (error: unknown) {
      lastError = classifyDownloadError(error)
    }
  }
  if (lastError instanceof ServiceError) throw lastError
  throw new ServiceError('UPSTREAM', `全文下载失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

/** 兼容别名（调用方语义不同名，实现同一入口）。 */
export const downloadFulltext = fetchFulltext

/** 若条目 key 需要 keySlug（证据命名）——暴露给测试/服务层复用。 */
export function paperKeyOf(key: string): string {
  return keySlug(key)
}
