/** 精读结果 PDF（译注版，0205 附记四）：`readings/<YYYY-MM-DD>/<paperKey>.pdf`。
 * 结构对齐用户既往精读成果（递归自我改进综述·中文精读译注版）：
 * 封面信息表 → 阅读指南 → 全文导读（LLM）→ 论文信息 → 正文全译（逐段双语
 * + 每节【本节速览】与 ◆精读备注盒 + 图内标注）→ 附录（图表清单/术语对照表/
 * 参考文献英文原样/译注体例与免责说明）→ 页眉页脚。
 * 宿主没有 PDF 生成能力 → pdfkit 自带依赖（0102 §7.1.2 纪律）；CJK 用系统
 * 字体回退链，glyph 子集内嵌——产物可移植。 */

import { existsSync } from 'node:fs'
import PDFDocument from 'pdfkit'
import { ServiceError } from '../service.ts'

export interface PdfParagraphInput {
  readonly id: string
  readonly kind?: string
  readonly state: 'verified' | 'mismatch' | 'orphan'
  readonly sourceText: string
  readonly translation?: string
}

export interface PdfSectionNote {
  readonly summary: string
  readonly note: string
}

export interface ReadingPdfInput {
  readonly paperKey: string
  /** 封面中文标题（title 块译文，无则源文）。 */
  readonly titleZh: string
  /** 封面英文原题（title 块源文）。 */
  readonly titleEn: string
  /** 作者与单位（title 后第一段的启发式；拿不到则不出现在封面）。 */
  readonly authors?: string
  readonly pdfPath?: string
  readonly exportedAt: string
  readonly model?: string
  readonly glossary?: Readonly<Record<string, string>>
  /** 全文导读（notes.guide；未生成则封面注明）。 */
  readonly guide?: string
  /** 每节批注：heading 块 id → 速览+备注。 */
  readonly sectionNotes?: Readonly<Record<string, PdfSectionNote>>
  readonly summary: {
    readonly pages: number
    readonly blocks: number
    readonly translated: number
    readonly verified: number
    readonly mismatch: number
    readonly orphan: number
    readonly missing: number
  }
  /** 正文阅读流（不含 references/figlabel/furniture）。 */
  readonly flow: readonly PdfParagraphInput[]
  /** 参考文献段（英文原样）。 */
  readonly references: readonly PdfParagraphInput[]
  /** 图内标注：图注块 id → 标注碎片（源文，随图注呈现）。 */
  readonly figureNotes?: Readonly<Record<string, readonly string[]>>
  /** 附录 A 图表清单（caption 段 + 所在页）。 */
  readonly figureList?: readonly { readonly text: string; readonly page: number }[]
}

const FONT_CANDIDATES: readonly { readonly path: string; readonly name?: string }[] = [
  { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', name: 'HiraginoSansGB-W3' },
  { path: '/System/Library/Fonts/PingFang.ttc', name: 'PingFangSC-Regular' },
  { path: '/System/Library/Fonts/Supplemental/Songti.ttc', name: 'STSongti-SC-Regular' },
  { path: '/Library/Fonts/Arial Unicode.ttf' },
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', name: 'NotoSansCJKsc-Regular' },
  { path: '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', name: 'NotoSansCJKsc-Regular' },
]

export function resolveCjkFont(): { readonly path: string; readonly name?: string } | undefined {
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate.path)) return candidate
  }
  return undefined
}

const PROBLEM_LABELS: Record<'mismatch' | 'orphan', string> = {
  mismatch: '⚠ 源文被改（此段译文不保证对应当前源文）',
  orphan: '⚠ 孤立段（不在 source_map，禁止引用）',
}

const MARGIN = 56
const INK = '#111111'
const EN_GRAY = '#555555'
const DIM = '#888888'
const AMBER = '#b45309'

/** 灰底批注盒（速览/备注/图内标注用）：矩形 + 盒内文字。页尾放不下整盒
 * 就先换页（矩形不跨页）。返回后 doc.y 停在盒底下方。 */
function boxedText(doc: PDFKit.PDFDocument, text: string, options: {
  bg: string
  ink: string
  fontSize: number
  label?: string
  labelColor?: string
}): void {
  const width = doc.page.width - MARGIN * 2
  const pad = 8
  const label = options.label !== undefined ? `${options.label}\n` : ''
  doc.fontSize(options.fontSize)
  const textHeight = doc.heightOfString(`${label}${text}`, { width: width - pad * 2, lineGap: 1.5 })
  const boxHeight = textHeight + pad * 2
  if (doc.y + boxHeight > doc.page.height - MARGIN - 24) doc.addPage()
  const y0 = doc.y
  doc.save()
  doc.rect(MARGIN, y0, width, boxHeight).fill(options.bg)
  doc.restore()
  doc.fillColor(options.labelColor ?? options.ink)
    .text(`${label}${text}`, MARGIN + pad, y0 + pad, { width: width - pad * 2, lineGap: 1.5 })
  doc.y = y0 + boxHeight + 10
  doc.x = MARGIN
}

