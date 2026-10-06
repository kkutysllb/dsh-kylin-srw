/** 段落装配（呈现层，0205 附记三/四）：把抽取块序列装配成「整篇逐段」的
 * 阅读段落。source_map/缓存/verify 全部仍以**块**为基底层（不动、不重译），
 * 装配只发生在 paper.md 解析之后、呈现（面板/归档 PDF）之前——块级正确性
 * 锚与段落级阅读体验分层。
 *
 * 译注版（0205 附记四）：正文流里不再出现版面杂讯（furniture）、图内标注
 * 碎片（figlabel，归到所属图注做「图内标注」）与参考文献（reference，英文
 * 原样单独收集）——分别进 references / figureNotes 通道。 */

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

export interface AssembledReading {
  /** 正文阅读流：标题/摘要/标题行/图注/正文段（连续双语）。 */
  readonly flow: readonly ReadingParagraph[]
  /** 参考文献段（英文原样，不译）。 */
  readonly references: readonly ReadingParagraph[]
  /** 图内标注：图注块 id → 该图内的标注碎片（按阅读序）。 */
  readonly figureNotes: Readonly<Record<string, readonly string[]>>
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

/** 不进正文流的 kind（与 extract 的 UNTRANSLATED_KINDS 对应，外加 furniture
 * 纯版面件——这里是呈现层过滤，翻译层过滤在 translate 侧）。 */
const NON_FLOW_KINDS: ReadonlySet<string> = new Set(['furniture', 'figlabel', 'reference'])

/** 装配规则（保守，呈现层错误零成本所以宁缺毋滥）：仅 para↔para 且前块
 * 不以句末标点收尾才合并——标题/图注/列表项永不并入正文段；跨页/跨栏
 * 自然续接（阅读序已由抽取层按分栏排好）。 */
export function assembleReading(
  blocks: readonly ParsedBlock[],
  states: Readonly<Record<string, BlockState>>,
): AssembledReading {
  const flow: ReadingParagraph[] = []
  const references: ReadingParagraph[] = []
  const figureNotes: Record<string, string[]> = {}
  /** 待归属的图内碎片（记录 push 时的 flow 位置，用于就近找图注）。 */
  const pendingLabels: Array<{ text: string; pos: number }> = []
  let current: { id: string; ids: string[]; sourceText: string; translation: string } | undefined
  const flush = (): void => {
    if (current === undefined) return
    const state = worstState(current.ids.map(id => states[id] ?? 'orphan'))
    flow.push({
      id: current.id,
      blockIds: [...current.ids],
      kind: 'para',
      sourceText: current.sourceText,
      ...(current.translation !== '' ? { translation: current.translation } : {}),
      state,
    })
    current = undefined
  }
  const flushLabels = (): void => {
    // 碎片归属：就近图注——碎片先于其图注出现在阅读序里（图在上、注在下
    // → 注在碎片之后），所以先找位置 ≥ 碎片的首个图注；全文无后续图注则
    // 退给之前最近的图注；连图注都没有就丢弃（宁缺毋滥）
    for (const label of pendingLabels) {
      const nextCaption = flow.find((paragraph, index) => index >= label.pos && paragraph.kind === 'caption')
      const prevCaption = nextCaption === undefined
        ? [...flow.slice(0, label.pos)].reverse().find(paragraph => paragraph.kind === 'caption')
        : undefined
      const owner = nextCaption ?? prevCaption
      if (owner !== undefined) {
        ;(figureNotes[owner.id] ??= []).push(label.text)
      }
    }
    pendingLabels.length = 0
  }
  for (const block of blocks) {
    const kind = block.kind ?? 'para'
    if (kind === 'furniture') continue
    if (kind === 'figlabel') {
      pendingLabels.push({ text: block.sourceText, pos: flow.length })
      continue
    }
    if (kind === 'reference') {
      flush()
      references.push({
        id: block.id,
        blockIds: [block.id],
        kind,
        sourceText: block.sourceText,
        ...(block.translation !== undefined ? { translation: block.translation } : {}),
        state: states[block.id] ?? 'orphan',
      })
      continue
    }
    if (current !== undefined && kind === 'para') {
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
    if (kind === 'para') {
      current = {
        id: block.id,
        ids: [block.id],
        sourceText: block.sourceText,
        translation: block.translation ?? '',
      }
    } else {
      // 标题/图注等非正文块：先入流，再结算待归属的图内碎片——
      // 碎片在阅读序里先于其图注出现（图在上、注在下），必须等本块
      // （若恰是图注）进流后才找得到归属
      flow.push({
        id: block.id,
        blockIds: [block.id],
        kind,
        sourceText: block.sourceText,
        ...(block.translation !== undefined ? { translation: block.translation } : {}),
        state: states[block.id] ?? 'orphan',
      })
      flushLabels()
    }
  }
  flush()
  flushLabels()
  return { flow, references, figureNotes }
}

export interface ReadingSection {
  /** 节标题段 id；undefined = 首个标题行之前的导语部分（题名/摘要）。 */
  readonly headingId: string | undefined
  readonly headingSource: string
  readonly headingTranslation?: string
  readonly paragraphs: readonly ReadingParagraph[]
}

/** 分节：标题行切块（导语部分 headingId=undefined）。精读备注按节生成。 */
export function splitSections(flow: readonly ReadingParagraph[]): readonly ReadingSection[] {
  const sections: ReadingSection[] = []
  let current: { headingId: string | undefined; headingSource: string; headingTranslation?: string; paragraphs: ReadingParagraph[] } | undefined
  const flush = (): void => {
    if (current !== undefined) sections.push({ ...current })
    current = undefined
  }
  for (const paragraph of flow) {
    if (paragraph.kind === 'heading') {
      flush()
      current = {
        headingId: paragraph.id,
        headingSource: paragraph.sourceText,
        ...(paragraph.translation !== undefined ? { headingTranslation: paragraph.translation } : {}),
        paragraphs: [],
      }
      continue
    }
    if (current === undefined) {
      current = { headingId: undefined, headingSource: '', paragraphs: [] }
    }
    current.paragraphs.push(paragraph)
  }
  flush()
  return sections
}
