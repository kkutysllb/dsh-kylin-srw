/** 段落装配（呈现层，0205 附记三）：把抽取块序列装配成「整篇逐段」的
 * 阅读段落。source_map/缓存/verify 全部仍以**块**为基底层（不动、不重译），
 * 装配只发生在 paper.md 解析之后、呈现（面板/归档 PDF）之前——块级正确性
 * 锚与段落级阅读体验分层。 */

import type { BlockState, ParsedBlock } from './render.ts'

export interface ReadingParagraph {
  /** 段首块 id（笔记/定位仍可挂块，段 id 只是段首块的别名）。 */
  readonly id: string
  readonly blockIds: readonly string[]
  readonly kind?: string
  readonly sourceText: string
  readonly translation?: string
  /** 段内最坏块状态：mismatch > orphan > verified。 */
  readonly state: BlockState
}

/** 句末判定：句号/问叹/省略号（可带引号括号收尾）。分号与冒号不算——
 * 冒号后接列举段常见。 */
const TERMINAL_RE = /[.!?。？！…]["'”’）)\]]?\s*$/

/** 跨块拼句：前块以行尾连字符收 → 去连字符直拼；CJK 邻接不加空格；
 * 其余补一个空格。 */
export function joinTexts(a: string, b: string): string {
  if (a === '') return b
  if (b === '') return a
  if (/[A-Za-z]-$/.test(a)) return `${a.slice(0, -1)}${b}`
  const han = /\p{Script=Han}/u
  if (han.test(a.slice(-1)) && han.test(b.slice(0, 1))) return a + b
  return `${a} ${b}`
}

export function worstState(states: readonly BlockState[]): BlockState {
  if (states.includes('mismatch')) return 'mismatch'
  if (states.includes('orphan')) return 'orphan'
  return 'verified'
}

/** 装配规则（保守，呈现层错误零成本所以宁缺毋滥）：仅 para↔para 且前块
 * 不以句末标点收尾才合并——标题/图注/列表项永不并入正文段；跨页/跨栏
 * 自然续接（阅读序已由抽取层按分栏排好）。 */
export function assembleParagraphs(
  blocks: readonly ParsedBlock[],
  states: Readonly<Record<string, BlockState>>,
): readonly ReadingParagraph[] {
  const out: ReadingParagraph[] = []
  let current: { id: string; ids: string[]; sourceText: string; translation: string } | undefined
  const flush = (): void => {
    if (current === undefined) return
    const state = worstState(current.ids.map(id => states[id] ?? 'orphan'))
    out.push({
      id: current.id,
      blockIds: [...current.ids],
      kind: 'para',
      sourceText: current.sourceText,
      ...(current.translation !== '' ? { translation: current.translation } : {}),
      state,
    })
    current = undefined
  }
  for (const block of blocks) {
    if (current !== undefined && (block.kind === undefined || block.kind === 'para')) {
      // 未收句 → 视为同一段的续块（标题块已在 flush 前被 kind 门槛挡住）
      if (!TERMINAL_RE.test(current.sourceText)) {
        current.ids.push(block.id)
        current.sourceText = joinTexts(current.sourceText, block.sourceText)
        if (block.translation !== undefined) {
          current.translation = joinTexts(current.translation, block.translation)
        }
        continue
      }
    }
    flush()
    if (block.kind === undefined || block.kind === 'para') {
      current = {
        id: block.id,
        ids: [block.id],
        sourceText: block.sourceText,
        translation: block.translation ?? '',
      }
    } else {
      // 标题/图注等非正文块：一段一块，原样输出
      out.push({
        id: block.id,
        blockIds: [block.id],
        kind: block.kind,
        sourceText: block.sourceText,
        ...(block.translation !== undefined ? { translation: block.translation } : {}),
        state: states[block.id] ?? 'orphan',
      })
    }
  }
  flush()
  return out
}
