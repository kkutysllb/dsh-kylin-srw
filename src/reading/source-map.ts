/** source_map（0205 Task 4.3 / R6）：稳定块 ID + 源哈希 + 块迁移。
 * 笔记/术语/增量翻译全挂块上——换切分算法不能把用户数据弄丢：
 * 迁移按 srcHash 匹配旧块，救回的带走译文元数据，救不回的旧块记
 * orphan（报告出来，不静默丢弃）。 */

import { createHash } from 'node:crypto'
import type { BBox, BlockKind, BlockQuality, ExtractedBlock } from './extract.ts'

export const SOURCE_MAP_VERSION = 1

/** 源文本归一：连字断行（`fo-\nbar` → `foobar`）→ NFKC → 统一连字符 →
 * 折叠空白。srcHash 的底座——重抽后同一物理文本必须同哈希。 */
export function normalizeSrc(text: string): string {
  return text
    .replace(/-\r?\n\s*/g, '')
    .normalize('NFKC')
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** srcHash = sha256(normalize(src)) 全 hex。 */
export function srcHashOf(text: string): string {
  return createHash('sha256').update(normalizeSrc(text)).digest('hex')
}

export interface TranslationMeta {
  readonly target: string
  readonly model: string
  readonly at: string
  readonly cacheKey: string
}

export interface SourceMapBlock {
  readonly id: string
  readonly kind: BlockKind
  readonly order: number
  readonly page: number
  readonly srcHash: string
  readonly chars: number
  readonly bbox: BBox
  readonly quality: BlockQuality
  /** 迁移与翻译装配时填充；extract 阶段无。 */
  readonly translation?: TranslationMeta
}

export interface SourceMap {
  readonly schemaVersion: typeof SOURCE_MAP_VERSION
  readonly paperKey: string
  readonly source: { readonly pdf: string; readonly sha256: string; readonly pages: number }
  readonly extractor: { readonly name: string; readonly version: string; readonly ranAt: string }
  readonly blocks: readonly SourceMapBlock[]
}

export const EXTRACTOR_NAME = 'pdfjs-legacy-heuristic-v1'

export function buildSourceMap(input: {
  paperKey: string
  pdfPath: string
  pdfSha256: string
  blocks: readonly ExtractedBlock[]
}): SourceMap {
  return {
    schemaVersion: SOURCE_MAP_VERSION,
    paperKey: input.paperKey,
    source: { pdf: input.pdfPath, sha256: input.pdfSha256, pages: Math.max(0, ...input.blocks.map(b => b.page), 0) },
    extractor: { name: EXTRACTOR_NAME, version: EXTRACTOR_NAME, ranAt: new Date().toISOString() },
    blocks: input.blocks.map(block => ({
      id: block.id,
      kind: block.kind,
      order: block.order,
      page: block.page,
      srcHash: srcHashOf(block.text),
      chars: block.text.length,
      bbox: block.bbox,
      quality: block.quality,
    })),
  }
}

export interface MigrationReport {
  readonly blocks: readonly SourceMapBlock[]
  /** 按 srcHash 救回（携带旧译文元数据）的新块数。 */
  readonly migrated: number
  /** 新抽取里没有前身的全新块数。 */
  readonly fresh: number
  /** 旧块在新抽取中找不到对应（用户数据仍保留在返回的 orphans 里待处置）。 */
  readonly orphans: readonly SourceMapBlock[]
}

/** 块迁移：新抽取的块按 srcHash 认领旧块的译文元数据；同哈希多块按序
 * 一一配对（重复块合法）。旧块没被认领的 → orphans。 */
export function migrateBlocks(previous: SourceMap, freshBlocks: readonly ExtractedBlock[]): MigrationReport {
  const pool = new Map<string, SourceMapBlock[]>()
  for (const block of previous.blocks) {
    const list = pool.get(block.srcHash) ?? []
    list.push(block)
    pool.set(block.srcHash, list)
  }
  const blocks: SourceMapBlock[] = []
  let migrated = 0
  let fresh = 0
  for (const block of freshBlocks) {
    const srcHash = srcHashOf(block.text)
    const candidates = pool.get(srcHash)
    const prev = candidates?.shift()
    if (candidates !== undefined && candidates.length === 0) pool.delete(srcHash)
    if (prev === undefined) {
      fresh += 1
      blocks.push({
        id: block.id,
        kind: block.kind,
        order: block.order,
        page: block.page,
        srcHash,
        chars: block.text.length,
        bbox: block.bbox,
        quality: block.quality,
      })
      continue
    }
    migrated += 1
    blocks.push({
      id: block.id,
      kind: block.kind,
      order: block.order,
      page: block.page,
      srcHash,
      chars: block.text.length,
      bbox: block.bbox,
      quality: block.quality,
      ...(prev.translation !== undefined ? { translation: prev.translation } : {}),
    })
  }
  const orphans = [...pool.values()].flat()
  return { blocks, migrated, fresh, orphans }
}
