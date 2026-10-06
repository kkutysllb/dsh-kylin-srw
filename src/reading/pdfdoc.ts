/** 精读结果 PDF 归档（用户指令：项目工作区独立子目录、按日期归档）：
 * `readings/<YYYY-MM-DD>/<paperKey>.pdf`。宿主没有 PDF 生成能力 → pdfkit
 * 自带依赖（0102 §7.1.2 同一纪律）。CJK 用系统字体回退链（Hiragino/
 * PingFang/Songti/Arial Unicode/Noto），glyph 子集内嵌——产物可移植，
 * 生成机只要求装有一个候选字体。 */

import { existsSync } from 'node:fs'
import PDFDocument from 'pdfkit'
import { ServiceError } from '../service.ts'

export interface PdfBlockInput {
  readonly id: string
  readonly kind?: string
  readonly state: 'verified' | 'mismatch' | 'orphan'
  readonly sourceText: string
  readonly translation?: string
}

export interface ReadingPdfInput {
  readonly paperKey: string
  /** 标题：title 块源文，回退 paperKey。 */
  readonly title: string
  readonly pdfPath?: string
  readonly exportedAt: string
  readonly model?: string
  readonly summary: {
    readonly pages: number
    readonly blocks: number
    readonly translated: number
    readonly verified: number
    readonly mismatch: number
    readonly orphan: number
    readonly missing: number
  }
  readonly blocks: readonly PdfBlockInput[]
}

const FONT_CANDIDATES: readonly { readonly path: string; readonly name?: string }[] = [
  { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', name: 'HiraginoSansGB-W3' },
  { path: '/System/Library/Fonts/PingFang.ttc', name: 'PingFangSC-Regular' },
  { path: '/System/Library/Fonts/Supplemental/Songti.ttc', name: 'STSongti-SC-Regular' },
  { path: '/Library/Fonts/Arial Unicode.ttf' },
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', name: 'NotoSansCJK-Regular' },
  { path: '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', name: 'NotoSansCJKsc-Regular' },
]

export function resolveCjkFont(): { readonly path: string; readonly name?: string } | undefined {
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate.path)) return candidate
  }
  return undefined
}

const STATE_LAMPS: Record<PdfBlockInput['state'], string> = {
  verified: '✓ 源段一致',
  mismatch: '⚠ 源文被改（译文不保证对应当前源文）',
  orphan: '孤立块（不在 source_map，禁止引用）',
}

/** 双语 PDF：头部摘要 → 逐块（灯 + 源段 + 译文）→ 页脚页码。 */
export async function renderReadingPdf(input: ReadingPdfInput): Promise<Buffer> {
  const font = resolveCjkFont()
  if (font === undefined) {
    throw new ServiceError('FONT_MISSING', '未找到可用 CJK 字体（需 Hiragino/PingFang/Songti/Arial Unicode/Noto 之一）')
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, autoFirstPage: false })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    doc.on('end', () => { resolve(Buffer.concat(chunks)) })
    doc.on('error', reject)
    doc.info.Title = `${input.title} · 精读归档`
    doc.info.Creator = 'dsh-kylin-srw'

    doc.addPage({ size: 'A4', margin: 56 })
    if (font.name !== undefined) doc.font(font.path, font.name)
    else doc.font(font.path)

    const s = input.summary
    doc.fontSize(15).fillColor('#111111').text(input.title, { lineGap: 3 })
    doc.fontSize(8.5).fillColor('#777777')
    doc.text(`${input.paperKey}${input.pdfPath !== undefined ? ` · ${input.pdfPath}` : ''} · ${s.pages} 页 · 模型 ${input.model ?? '—'}`)
    doc.text(`导出 ${input.exportedAt} · 块 ${s.blocks} · 已译 ${s.translated} · ✓ ${s.verified} / ⚠ ${s.mismatch} / 孤 ${s.orphan} / 丢 ${s.missing}`)
    doc.moveDown(0.8)

    for (const block of input.blocks) {
      doc.fontSize(7.5).fillColor(block.state === 'verified' ? '#999999' : '#b45309')
      doc.text(`${block.id} · ${STATE_LAMPS[block.state]}${block.kind !== undefined && block.kind !== 'para' ? ` · ${block.kind}` : ''}`)
      doc.fontSize(9.5).fillColor('#444444').text(block.sourceText, { lineGap: 1.5 })
      if (block.translation !== undefined && block.translation !== '') {
        doc.fontSize(10).fillColor('#111111').text(block.translation, { lineGap: 2.5 })
      }
      doc.moveDown(0.55)
    }

    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      doc.fontSize(8).fillColor('#999999').text(
        `${i - range.start + 1} / ${range.count}`,
        56, doc.page.height - 42,
        { width: doc.page.width - 112, align: 'center', lineBreak: false },
      )
    }
    doc.end()
  })
}