/** 全文导读：字段行（以「：」收尾且非列表项）加重、列表项缩进。 */
function renderGuide(doc: PDFKit.PDFDocument, guide: string): void {
  for (const rawLine of guide.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    if (line.startsWith('- ')) {
      doc.fontSize(9.5).fillColor('#333333').text(line, MARGIN + 14, doc.y, { width: doc.page.width - MARGIN * 2 - 14, lineGap: 2 })
    } else if (line.endsWith('：') || line.endsWith(':')) {
      doc.moveDown(0.4)
      doc.fontSize(10.5).fillColor(INK).text(line, { lineGap: 2 })
    } else {
      doc.fontSize(9.5).fillColor('#333333').text(line, { lineGap: 2 })
    }
  }
}

function kvRow(doc: PDFKit.PDFDocument, label: string, value: string): void {
  const labelWidth = 78
  const valueWidth = doc.page.width - MARGIN * 2 - labelWidth - 10
  doc.fontSize(9)
  const valueHeight = doc.heightOfString(value, { width: valueWidth, lineGap: 1.5 })
  const y0 = doc.y
  doc.fillColor(DIM).text(label, MARGIN, y0 + 1, { width: labelWidth, lineBreak: false })
  doc.fillColor(INK).text(value, MARGIN + labelWidth + 10, y0, { width: valueWidth, lineGap: 1.5 })
  doc.y = Math.max(doc.y, y0 + Math.max(valueHeight, 12)) + 6
  doc.x = MARGIN
}

