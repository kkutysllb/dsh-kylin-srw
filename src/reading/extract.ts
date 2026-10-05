/** PDF 抽取器（0205 Task 4.2 / R6）：自带 pdfjs-dist legacy Node build
 * （宿主无主机侧抽取能力——0102 §7.1.2 一手核对）。管线：items → 分栏
 * 识别（x 中心直方图两簇 + gutter）→ 行重建（y 容差分桶、x 升序、间距
 * 补空格）→ 块切分（同栏相邻行、行距近）→ 质量分级。
 *
 * **双栏绝不能全页按 y 排序**（会左右交错）——先分栏、栏内再序。 */

import { createRequire } from 'node:module'

export type BlockKind =
  | 'title' | 'abstract' | 'heading' | 'para' | 'list' | 'caption'
  | 'table' | 'formula' | 'reference' | 'code' | 'footnote'

export type BlockQuality = 'ok' | 'suspicious'

export interface BBox {
  readonly x0: number
  readonly yTop: number
  readonly x1: number
  readonly yBottom: number
}

export interface ExtractedBlock {
  /** `p{page}-b{index}`（页内序）。 */
  readonly id: string
  readonly page: number
  readonly kind: BlockKind
  /** 全文阅读序（0 起）。 */
  readonly order: number
  readonly text: string
  readonly bbox: BBox
  readonly quality: BlockQuality
}

export interface ExtractResult {
  readonly pages: number
  readonly blocks: readonly ExtractedBlock[]
}

interface TextItemLike {
  readonly str: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** pdfjs standard_fonts 的落点（缺失只是告警，不阻断）。 */
function standardFontDataUrl(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require.resolve('pdfjs-dist/package.json')
    return `${pkg.slice(0, pkg.lastIndexOf('/'))}/standard_fonts/`
  } catch {
    return undefined
  }
}

