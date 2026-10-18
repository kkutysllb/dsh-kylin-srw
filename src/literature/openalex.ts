/** OpenAlex 适配器（0203 Task 2.3）：`per_page` 钳 ≤100，cursor 翻页
 * （`meta.next_cursor` 为 null/缺失即止）。归一化剥离 doi 的
 * `https://doi.org/` 前缀；OA 链接取 `open_access.oa_url`，
 * PDF 取 `best_oa_location.pdf_url`；摘要优先明文 `abstract`，否则按
 * `abstract_inverted_index` 的 position 还原；消费 `is_retracted` 与
 * `id`（剥 `https://openalex.org/` 前缀存 openalexId）。 */

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

/** 剥 OpenAlex Work id 的 `https://openalex.org/` 前缀（已裸 id 原样返回）。 */
export function stripOpenAlexIdPrefix(id: string): string {
  return id.trim().replace(/^https?:\/\/openalex\.org\//i, '')
}

/** 从 `abstract_inverted_index`（`{word: [positions…]}`）按 position 升序
 * 还原摘要（空格连接）。真实 API 只给这个字段，之前只读 `abstract` 导致摘要
 * 恒空（P0-4）。容忍 null/数组/非对象/坏位置：坏词丢弃、不抛；无可用位置
 * 时返回空串。 */
export function abstractFromInvertedIndex(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const words: Array<{ position: number; word: string }> = []
  for (const [word, rawPositions] of Object.entries(value as Record<string, unknown>)) {
    if (word === '' || !Array.isArray(rawPositions)) continue
    for (const raw of rawPositions) {
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) continue
      words.push({ position: raw, word })
    }
  }
  words.sort((a, b) => a.position - b.position)
  return words.map(item => item.word).join(' ')
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
    // 真实 API 通常只有 abstract_inverted_index；两字段都在时明文 abstract 优先。
    const plainAbstract = typeof work['abstract'] === 'string' && work['abstract'].trim() !== '' ? work['abstract'] : ''
    const abstract = plainAbstract !== '' ? plainAbstract : abstractFromInvertedIndex(work['abstract_inverted_index'])
    const openalexId = typeof work['id'] === 'string' ? stripOpenAlexIdPrefix(work['id']) : ''
    const retracted = work['is_retracted']
    candidates.push({
      source: 'openalex',
      identity: {
        ...(doiRaw !== undefined && doiRaw !== '' ? { doi: stripDoiPrefix(doiRaw) } : {}),
        title,
        year,
      },
      authors,
      venue,
      abstract,
      ...(openalexId !== '' ? { openalexId } : {}),
      ...(typeof retracted === 'boolean' ? { retracted } : {}),
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
