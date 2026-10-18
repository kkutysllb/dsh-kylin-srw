/** 条目身份与去重（0203 Task 2.5 / P0-3）：
 * 三级 fallback——DOI → arXiv id → **title 弱键（不含 year）**。
 *
 * P0-3 两个修正：
 * 1. title 键去掉 year——同一篇论文在不同源/不同快照的 year 可能为 0 或漂移，
 *    旧键 `title:<sha1>:<year>` 会永久两键；新键 `title:<sha1>`。
 * 2. 弱键合并加守卫——标题键相同还不足以判同文：作者（任一重合）或 year
 *    相差 ≤1 或 venue 相同才算同文；否则在合并输出里保留两条（不同 key），
 *    等人工确认（possibleDuplicate 关系本轮不做）。
 *
 * arXiv 自赋 DOI 折叠为 arxivId 时把原 DOI 保留在 `identity.canonicalDoi`，
 * 避免 BibTeX/引用丢失 DOI。纯函数，无 I/O。
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

/** 标题弱键（P0-3：不再拼 year）。 */
function titleKeyOf(title: string): string {
  const digest = createHash('sha1').update(normalizeTitle(title)).digest('hex').slice(0, 16)
  return `title:${digest}`
}

/** 身份键（三级 fallback 的最高可用级）。 */
export function identityKey(identity: LitIdentity): string {
  const normalized = normalizeIdentity(identity)
  if (normalized.doi !== undefined && normalized.doi !== '') return `doi:${normalized.doi.toLowerCase()}`
  if (normalized.arxivId !== undefined && normalized.arxivId !== '') {
    // arXiv id 归并到**不带版本**——v1/v2 是同一篇的不同快照，合并取最新
    return `arxiv:${normalized.arxivId.replace(/v\d+$/, '').toLowerCase()}`
  }
  return titleKeyOf(normalized.title)
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

/** 身份归一：arXiv 自赋 DOI 折叠为 arxivId；原 DOI 保留到 `canonicalDoi`
 * （P0-3：DOI 不再丢，BibTeX/全文解析可回取）。import 校验层与 identityKey
 * 双端调用：存储带净身份，存量旧键也能合并。 */
export function normalizeIdentity(identity: LitIdentity): LitIdentity {
  if (identity.doi === undefined) return identity
  const folded = arxivIdFromArxivDoi(identity.doi)
  if (folded === undefined) return identity
  const arxivId = identity.arxivId ?? folded
  const canonicalDoi = identity.canonicalDoi ?? identity.doi
  return {
    ...(arxivId !== '' ? { arxivId } : {}),
    title: identity.title,
    year: identity.year,
    ...(canonicalDoi !== '' ? { canonicalDoi } : {}),
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
  if (candidate.identity.canonicalDoi !== undefined) score += 1
  return score
}

/** 合并守卫的输入面（库条目/候选都满足）。 */
export interface WorkLike {
  readonly identity: LitIdentity
  readonly authors?: readonly string[]
  readonly venue?: string
}

function normalizedWords(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedVenue(venue: string | undefined): string {
  return normalizedWords(venue ?? '')
}

function normalizedPerson(name: string): string {
  return normalizedWords(name)
}

/** 作者「任一重合」：全名相同，或一方只有姓（Crossref 只留 family）且与对方
 * 的最后一个词相同。避免把常见姓相同但名不同的两位作者判成同一人。 */
function authorOverlap(left: readonly string[], right: readonly string[]): boolean {
  for (const a of left) {
    const na = normalizedPerson(a)
    if (na === '') continue
    const aParts = na.split(' ')
    for (const b of right) {
      const nb = normalizedPerson(b)
      if (nb === '') continue
      if (na === nb) return true
      const bParts = nb.split(' ')
      if (aParts.length === 1 && aParts[0] === bParts[bParts.length - 1]) return true
      if (bParts.length === 1 && bParts[0] === aParts[aParts.length - 1]) return true
    }
  }
  return false
}

/** P0-3 弱键合并守卫：作者任一重合 / year 差 ≤1 / venue 相同 → 判同文。
 * 年份未知（0）视为同文（无法区分时宁可先合并，迁移时会报告冲突供复核）。 */
export function sameWork(left: WorkLike, right: WorkLike): boolean {
  const yearLeft = left.identity.year
  const yearRight = right.identity.year
  if (yearLeft > 0 && yearRight > 0 && Math.abs(yearLeft - yearRight) <= 1) return true
  if (yearLeft === 0 && yearRight === 0) return true
  const venueLeft = normalizedVenue(left.venue)
  if (venueLeft !== '' && venueLeft === normalizedVenue(right.venue)) return true
  return authorOverlap(left.authors ?? [], right.authors ?? [])
}

/** 已入库条目的最小形状（library.ts 的 entries 值）。
 * `key` 是库内实际键（迁移前可能是旧 `title:<sha1>:<year>` 键）——
 * upsert 匹配用**重算后的 identityKey**，命中后回写到的却是实际键。 */
export interface ExistingLike extends WorkLike {
  readonly seenIn: readonly string[]
  readonly key?: string
}

export interface MergeReport {
  /** 去重后的新条目（不与 existing 重复；seenIn 为命中的源列表）。
   * `key` 是库内应使用的键：非标题键 = identityKey；标题键冲突时带稳定
   * 判别后缀（`title:<sha1>:<year+venue hash>`），保证两条不同论文不互相覆盖。 */
  readonly fresh: readonly (LitCandidate & { readonly seenIn: readonly string[]; readonly key: string })[]
  /** 每条输入的判定：`new` 新增 / `duplicate:<key>` 与本批或库内重复 /
   * `merged:<key>` 批内合并；`key` 是该输入最终归属的库内键。 */
  readonly verdicts: readonly {
    readonly source: string
    readonly title: string
    readonly verdict: string
    readonly key: string
  }[]
}

/** 标题键冲突时给第二条不同论文的稳定判别键：year + 归一 venue 的短哈希。
 * 守卫失败意味着 year 差 >1 **且** venue 不同——该二元组足以区分冲突簇。 */
function titleDiscriminator(candidate: WorkLike): string {
  const digest = createHash('sha1')
    .update(`${candidate.identity.year}|${normalizedVenue(candidate.venue)}`)
    .digest('hex')
    .slice(0, 8)
  return digest
}

/** 标题键冲突时的稳定判别键（迁移/库存储共用）：base 未被占用则返回 base，
 * 否则返回 `title:<sha1>:<year+venue hash>`（重复冲突再加 -2/-3）。 */
export function disambiguatedTitleKey(
  identity: LitIdentity,
  venue: string | undefined,
  taken: ReadonlySet<string>,
): string {
  return assignKey(titleKeyOf(identity.title), { identity, ...(venue === undefined ? {} : { venue }) }, taken)
}

function assignKey(
  base: string,
  candidate: WorkLike,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(base)) return base
  const discriminator = titleDiscriminator(candidate)
  let key = `${base}:${discriminator}`
  let suffix = 2
  while (taken.has(key)) {
    key = `${base}:${discriminator}-${suffix}`
    suffix += 1
  }
  return key
}

/** 把新候选并入批内已存在条目：信息量择优 + 保留源侧标记（openalexId/
 * retracted/canonicalDoi/年份治愈）。 */
function mergePair(
  target: LitCandidate & { seenIn: string[]; key: string },
  candidate: LitCandidate,
): LitCandidate & { seenIn: string[]; key: string } {
  const winner = completeness(candidate) >= completeness(target) ? candidate : target
  const loser = winner === candidate ? target : candidate
  const mergedIdentity: LitIdentity = {
    ...winner.identity,
    ...(winner.identity.year === 0 && loser.identity.year > 0 ? { year: loser.identity.year } : {}),
    ...(winner.identity.canonicalDoi === undefined && loser.identity.canonicalDoi !== undefined
      ? { canonicalDoi: loser.identity.canonicalDoi }
      : {}),
  }
  const mergedOpenalexId = target.openalexId ?? candidate.openalexId
  const mergedRetracted = target.retracted === true || candidate.retracted === true
    ? true
    : candidate.retracted ?? target.retracted
  return {
    ...winner,
    identity: mergedIdentity,
    // 首个来源保持稳定（跨源合并的 provenance 以先到者为主）
    source: target.source,
    seenIn: [...new Set([...target.seenIn, candidate.source])],
    key: target.key,
    ...(mergedOpenalexId === undefined ? {} : { openalexId: mergedOpenalexId }),
    ...(mergedRetracted === undefined ? {} : { retracted: mergedRetracted }),
  }
}

/** 批内合并 + 与库内既有条目去重。
 * - 强键（DOI/arXiv）：同 key 即同文（信息择优 / 记 duplicate）；
 * - 弱键（title）：同 key 还要过 `sameWork` 守卫；守卫失败 → 新条目 + 判别键；
 * - 与 existing 匹配按**重算后的 identityKey**（P0-3 迁移前旧键也能命中）。
 */
export function mergeInto(
  candidates: readonly LitCandidate[],
  existing: readonly ExistingLike[] = [],
): MergeReport {
  type Merged = LitCandidate & { seenIn: string[]; key: string }
  const existingGroups = new Map<string, ExistingLike[]>()
  const taken = new Set<string>()
  for (const item of existing) {
    const base = identityKey(item.identity)
    const group = existingGroups.get(base) ?? []
    group.push(item)
    existingGroups.set(base, group)
    taken.add(item.key ?? base)
  }

  const fresh: Merged[] = []
  const freshByBase = new Map<string, Merged[]>()
  const verdicts: MergeReport['verdicts'][number][] = []

  const existingMatch = (candidate: LitCandidate, base: string): ExistingLike | undefined => {
    const group = existingGroups.get(base)
    if (group === undefined || group.length === 0) return undefined
    // 强键不需要守卫：同 DOI/同 arXiv id 就是同文
    if (!base.startsWith('title:')) return group[0]
    return group.find(item => sameWork(candidate, item))
  }

  for (const candidate of candidates) {
    const base = identityKey(candidate.identity)
    const duplicate = existingMatch(candidate, base)
    if (duplicate !== undefined) {
      const key = duplicate.key ?? base
      verdicts.push({ source: candidate.source, title: candidate.identity.title, verdict: `duplicate:${key}`, key })
      continue
    }

    let matched: Merged | undefined
    if (base.startsWith('title:')) {
      matched = (freshByBase.get(base) ?? []).find(item => sameWork(candidate, item))
    } else {
      matched = fresh.find(item => item.key === base)
    }
    if (matched !== undefined) {
      const merged = mergePair(matched, candidate)
      const index = fresh.indexOf(matched)
      if (index >= 0) fresh[index] = merged
      const group = freshByBase.get(base)
      if (group !== undefined) {
        const groupIndex = group.indexOf(matched)
        if (groupIndex >= 0) group[groupIndex] = merged
      }
      verdicts.push({ source: candidate.source, title: candidate.identity.title, verdict: `merged:${merged.key}`, key: merged.key })
      continue
    }

    const key = assignKey(base, candidate, taken)
    taken.add(key)
    const item: Merged = { ...candidate, seenIn: [candidate.source], key }
    fresh.push(item)
    if (base.startsWith('title:')) {
      const group = freshByBase.get(base) ?? []
      group.push(item)
      freshByBase.set(base, group)
    }
    verdicts.push({ source: candidate.source, title: candidate.identity.title, verdict: `new:${key}`, key })
  }

  return { fresh, verdicts }
}
