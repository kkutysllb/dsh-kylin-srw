/** 条目身份与去重（0203 Task 2.5）：三级 fallback——DOI → arXiv id →
 * (title 归一化 + year)。同文多源命中合并为一条（信息择优 + seenIn 累积）。
 * 纯函数，无 I/O。
 */

import { createHash } from 'node:crypto'
import type { LitCandidate, LitIdentity } from './types.ts'

/** 标题归一：NFKC → 折叠空白 → 去标点（保留字母数字与 CJK）→ casefold。 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .toLowerCase()
}

/** 身份键（三级 fallback 的最高可用级）。 */
export function identityKey(identity: LitIdentity): string {
  const normalized = normalizeIdentity(identity)
  if (normalized.doi !== undefined && normalized.doi !== '') return `doi:${normalized.doi.toLowerCase()}`
  if (normalized.arxivId !== undefined && normalized.arxivId !== '') {
    // arXiv id 归并到**不带版本**——v1/v2 是同一篇的不同快照，合并取最新
    return `arxiv:${normalized.arxivId.replace(/v\d+$/, '').toLowerCase()}`
  }
  const title = normalizeTitle(normalized.title)
  const digest = createHash('sha1').update(title).digest('hex').slice(0, 16)
  return `title:${digest}:${normalized.year}`
}

const ARXIV_DOI_RE = /^10\.48550\/arxiv\.(.+)$/i

/** arXiv 自赋 DOI（`10.48550/arxiv.<id>`，该前缀专属 arXiv）→ 抽出 arXiv id；
 * 其余 DOI 返回 undefined。跨源去重的前提：openalex/crossref 给的是 DOI 形态，
 * arXiv 源给的是 id 形态，不折叠则同文两键（2026-10-05 桌面端实测踩中）。 */
export function arxivIdFromArxivDoi(doi: string): string | undefined {
  const match = doi.match(ARXIV_DOI_RE)
  const id = match?.[1]?.toLowerCase().replace(/\/$/, '')
  return id !== undefined && id !== '' ? id : undefined
}

/** 身份归一：arXiv 自赋 DOI 折叠为 arxivId（doi 键被丢——同物异形）。
 * import 校验层与 identityKey 双端调用：存储带净身份，存量旧键也能合并。 */
export function normalizeIdentity(identity: LitIdentity): LitIdentity {
  const folded = identity.doi !== undefined ? arxivIdFromArxivDoi(identity.doi) : undefined
  if (folded === undefined) return identity
  return {
    arxivId: identity.arxivId ?? folded,
    title: identity.title,
    year: identity.year,
  }
}

/** 合并时的「信息量」评分：字段越多越优。 */
function completeness(candidate: LitCandidate): number {
  let score = 0
  if (candidate.pdfUrl !== undefined) score += 4
  if (candidate.oaUrl !== undefined) score += 3
  if (candidate.abstract !== '') score += 2
  if (candidate.authors.length > 0) score += 1
  if (candidate.venue !== '') score += 1
  if (candidate.publishedAt !== undefined) score += 1
  if (candidate.citedByCount !== undefined) score += 1
  return score
}

/** 已入库条目的最小形状（library.ts 的 entries 值）——这里只用到身份与 seenIn。 */
export interface ExistingLike {
  readonly identity: LitIdentity
  readonly seenIn: readonly string[]
}

export interface MergeReport {
  /** 去重后的新条目（不与 existing 重复；seenIn 为命中的源列表）。 */
  readonly fresh: readonly (LitCandidate & { readonly seenIn: readonly string[] })[]
  /** 每条输入的判定：`new` 新增 / `duplicate:<key>` 与本批或库内重复。 */
  readonly verdicts: readonly { readonly source: string; readonly title: string; readonly verdict: string }[]
}

/** 批内合并 + 与库内既有条目去重。
 * - 批内同 key：择优（信息量分高者），seenIn 并集；
 * - 与 existing 同 key：记 duplicate，不入 fresh。
 */
export function mergeInto(candidates: readonly LitCandidate[], existing: readonly ExistingLike[] = []): MergeReport {
  const existingKeys = new Set(existing.map(item => identityKey(item.identity)))
  const byKey = new Map<string, LitCandidate & { seenIn: string[] }>()
  const verdicts: MergeReport['verdicts'][number][] = []

  for (const candidate of candidates) {
    const key = identityKey(candidate.identity)
    if (existingKeys.has(key)) {
      verdicts.push({ source: candidate.source, title: candidate.identity.title, verdict: `duplicate:${key}` })
      continue
    }
    const seen = byKey.get(key)
    if (seen === undefined) {
      byKey.set(key, { ...candidate, seenIn: [candidate.source] })
      verdicts.push({ source: candidate.source, title: candidate.identity.title, verdict: `new:${key}` })
      continue
    }
    // 批内同文：信息量择优；seenIn 并集；同分保后到者（可能字段更全的源在后面）
    seen.seenIn = [...new Set([...seen.seenIn, candidate.source])]
    if (completeness(candidate) >= completeness(seen)) {
      const { source, ...rest } = candidate
      byKey.set(key, { ...rest, source: seen.source, seenIn: seen.seenIn })
    }
    verdicts.push({ source: candidate.source, title: candidate.identity.title, verdict: `merged:${key}` })
  }

  const fresh = [...byKey.values()]
  return { fresh, verdicts }
}
