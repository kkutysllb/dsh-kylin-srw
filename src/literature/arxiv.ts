/** arXiv 适配器（0203 Task 2.2）：Atom 解析手写（arXiv Atom 形状稳定、
 * 无 CDATA；实体解码自实现）+ `id_list` 批量（≤100/批分片）。
 * 事实（0102 §5.3）：arXiv API 走 https 唯一——http 得空响应；所有派生
 * URL 一律 forceHttps。限速：export.arxiv.org 1 req/3s（RateGate 域表）。
 */

import { ServiceError } from '../service.ts'
import { gatedFetchText } from './http.ts'
import type { RateGate } from './rate-gate.ts'
import type { LitCandidate } from './types.ts'

export const ARXIV_API = 'https://export.arxiv.org/api/query'
/** id_list 单批上限（arXiv 文档口径）。 */
export const ARXIV_ID_BATCH = 100

/** http→https（arXiv 对 http 返回空响应；所有派生链接统一升级）。 */
export function forceHttps(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
}

/** 从 arXiv abs 链接提取 id 含版本：`…/abs/2401.12345v2` → `2401.12345v2`；
 * 老式分类 id（`cond-mat/0703123v1`）取 `/abs/` 后整体两段。 */
export function arxivIdFromUrl(idUrl: string): string {
  const marker = idUrl.indexOf('/abs/')
  if (marker === -1) {
    throw new ServiceError('UPSTREAM', `arXiv id 无法解析（无 /abs/）：${idUrl}`)
  }
  const id = idUrl.slice(marker + '/abs/'.length).replace(/\/$/, '')
  if (!/^\d{4}\.\d{4,5}(v\d+)?$/.test(id) && !/^[a-z-]+\/\d{7}(v\d+)?$/i.test(id)) {
    throw new ServiceError('UPSTREAM', `arXiv id 无法解析：${idUrl}`)
  }
  return id
}

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replaceAll(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replaceAll('&amp;', '&')
}

function clean(text: string): string {
  return decodeXmlEntities(text.replaceAll('\n', ' ').replace(/\s+/g, ' ')).trim()
}

function extract(tag: string, block: string): string | undefined {
  // 非贪婪匹配第一个完整开闭标签对；自闭合/缺失返回 undefined。
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return match === null ? undefined : clean(match[1] ?? '')
}

function extractAll(tag: string, block: string): string[] {
  const results: string[] = []
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  for (const match of block.matchAll(re)) {
    const inner = match[1]
    if (inner !== undefined) results.push(clean(inner))
  }
  return results
}

function extractAttr(tag: string, attr: string, block: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}\\s[^>]*\\b${attr}="([^"]*)"[^>]*>`))
  return match === null ? undefined : match[1]
}

/** 解析年份（published/updated 头四位）。 */
function yearOf(iso: string | undefined, fallback = 0): number {
  if (iso === undefined) return fallback
  const year = Number(iso.slice(0, 4))
  return Number.isInteger(year) ? year : fallback
}

/** 解析 Atom feed 的全部 entry（feed 头部忽略；无 entry 返回空数组）。 */
export function parseArxivAtom(xml: string): LitCandidate[] {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1] ?? '')
  const candidates: LitCandidate[] = []
  for (const block of entries) {
    const idUrl = extract('id', block)
    if (idUrl === undefined) continue
    const arxivId = arxivIdFromUrl(idUrl)
    const title = extract('title', block) ?? ''
    const published = extract('published', block)
    const updated = extract('updated', block)
    const doi = extract('arxiv:doi', block) ?? extract('doi', block)
    const pdfHref = (() => {
      const link = block.match(/<link\s[^>]*rel="related"[^>]*type="application\/pdf"[^>]*href="([^"]+)"/)
        ?? block.match(/<link\s[^>]*type="application\/pdf"[^>]*href="([^"]+)"/)
      return link === null ? undefined : forceHttps(link[1] ?? '')
    })()
    candidates.push({
      source: 'arxiv',
      identity: {
        arxivId,
        ...(doi !== undefined && doi !== '' ? { doi: doi.toLowerCase() } : {}),
        title,
        year: yearOf(published),
      },
      authors: extractAll('name', block),
      venue: 'arXiv',
      abstract: extract('summary', block) ?? '',
      ...(published !== undefined ? { publishedAt: published } : {}),
      ...(updated !== undefined ? { updatedAt: updated } : {}),
      ...(pdfHref !== undefined ? { pdfUrl: pdfHref } : {}),
    })
  }
  return candidates
}

