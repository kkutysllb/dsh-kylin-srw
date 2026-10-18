/** Crossref 适配器（0203 Task 2.4）：礼貌池（`mailto` 参数，来自 config
 * `politeMailto`）+ DOI 解析（404 → UNRESOLVED）。归一化 `message` 内层。 */

import { ServiceError } from '../service.ts'
import { withDeadline } from '../net/deadline.ts'
import { gatedFetchJson } from './http.ts'
import type { RateGate } from './rate-gate.ts'
import type { LitCandidate } from './types.ts'

export const CROSSREF_API = 'https://api.crossref.org/works'
/** P0-6：DOI 校验单跳 deadline（无 UA 的裸 fetch 既慢又易被礼貌池忽略）。 */
const DOI_RESOLVE_DEADLINE_MS = 10_000
const USER_AGENT = 'dsh-kylin-srw/0.0.1 (research workbench plugin)'

function familyName(author: unknown): string | undefined {
  if (typeof author !== 'object' || author === null) return undefined
  const a = author as Record<string, unknown>
  if (typeof a['family'] === 'string' && a['family'] !== '') return a['family']
  if (typeof a['name'] === 'string' && a['name'] !== '') return a['name']
  return undefined
}

function yearOfIssued(message: Record<string, unknown>): number {
  const issued = message['issued']
  const parts = (typeof issued === 'object' && issued !== null && Array.isArray((issued as Record<string, unknown>)['date-parts']))
    ? ((issued as Record<string, unknown>)['date-parts'] as unknown[])[0]
    : undefined
  const year = Array.isArray(parts) ? parts[0] : undefined
  return typeof year === 'number' ? year : 0
}

/** 归一化一条 Crossref work message。 */
export function parseCrossrefWork(message: Record<string, unknown>): LitCandidate {
  const doi = typeof message['DOI'] === 'string' ? message['DOI'].toLowerCase() : ''
  const title = Array.isArray(message['title']) && typeof message['title'][0] === 'string'
    ? message['title'][0]
    : ''
  const venue = Array.isArray(message['container-title']) && typeof message['container-title'][0] === 'string'
    ? message['container-title'][0]
    : ''
  const authors = Array.isArray(message['author'])
    ? message['author'].map(familyName).filter((n): n is string => n !== undefined)
    : []
  const published = (() => {
    const issued = message['issued']
    const parts = (typeof issued === 'object' && issued !== null && Array.isArray((issued as Record<string, unknown>)['date-parts']))
      ? ((issued as Record<string, unknown>)['date-parts'] as unknown[])[0]
      : undefined
    return Array.isArray(parts) && typeof parts[0] === 'number'
      ? `${parts[0]}-${String(parts[1] ?? 1).padStart(2, '0')}-${String(parts[2] ?? 1).padStart(2, '0')}`
      : undefined
  })()
  return {
    source: 'crossref',
    identity: {
      ...(doi !== '' ? { doi } : {}),
      title,
      year: yearOfIssued(message),
    },
    authors,
    venue,
    abstract: typeof message['abstract'] === 'string' ? message['abstract'] : '',
    ...(published !== undefined ? { publishedAt: published } : {}),
    // Crossref 一般不直接给开放 PDF；OA 链接交给 OpenAlex/arXiv 补
  }
}

/** 检索 URL（礼貌 mailto）。 */
export function searchCrossrefUrl(query: string, rows: number, mailto?: string): URL {
  const trimmed = query.trim()
  if (trimmed === '') throw new ServiceError('INVALID', 'Crossref 检索词不能为空')
  const url = new URL(CROSSREF_API)
  url.searchParams.set('query', trimmed)
  url.searchParams.set('rows', String(Math.min(100, Math.max(1, Math.floor(rows)))))
  if (mailto !== undefined && mailto !== '') url.searchParams.set('mailto', mailto)
  return url
}

/** DOI 解析 URL。 */
export function resolveDoiUrl(doi: string, mailto?: string): URL {
  const trimmed = doi.trim().replace(/^https?:\/\/doi\.org\//i, '')
  if (trimmed === '') throw new ServiceError('INVALID', 'DOI 不能为空')
  const url = new URL(`${CROSSREF_API}/${encodeURIComponent(trimmed)}`)
  if (mailto !== undefined && mailto !== '') url.searchParams.set('mailto', mailto)
  return url
}

export interface CrossrefSearchDeps {
  readonly gate: RateGate
  /** 礼貌池邮箱（缺省可用但享受不到 faster pool）。 */
  readonly mailto?: string
}

interface CrossrefEnvelope {
  readonly status?: string
  readonly message?: unknown
}

/** 真网检索。 */
export async function searchCrossref(deps: CrossrefSearchDeps, query: string, limit = 20): Promise<LitCandidate[]> {
  const envelope = await gatedFetchJson<CrossrefEnvelope>(deps.gate, searchCrossrefUrl(query, limit, deps.mailto))
  const items = (typeof envelope.message === 'object' && envelope.message !== null
    && Array.isArray((envelope.message as Record<string, unknown>)['items']))
    ? (envelope.message as Record<string, unknown>)['items'] as unknown[]
    : []
  return items
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(parseCrossrefWork)
}

/** DOI 解析：404 → UNRESOLVED（假 DOI 判定）。 */
export async function resolveDoi(deps: CrossrefSearchDeps, doi: string): Promise<LitCandidate> {
  const url = resolveDoiUrl(doi, deps.mailto)
  const domain = url.hostname
  await deps.gate.acquire(domain)
  const response = await withDeadline(DOI_RESOLVE_DEADLINE_MS, async signal =>
    await fetch(url, {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': USER_AGENT },
    })).catch((error: unknown) => {
    if (error instanceof ServiceError) throw error
    throw new ServiceError('UPSTREAM', `DOI 解析请求失败（${error instanceof Error ? error.message : String(error)}）`)
  })
  if (response.status === 404) {
    throw new ServiceError('UNRESOLVED', `DOI 无法解析（404）：${doi}`)
  }
  if (response.status === 429 || response.status === 503) {
    const retryAfter = Number(response.headers.get('retry-after'))
    await deps.gate.reportFailure(domain, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined)
    throw new ServiceError('RATE_LIMITED', `Crossref 限流（HTTP ${response.status}）`)
  }
  if (!response.ok) throw new ServiceError('UPSTREAM', `Crossref 返回 HTTP ${response.status}`)
  await deps.gate.reportSuccess(domain)
  const text = await response.text()
  let envelope: CrossrefEnvelope
  try {
    envelope = JSON.parse(text) as CrossrefEnvelope
  } catch {
    throw new ServiceError('UPSTREAM', 'Crossref 返回的不是合法 JSON')
  }
  if (typeof envelope.message !== 'object' || envelope.message === null) {
    throw new ServiceError('UPSTREAM', 'Crossref 响应缺 message')
  }
  return parseCrossrefWork(envelope.message as Record<string, unknown>)
}