async function loadPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  try {
    return await import('pdfjs-dist/legacy/build/pdf.mjs')
  } catch (error: unknown) {
    throw new Error(`pdfjs-dist 不可用（抽取器自带依赖加载失败）：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 分栏识别：x 中心直方图找「两簇 + 中间显著空带」。返回 gutter x 或
 * undefined（单栏）。 */
export function detectGutter(items: readonly TextItemLike[], pageWidth: number): number | undefined {
  if (items.length < 8) return undefined
  const bins = 24
  const binWidth = pageWidth / bins
  const counts = new Array<number>(bins).fill(0)
  for (const item of items) {
    const center = item.x + item.width / 2
    const bin = Math.min(bins - 1, Math.max(0, Math.floor(center / binWidth)))
    counts[bin] = (counts[bin] ?? 0) + 1
  }
  const contentBin = (index: number): boolean => (counts[index] ?? 0) > 0
  const margin = Math.max(2, Math.floor(bins * 0.1))
  let best: { start: number; end: number; width: number } | undefined
  let run = -1
  for (let index = margin; index < bins - margin; index += 1) {
    if (!contentBin(index)) {
      if (run === -1) run = index
    } else if (run !== -1) {
      const width = index - run
      // 注意 some 的回调收到的是元素值不是下标——直接判值
      const hasLeft = counts.slice(margin, run).some(count => count > 0)
      const hasRight = counts.slice(index, bins - margin).some(count => count > 0)
      if (width >= 2 && hasLeft && hasRight && (best === undefined || width > best.width)) {
        best = { start: run, end: index, width }
      }
      run = -1
    }
  }
  if (best === undefined) return undefined
  return (best.start + best.end) / 2 * binWidth
}

/** 行重建：y 容差分桶 → 桶内 x 升序 → 按间距补空格。 */
export function buildLines(items: readonly TextItemLike[]): Array<{
  text: string
  x0: number
  x1: number
  y: number
  height: number
  size: number
  suspicious: boolean
}> {
  if (items.length === 0) return []
  const heights = items.map(item => item.height).sort((a, b) => a - b)
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 10
  const tolerance = Math.max(1.5, medianHeight * 0.5)
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const buckets: TextItemLike[][] = []
  for (const item of sorted) {
    const bucket = buckets[buckets.length - 1]
    if (bucket !== undefined && Math.abs((bucket[0]?.y ?? 0) - item.y) <= tolerance) {
      bucket.push(item)
    } else {
      buckets.push([item])
    }
  }
  return buckets.map(bucket => {
    const ordered = [...bucket].sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd = Number.NaN
    for (const item of ordered) {
      if (text !== '' && !/\s$/.test(text) && !Number.isNaN(prevEnd)) {
        const gap = item.x - prevEnd
        if (gap > item.height * 0.2) text += ' '
      }
      text += item.str
      prevEnd = item.x + item.width
    }
    const x0 = ordered[0]?.x ?? 0
    const last = ordered[ordered.length - 1]
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      x0,
      x1: (last?.x ?? 0) + (last?.width ?? 0),
      y: ordered[0]?.y ?? 0,
      height: medianHeight,
      size: Math.max(...ordered.map(item => item.height)),
      suspicious: false,
    }
  }).filter(line => line.text !== '')
}

interface ColumnLine {
  readonly text: string
  readonly x0: number
  readonly x1: number
  readonly y: number
  readonly height: number
  readonly size: number
  readonly suspicious: boolean
}

/** 块切分：同栏相邻行、行距 ≤1.8×行高 → 同段；换栏/大间距/字号跳变断块。 */
interface RawBlock {
  text: string
  firstLine: string
  x0: number
  x1: number
  yTop: number
  yBottom: number
  suspicious: boolean
  size: number
  lineCount: number
}

function groupBlocks(lines: readonly ColumnLine[]): RawBlock[] {
  const blocks: RawBlock[] = []
  for (const line of lines) {
    const prev = blocks[blocks.length - 1]
    const gap = prev === undefined ? Number.POSITIVE_INFINITY : prev.yBottom - line.y
    const sameFlow = prev !== undefined
      && gap > 0 && gap <= prev.size * 1.8
      && Math.abs(prev.size - line.size) <= Math.max(1, prev.size * 0.35)
    if (sameFlow && prev !== undefined) {
      blocks[blocks.length - 1] = {
        text: `${prev.text} ${line.text}`,
        firstLine: prev.firstLine,
        x0: Math.min(prev.x0, line.x0),
        x1: Math.max(prev.x1, line.x1),
        yTop: prev.yTop,
        yBottom: line.y - line.height,
        suspicious: prev.suspicious || line.suspicious,
        size: Math.max(prev.size, line.size),
        lineCount: prev.lineCount + 1,
      }
    } else {
      blocks.push({
        text: line.text,
        firstLine: line.text,
        x0: line.x0,
        x1: line.x1,
        yTop: line.y,
        yBottom: line.y - line.height,
        suspicious: line.suspicious,
        size: line.size,
        lineCount: 1,
      })
    }
  }
  return blocks
}

/** kind 启发式（保守：只判 title/heading/abstract，其余 para）。 */
function kindOf(block: { text: string; firstLine: string; size: number; lineCount: number }, bodySize: number, page: number, firstOnPageOne: boolean): BlockKind {
  const first = block.firstLine
  if (firstOnPageOne && block.lineCount <= 3 && block.size >= bodySize * 1.15 && block.text.length <= 200) return 'title'
  // 标题常与正文同号（粗体在字形里，文本层看不到）且后紧跟正文（间距小于
  // 段合并阈值）→ 用**首行**判、允许标题后带少量正文（lineCount ≤ 3）
  if (block.lineCount <= 3 && first.length <= 120
    && (/^\d+(\.\d+)*\s+\S/.test(first) || /^(abstract|introduction|related work|conclusion|references|摘要|引言|结论)/i.test(first))) {
    return first.toLowerCase().startsWith('abstract') || first.startsWith('摘要') ? 'abstract' : 'heading'
  }
  return 'para'
}

/** 全文抽取：pages 页 → 阅读序块表。 */
export async function extractPdfBlocks(data: Uint8Array): Promise<ExtractResult> {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: false,
    ...(standardFontDataUrl() !== undefined ? { standardFontDataUrl: standardFontDataUrl() } : {}),
  }).promise
  const blocks: ExtractedBlock[] = []
  let order = 0
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items: TextItemLike[] = []
    for (const raw of content.items) {
      if (!('str' in raw) || typeof raw.str !== 'string' || raw.str.trim() === '') continue
      const item = raw as { str: string; transform: number[]; width: number; height: number }
      // 旋转文本（arXiv 侧边竖排水印等）不参与正文：transform 前 two 列是
      // 旋转向量，|b| 或 |c| 显著非零即非水平
      const b = item.transform[1] ?? 0
      const c = item.transform[2] ?? 0
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue
      items.push({
        str: item.str,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        width: item.width ?? 0,
        height: item.height ?? 10,
      })
    }
    if (items.length === 0) continue
    const gutter = detectGutter(items, viewport.width)
    let pageLines: ColumnLine[]
    if (gutter === undefined) {
      pageLines = buildLines(items)
    } else {
      // 逐 item 按中心归栏；显著跨栏者留单栏处理并标 suspicious
      const left: TextItemLike[] = []
      const right: TextItemLike[] = []
      const straddlers: TextItemLike[] = []
      for (const item of items) {
        const x0 = item.x
        const x1 = item.x + item.width
        if (x0 < gutter && x1 > gutter && Math.min(x1 - gutter, gutter - x0) > item.width * 0.1) straddlers.push(item)
        else if (item.x + item.width / 2 < gutter) left.push(item)
        else right.push(item)
      }
      const leftLines = buildLines(left)
      const rightLines = buildLines(right)
      pageLines = [...leftLines, ...rightLines]
      if (straddlers.length > 0) {
        for (const line of [...buildLines(straddlers)]) {
          pageLines.push({ ...line, suspicious: true })
        }
      }
    }
    const sizes = [...pageLines].map(line => line.size).sort((a, b) => a - b)
    const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 10
    let perPage = 0
    for (const block of groupBlocks(pageLines)) {
      perPage += 1
      blocks.push({
        id: `p${pageNumber}-b${perPage}`,
        page: pageNumber,
        kind: kindOf(block, bodySize, pageNumber, pageNumber === 1 && order === 0),
        order,
        text: block.text,
        bbox: { x0: block.x0, yTop: block.yTop, x1: block.x1, yBottom: block.yBottom },
        quality: block.suspicious ? 'suspicious' : 'ok',
      })
      order += 1
    }
  }
  return { pages: doc.numPages, blocks }
}