/** 检索 URL：无字段前缀挂 all:；**带前缀的短语整体加引号**——arXiv 对
 * `ti:attention is all you need` 这类裸空格串返回 0 条（真网实测 2026-10-04），
 * 正确形态是 `ti:"..."`。AND/OR 连接词保留裸露。 */
export function searchArxivUrl(query: string, limit: number): URL {
  const trimmed = query.trim()
  if (trimmed === '') throw new ServiceError('INVALID', 'arXiv 检索词不能为空')
  const fieldQuery = arxivQueryField(trimmed)
  const url = new URL(ARXIV_API)
  url.searchParams.set('search_query', fieldQuery)
  url.searchParams.set('max_results', String(Math.min(200, Math.max(1, Math.floor(limit)))))
  return url
}

/** 构造 arXiv search_query：字段前缀后的短语加引号；AND/OR/ANDNOT 连接词
 * 按子句逐段处理。 */
export function arxivQueryField(trimmed: string): string {
  const clauses = trimmed.split(/\s+(AND|OR|ANDNOT)\s+/i)
  return clauses.map((clause) => {
    if (clause === 'AND' || clause === 'OR' || clause === 'ANDNOT') return clause
    const match = clause.match(/^(all|ti|au|abs|cat|id):\s*(.*)$/i)
    if (match === null) return `all:"${clause.trim()}"`
    const prefix = match[1] ?? 'all'
    const rest = (match[2] ?? '').trim()
    if (rest === '') return `${prefix}:"*"`
    // 已带引号则原样
    if (rest.startsWith('"') && rest.endsWith('"')) return `${prefix}:${rest}`
    return `${prefix}:"${rest}"`
  }).join(' ')
}

/** id_list 批量 URL：≤100/批由调用方分片（本函数只负责拼）。 */
export function fetchByIdsUrl(ids: readonly string[]): URL {
  if (ids.length === 0) throw new ServiceError('INVALID', 'id_list 不能为空')
  if (ids.length > ARXIV_ID_BATCH) {
    throw new ServiceError('INVALID', `id_list 单批 ≤${ARXIV_ID_BATCH}，收到 ${ids.length}`)
  }
  const url = new URL(ARXIV_API)
  url.searchParams.set('id_list', ids.join(','))
  url.searchParams.set('max_results', String(ids.length))
  return url
}

/** id_list 分片。 */
export function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += ARXIV_ID_BATCH) {
    chunks.push(ids.slice(i, i + ARXIV_ID_BATCH))
  }
  return chunks
}

export interface ArxivSearchDeps {
  readonly gate: RateGate
}

/** 真网检索（fixture 测试打 parseArxivAtom；此函数只做装配）。 */
export async function searchArxiv(deps: ArxivSearchDeps, query: string, limit = 20): Promise<LitCandidate[]> {
  const xml = await gatedFetchText(deps.gate, searchArxivUrl(query, limit))
  return parseArxivAtom(xml)
}

/** 批量按 id 取（自动分片，多批串行——RateGate 本就要求串行礼貌）。 */
export async function fetchArxivByIds(deps: ArxivSearchDeps, ids: readonly string[]): Promise<LitCandidate[]> {
  const all: LitCandidate[] = []
  for (const chunk of chunkIds(ids)) {
    const xml = await gatedFetchText(deps.gate, fetchByIdsUrl(chunk))
    all.push(...parseArxivAtom(xml))
  }
  return all
}
