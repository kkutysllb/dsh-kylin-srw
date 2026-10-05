/** paper.md 渲染与解析（0205 Task 4.6 / R6）：双语正文，块锚
 * `<!-- srw:<id> ... -->` 把每一段钉死在 source_map 的块上——译文永远
 * 绑定真实源段（结构性防幻觉）。解析与渲染互为逆操作，verify 消费解析结果。 */

import type { SourceMap, SourceMapBlock } from './source-map.ts'

export type BlockState = 'verified' | 'mismatch' | 'orphan'

const ANCHOR_RE = /^<!--\s*srw:(p\d+-b\d+)(?:\s+kind=(\w+))?(?:\s+state=(\w+))?\s*-->$/
const ZH_MARK = '<!-- srw:zh -->'
const END_MARK = '<!-- /srw -->'

export interface ParsedBlock {
  readonly id: string
  readonly kind?: string
  readonly declaredState?: string
  readonly sourceText: string
  readonly translation?: string
}

/** 解析 paper.md → 块序列（锚顺序）。格式不合法的锚忽略。 */
export function parsePaper(markdown: string): readonly ParsedBlock[] {
  const lines = markdown.split('\n')
  const blocks: ParsedBlock[] = []
  let current: { id: string; kind?: string; declaredState?: string; source: string[]; translation?: string[]; phase: 'src' | 'zh' } | undefined
  const flush = (): void => {
    if (current === undefined) return
    blocks.push({
      id: current.id,
      ...(current.kind !== undefined ? { kind: current.kind } : {}),
      ...(current.declaredState !== undefined ? { declaredState: current.declaredState } : {}),
      sourceText: current.source.join('\n').trim(),
      ...(current.translation !== undefined ? { translation: current.translation.join('\n').trim() } : {}),
    })
    current = undefined
  }
  for (const line of lines) {
    const anchor = line.match(ANCHOR_RE)
    if (anchor !== null) {
      flush()
      current = {
        id: anchor[1] ?? '',
        ...(anchor[2] !== undefined ? { kind: anchor[2] } : {}),
        ...(anchor[3] !== undefined ? { declaredState: anchor[3] } : {}),
        source: [],
        phase: 'src',
      }
      continue
    }
    if (current === undefined) continue
    if (line.trim() === ZH_MARK) {
      current.phase = 'zh'
      current.translation = []
      continue
    }
    if (line.trim() === END_MARK) {
      flush()
      continue
    }
    if (current.phase === 'src') current.source.push(line)
    else current.translation?.push(line)
  }
  flush()
  return blocks
}

/** 渲染双语 paper.md：每块 = 锚 + 源文（+ 译文）。 */
export function renderPaper(
  sourceMap: SourceMap,
  translations: Readonly<Record<string, string>>,
  states: Readonly<Record<string, BlockState>> = {},
): string {
  const parts: string[] = [`<!-- srw-paper ${sourceMap.paperKey} -->`, '']
  const ordered = [...sourceMap.blocks].sort((a, b) => a.order - b.order)
  for (const block of ordered) {
    parts.push(renderBlock(block, translations[block.id], states[block.id]))
  }
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

function renderBlock(block: SourceMapBlock, translation: string | undefined, state: BlockState | undefined): string {
  const statePart = state === undefined ? '' : ` state=${state}`
  const head = `<!-- srw:${block.id} kind=${block.kind}${statePart} -->`
  if (translation === undefined) return `${head}\n${blockTextOf(block)}\n${END_MARK}`
  return `${head}\n${blockTextOf(block)}\n${ZH_MARK}\n${translation}\n${END_MARK}`
}

/** 块正文：渲染时 map 里没有原文文本（map 只存哈希）→ 用译文或占位。
 * 完整源文由调用方经 `renderPaperWithSources` 传入。 */
function blockTextOf(block: SourceMapBlock): string {
  return `[源文缺失：${block.id}]`
}

/** 带源文的渲染（正常路径）：sources = id → 原文文本。 */
export function renderPaperWithSources(
  sourceMap: SourceMap,
  sources: Readonly<Record<string, string>>,
  translations: Readonly<Record<string, string>>,
  states: Readonly<Record<string, BlockState>> = {},
): string {
  const parts: string[] = [`<!-- srw-paper ${sourceMap.paperKey} -->`, '']
  const ordered = [...sourceMap.blocks].sort((a, b) => a.order - b.order)
  for (const block of ordered) {
    const head = `<!-- srw:${block.id} kind=${block.kind}${states[block.id] === undefined ? '' : ` state=${states[block.id]}`} -->`
    const source = sources[block.id] ?? ''
    const translation = translations[block.id]
    if (translation === undefined) parts.push(`${head}\n${source}\n${END_MARK}`)
    else parts.push(`${head}\n${source}\n${ZH_MARK}\n${translation}\n${END_MARK}`)
  }
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export { ANCHOR_RE, END_MARK, ZH_MARK }
