/** 翻译缓存（0205 Task 4.5 / R6）：cacheKey = sha256(target + model +
 * srcHash + glossaryHash)——四元组任一变化即 miss；改术语表**定向失效**
 * 受影响块（不是全量重翻）。cache.json 落盘由 ReadingService 负责，
 * 本模块只管键与查找。 */
import { type Glossary } from './glossary.ts';
export interface CacheEntry {
    readonly text: string;
    readonly model: string;
    readonly at: string;
}
export interface TranslationCache {
    readonly entries: Readonly<Record<string, CacheEntry>>;
}
export declare function emptyCache(): TranslationCache;
export declare function cacheKeyOf(input: {
    target: string;
    model: string;
    srcHash: string;
    glossary: Glossary;
}): string;
/** 命中查缓存；miss 返回 undefined。 */
export declare function lookup(cache: TranslationCache, key: string): CacheEntry | undefined;
/** 写缓存（不可变更新）。 */
export declare function store(cache: TranslationCache, key: string, entry: CacheEntry): TranslationCache;
/** 术语表变更后的定向失效：srcText 含任一变更术语的块的 cacheKey 全部剔除。
 * `recomputeKeys` 由调用方给旧 cacheKey（旧术语表哈希下算出的）。 */
export declare function invalidateAffected(cache: TranslationCache, recomputeKeys: readonly {
    readonly blockId: string;
    readonly oldKey: string;
}[], affectedIds: readonly string[]): TranslationCache;
