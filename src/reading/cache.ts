/** 翻译缓存（0205 Task 4.5 / R6）：cacheKey = sha256(target + model +
 * srcHash + glossaryHash)——四元组任一变化即 miss；改术语表**定向失效**
 * 受影响块（不是全量重翻）。cache.json 落盘由 ReadingService 负责，
 * 本模块只管键与查找。 */

import { createHash } from 'node:crypto'
import { glossaryHash, type Glossary } from './glossary.ts'

export interface CacheEntry {
  readonly text: string
  readonly model: string
  readonly at: string
}

export interface TranslationCache {
  readonly entries: Readonly<Record<string, CacheEntry>>
}

export function emptyCache(): TranslationCache {
  return { entries: {} }
}

export function cacheKeyOf(input: {
  target: string
  model: string
  srcHash: string
  glossary: Glossary
}): string {
  return createHash('sha256')
    .update(`${input.target}\n${input.model}\n${input.srcHash}\n${glossaryHash(input.glossary)}`)
    .digest('hex')
    .slice(0, 24)
}

/** 命中查缓存；miss 返回 undefined。 */
export function lookup(cache: TranslationCache, key: string): CacheEntry | undefined {
  return cache.entries[key]
}

/** 写缓存（不可变更新）。 */
export function store(cache: TranslationCache, key: string, entry: CacheEntry): TranslationCache {
  return { entries: { ...cache.entries, [key]: entry } }
}

/** 术语表变更后的定向失效：srcText 含任一变更术语的块的 cacheKey 全部剔除。
 * `recomputeKeys` 由调用方给旧 cacheKey（旧术语表哈希下算出的）。 */
export function invalidateAffected(
  cache: TranslationCache,
  recomputeKeys: readonly { readonly blockId: string; readonly oldKey: string }[],
  affectedIds: readonly string[],
): TranslationCache {
  const affected = new Set(affectedIds)
  const drop = new Set(recomputeKeys.filter(item => affected.has(item.blockId)).map(item => item.oldKey))
  const entries: Record<string, CacheEntry> = {}
  for (const [key, entry] of Object.entries(cache.entries)) {
    if (!drop.has(key)) entries[key] = entry
  }
  return { entries }
}
