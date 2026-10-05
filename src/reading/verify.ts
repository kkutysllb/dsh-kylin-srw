/** 校验门 reading.verify（0205 Task 4.6 / R6）：重算 paper.md 里源段的
 * srcHash，与 source_map 对账——verified（一致）/ mismatch（源文被手改）/
 * orphan（paper 里的块不在 map 中）。译文不参与哈希（译文随便改，
 * 源段不可动）。 */

import { srcHashOf } from './source-map.ts'
import { parsePaper, type ParsedBlock } from './render.ts'
import type { SourceMap } from './source-map.ts'

export interface VerifyReport {
  readonly verified: readonly string[]
  readonly mismatch: readonly string[]
  readonly orphan: readonly string[]
  /** map 里有但 paper.md 里丢了的块（渲染不完整/手删）。 */
  readonly missing: readonly string[]
  readonly states: Readonly<Record<string, 'verified' | 'mismatch' | 'orphan'>>
}

export function verifyPaper(markdown: string, sourceMap: SourceMap): VerifyReport {
  const parsed: readonly ParsedBlock[] = parsePaper(markdown)
  const mapById = new Map(sourceMap.blocks.map(block => [block.id, block]))
  const verified: string[] = []
  const mismatch: string[] = []
  const orphan: string[] = []
  const states: Record<string, 'verified' | 'mismatch' | 'orphan'> = {}
  const seen = new Set<string>()
  for (const block of parsed) {
    seen.add(block.id)
    const mapped = mapById.get(block.id)
    if (mapped === undefined) {
      orphan.push(block.id)
      states[block.id] = 'orphan'
      continue
    }
    if (srcHashOf(block.sourceText) === mapped.srcHash) {
      verified.push(block.id)
      states[block.id] = 'verified'
    } else {
      mismatch.push(block.id)
      states[block.id] = 'mismatch'
    }
  }
  const missing = sourceMap.blocks.map(block => block.id).filter(id => !seen.has(id))
  return { verified, mismatch, orphan, missing, states }
}