/** 译注版 PDF。 */
export async function renderReadingPdf(input: ReadingPdfInput): Promise<Buffer> {
  const font = resolveCjkFont()
  if (font === undefined) {
    throw new ServiceError('FONT_MISSING', '未找到可用 CJK 字体（需 Hiragino/PingFang/Songti/Arial Unicode/Noto 之一）')
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    doc.on('end', () => { resolve(Buffer.concat(chunks)) })
    doc.on('error', reject)
    doc.info.Title = `${input.titleZh} · 中文精读译注版`
    doc.info.Creator = 'dsh-kylin-srw'

    doc.addPage({ size: 'A4', margin: MARGIN })
    if (font.name !== undefined) doc.font(font.path, font.name)
    else doc.font(font.path)

    const s = input.summary
    const headerText = `${truncate(input.titleZh, 34)}（${input.paperKey}）中文精读译注版`

    // ── 封面 ──
    doc.moveDown(6)
    doc.fontSize(17).fillColor(INK).text(input.titleZh, { lineGap: 5 })
    doc.fontSize(10.5).fillColor(EN_GRAY).text(input.titleEn, { lineGap: 3 })
    doc.moveDown(1)
    doc.fontSize(10).fillColor('#2f5e2f').text('中文精读译注版 · 全文逐段双语对照 · 块级哈希校验', { lineGap: 2 })
    doc.moveDown(1.6)
    kvRow(doc, '原文标题', input.titleEn)
    if (input.authors !== undefined) kvRow(doc, '作者与单位', truncate(input.authors, 260))
    kvRow(doc, '来源', `${input.pdfPath ?? input.paperKey}`)
    kvRow(doc, '篇幅', `${s.pages} 页 · 抽取 ${s.blocks} 块 · 参译 ${s.translated}`)
    kvRow(doc, '块级校验', `✓ ${s.verified} / ⚠ 源改 ${s.mismatch} / 孤立 ${s.orphan} / 未译 ${s.missing}`)
    kvRow(doc, '译注模型', input.model ?? '—')
    kvRow(doc, '导出时间', input.exportedAt)
    doc.moveDown(4)
    doc.fontSize(8).fillColor(DIM).text(
      '本文件由 dsh-kylin-srw 科研工作台生成：中文译文与导读/备注为辅助理解之用，',
      { lineGap: 1.5 },
    )
    doc.text('一切以原文 PDF 为准；参考文献保持英文原样以便检索。', { lineGap: 1.5 })

    // ── 阅读指南 ──
    doc.addPage()
    doc.fontSize(14).fillColor(INK).text('阅读指南', { lineGap: 4 })
    doc.moveDown(0.5)
    for (const block of GUIDE_BLOCKS) {
      doc.fontSize(10.5).fillColor(INK).text(block.title, { lineGap: 2 })
      for (const line of block.lines) {
        doc.fontSize(9.5).fillColor('#333333').text(`- ${line}`, MARGIN + 10, doc.y, { width: doc.page.width - MARGIN * 2 - 10, lineGap: 2 })
      }
      doc.moveDown(0.6)
    }

    // ── 全文导读（LLM 生成；未生成则说明如何生成） ──
    doc.addPage()
    doc.fontSize(14).fillColor(INK).text('全文导读', { lineGap: 4 })
    doc.moveDown(0.4)
    if (input.guide !== undefined && input.guide.trim() !== '') {
      renderGuide(doc, input.guide)
    } else {
      doc.fontSize(9.5).fillColor(DIM).text('（导读未生成——在会话里用 srw_read 的 notes 动作生成后重新导出。）')
    }

    // ── 正文全译 ──
    doc.addPage()
    let pendingNote: { id: string; note: PdfSectionNote } | undefined
    const flushNote = (): void => {
      if (pendingNote === undefined) return
      if (pendingNote.note.note.trim() !== '') {
        doc.moveDown(0.4)
        boxedText(doc, pendingNote.note.note, { bg: '#faf5ea', ink: '#4a3b20', fontSize: 9, label: '◆ 精读备注', labelColor: '#8a6d1f' })
      }
      pendingNote = undefined
    }
    for (const paragraph of input.flow) {
      if (paragraph.state !== 'verified') {
        doc.fontSize(7.5).fillColor(AMBER).text(`[${paragraph.id}] ${PROBLEM_LABELS[paragraph.state]}`, { lineGap: 1 })
      }
      if (paragraph.kind === 'title') {
        doc.fontSize(16).fillColor(INK).text(paragraph.sourceText, { lineGap: 4 })
        if (hasText(paragraph.translation)) {
          doc.fontSize(13).fillColor('#333333').text(paragraph.translation as string, { lineGap: 3 })
        }
        doc.moveDown(0.8)
      } else if (paragraph.kind === 'heading') {
        flushNote()
        doc.moveDown(0.6)
        doc.fontSize(12).fillColor(INK).text(paragraph.sourceText, { lineGap: 2 })
        if (hasText(paragraph.translation)) {
          doc.fontSize(10.5).fillColor('#555555').text(paragraph.translation as string, { lineGap: 2 })
        }
        doc.moveDown(0.2)
        const note = input.sectionNotes?.[paragraph.id]
        if (note !== undefined && note.summary.trim() !== '') {
          boxedText(doc, note.summary, { bg: '#f1f5f1', ink: '#2f4a2f', fontSize: 9, label: '【本节速览】', labelColor: '#3d6b3d' })
        }
        if (note !== undefined) pendingNote = { id: paragraph.id, note }
      } else if (paragraph.kind === 'caption') {
        doc.fontSize(8.5).fillColor('#555555').text(paragraph.sourceText, { lineGap: 1.5 })
        if (hasText(paragraph.translation)) {
          doc.fontSize(9).fillColor('#333333').text(paragraph.translation as string, { lineGap: 1.5 })
        }
        const labels = input.figureNotes?.[paragraph.id]
        if (labels !== undefined && labels.length > 0) {
          boxedText(doc, labels.join('；'), { bg: '#f4f4f4', ink: DIM, fontSize: 8, label: '图内标注（源文）', labelColor: DIM })
        }
        doc.moveDown(0.4)
      } else {
        doc.fontSize(9).fillColor(EN_GRAY).text(paragraph.sourceText, { lineGap: 1.5 })
        if (hasText(paragraph.translation)) {
          doc.fontSize(10.5).fillColor(INK).text(paragraph.translation as string, { lineGap: 2.5 })
        }
        doc.moveDown(0.55)
      }
    }
    flushNote()

    // ── 附录 A 图表清单 ──
    doc.addPage()
    doc.fontSize(14).fillColor(INK).text('附录 A：图表清单', { lineGap: 4 })
    doc.moveDown(0.4)
    const figureList = input.figureList ?? []
    if (figureList.length === 0) {
      doc.fontSize(9.5).fillColor(DIM).text('（未识别到带编号的图表注。）')
    } else {
      for (const figure of figureList) {
        doc.fontSize(9.5).fillColor('#333333').text(`第 ${figure.page} 页 · ${truncate(oneLine(figure.text), 110)}`, { lineGap: 2 })
      }
    }

    // ── 附录 B 术语对照表 ──
    doc.addPage()
    doc.fontSize(14).fillColor(INK).text('附录 B：术语对照表', { lineGap: 4 })
    doc.moveDown(0.4)
    const glossaryEntries = Object.entries(input.glossary ?? {})
    if (glossaryEntries.length === 0) {
      doc.fontSize(9.5).fillColor(DIM).text('（本篇未设置固定术语表——译文中的术语按「首现括注英文原词」体例处理。）')
    } else {
      for (const [term, translation] of glossaryEntries) {
        kvRow(doc, term, translation)
      }
    }

    // ── 附录 C 参考文献（英文原样保留） ──
    doc.addPage()
    doc.fontSize(14).fillColor(INK).text('附录 C：参考文献（英文原样保留）', { lineGap: 4 })
    doc.moveDown(0.3)
    doc.fontSize(8.5).fillColor(DIM).text('体例：参考文献不翻译——保留英文原样以保证可检索性。', { lineGap: 2 })
    doc.moveDown(0.3)
    if (input.references.length === 0) {
      doc.fontSize(9.5).fillColor(DIM).text('（未识别到参考文献段。）')
    } else {
      for (const reference of input.references) {
        doc.fontSize(8).fillColor('#444444').text(oneLine(reference.sourceText), { lineGap: 1.5 })
        doc.moveDown(0.15)
      }
    }

    // ── 附录 D 译注体例与免责说明 ──
    doc.addPage()
    doc.fontSize(14).fillColor(INK).text('附录 D：译注体例与免责说明', { lineGap: 4 })
    doc.moveDown(0.5)
    for (const block of DISCLAIMER_BLOCKS) {
      doc.fontSize(10.5).fillColor(INK).text(block.title, { lineGap: 2 })
      for (const line of block.lines) {
        doc.fontSize(9.5).fillColor('#333333').text(`- ${line}`, MARGIN + 10, doc.y, { width: doc.page.width - MARGIN * 2 - 10, lineGap: 2 })
      }
      doc.moveDown(0.6)
    }

    // ── 页眉/页脚（两遍回写；封面页只写页脚） ──
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i)
      const pageNumber = i - range.start + 1
      if (i > range.start) {
        doc.fontSize(7.5).fillColor(DIM).text(headerText, MARGIN, 26, { width: doc.page.width - MARGIN * 2, align: 'center', lineBreak: false })
      }
      doc.fontSize(8).fillColor(DIM).text(
        `${pageNumber} / ${range.count}`,
        MARGIN, doc.page.height - 42,
        { width: doc.page.width - MARGIN * 2, align: 'center', lineBreak: false },
      )
    }
    doc.end()
  })
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ''
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const GUIDE_BLOCKS: readonly { readonly title: string; readonly lines: readonly string[] }[] = [
  {
    title: '这份文件是什么',
    lines: [
      '原文 PDF 的中文精读译注版：正文逐段双语对照（英文原文灰字 + 中文译文黑字）。',
      '「全文导读」与每节「【本节速览】/◆精读备注」是译者所加的精读批注，不属于原文。',
      '每段都带块级哈希校验：源文被改动过的段会在段首亮 ⚠，禁止当作对应当前原文引用。',
    ],
  },
  {
    title: '翻译体例',
    lines: [
      '数字与统计零误差照抄原文，不换算、不四舍五入。',
      '引用标记 [12]、(Vaswani et al., 2017) 与交叉引用 §3.1、Fig. 2、Table 4 保留原形。',
      '系统名/模型名/数据集名保留英文；术语首次出现时括注英文原词。',
      '参考文献保持英文原样（见附录 C），以保证可检索性。',
    ],
  },
  {
    title: '使用提醒',
    lines: [
      '译文不能替代原文：公式推导、图表细节请回到原文核对。',
      '本文件由宿主大模型辅助生成，可能存在错误；重要结论务必核对原文。',
    ],
  },
]

const DISCLAIMER_BLOCKS: readonly { readonly title: string; readonly lines: readonly string[] }[] = [
  {
    title: '体例约定',
    lines: [
      '〔原文〕段落：英文原文，灰字呈现；〔译文〕段落：中文译文，紧随其后。',
      '段落装配：呈现层把抽取块合并成连续段落，仅当上一块未以句末标点收尾。',
      '段首 ⚠ 标记：mismatch（源文被改）/ orphan（孤立段），出现即禁止引用该段译文。',
    ],
  },
  {
    title: '免责说明',
    lines: [
      '中文译文与导读/备注由宿主默认大模型生成，仅供学习与研究参考。',
      '对原文的理解以论文 PDF 原文为准；引用请注明原文出处，不要引用本译文。',
      '生成过程：抽取（pdfjs 分栏行块重建）→ 逐块翻译（哈希缓存 + 术语强校验）→ 块级校验 → 段落装配 → 本 PDF。',
    ],
  },
]
