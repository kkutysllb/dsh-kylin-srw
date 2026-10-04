/** OpenAlex 适配器（0203 Task 2.3）：`per_page` 钳 ≤100，cursor 翻页
 * （`meta.next_cursor` 为 null/缺失即止）。归一化剥离 doi 的
 * `https://doi.org/` 前缀；OA 链接取 `open_access.oa_url`，
 * PDF 取 `best_oa_location.pdf_url`。 */

import { ServiceError } from '../service.ts'
import { gatedFetchJson } from './http.ts'
import type { RateGate } from './rate-gate.ts'
import type { LitCandidate } from './types.ts'

export const OPENALEX_API = 'https://api.openalex.org/works'
export const OPENALEX_PER_PAGE_MAX = 100

/** 剥 DOI 前缀（OpenAlex 给 `https://doi.org/10.xxxx/yy`）。 */
export function stripDoiPrefix(doi: string): string {
  return doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase()
}

/** 归一化一页 results（fixture 单测面）。 */
export function parseOpenAlexResults(results: readonly unknown[]): LitCandidate[] {
  const candidates: LitCandidate[] = []
  for (const raw of results) {
    if (typeof raw !== 'object' || raw === null) continue
    const work = raw as Record<string, unknown>
    const title = typeof work['display_name'] === 'string' ? work['display_name'] : ''
    const year = typeof work['publication_year'] === 'number' ? work['publication_year'] : 0
    if (title === '') continue
    const doiRaw = typeof work['doi'] === 'string' ? work['doi'] : undefined
    const authors: string[] = []
    if (Array.isArray(work['authorships'])) {
      for (const authorship of work['authorships']) {
        if (typeof authorship !== 'object' || authorship === null) continue
        const author = (authorship as Record<string, unknown>)['author']
        if (typeof author === 'object' && author !== null) {
          const name = (author as Record<string, unknown>)['display_name']
          if (typeof name === 'string' && name !== '') authors.push(name)
        }
      }
    }
    const oa = (typeof work['open_access'] === 'object' && work['open_access'] !== null)
      ? work['open_access'] as Record<string, unknown>
      : undefined
    const bestOa = (typeof work['best_oa_location'] === 'object' && work['best_oa_location'] !== null)
      ? work['best_oa_location'] as Record<string, unknown>
      : undefined
    const venue = (() => {
      const primary = (typeof work['primary_location'] === 'object' && work['primary_location'] !== null)
        ? work['primary_location'] as Record<string, unknown>
        : undefined
      const source = (typeof primary?.['source'] === 'object' && primary['source'] !== null)
        ? primary['source'] as Record<string, unknown>
        : undefined
      return typeof source?.['display_name'] === 'string' ? source['display_name'] : ''
    })()
    const oaUrl = typeof oa?.['oa_url'] === 'string' && oa['oa_url'] !== '' ? oa['oa_url'] : undefined
    const pdfUrl = typeof bestOa?.['pdf_url'] === 'string' && bestOa['pdf_url'] !== '' ? bestOa['pdf_url'] : undefined
    candidates.push({
      source: 'openalex',
      identity: {
        ...(doiRaw !== undefined && doiRaw !== '' ? { doi: stripDoiPrefix(doiRaw) } : {}),
        title,
        year,
      },
      authors,
      venue,
      abstract: typeof work['abstract'] === 'string' ? work['abstract'] : '',
      ...(typeof work['publication_date'] === 'string' ? { publishedAt: work['publication_date'] } : {}),
      ...(oaUrl !== undefined ? { oaUrl } : {}),
      ...(pdfUrl !== undefined ? { pdfUrl } : {}),
      ...(typeof work['cited_by_count'] === 'number' ? { citedByCount: work['cited_by_count'] } : {}),
    })
  }
  return candidates
}

interface OpenAlexPage {
  readonly meta?: { readonly next_cursor?: string | null }
  readonly results?: readonly unknown[]
}

/** 检索 URL。 */
export function searchOpenAlexUrl(query: string, perPage: number, cursor?: string): URL {
  const trimmed = query.trim()
  if (trimmed === '') throw new ServiceError('INVALID', 'OpenAlex 检索词不能为空')
  const url = new URL(OPENALEX_API)
  url.searchParams.set('search', trimmed)
  url.searchParams.set('per_page', String(Math.min(OPENALEX_PER_PAGE_MAX, Math.max(1, Math.floor(perPage)))))
  if (cursor !== undefined) url.searchParams.set('cursor', cursor)
  return url
}

export interface OpenAlexSearchDeps {
  readonly gate: RateGate
}

/** 真网检索：cursor 循环到 limit 或 next_cursor=null（每页经 RateGate）。 */
export async function searchOpenAlex(deps: OpenAlexSearchDeps, query: string, limit = 25): Promise<LitCandidate[]> {
  const all: LitCandidate[] = []
  let cursor: string | undefined
  for (;;) {
    const perPage = Math.min(OPENALEX_PER_PAGE_MAX, limit - all.length)
    const page = await gatedFetchJson<OpenAlexPage>(deps.gate, searchOpenAlexUrl(query, perPage, cursor))
    const items = parseOpenAlexResults(page.results ?? [])
    all.push(...items)
    if (all.length >= limit) return all.slice(0, limit)
    const next = page.meta?.next_cursor
    if (next === undefined || next === null || next === '' || items.length === 0) return all
    cursor = next
  }
}
