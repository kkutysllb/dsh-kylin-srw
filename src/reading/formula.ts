/** 公式/表格诚实策略（0205 Task 4.10 / R6）：glyph 重建不出语义 LaTeX——
 * ① 优先 arXiv 源码/ar5iv 取 LaTeX（best-effort，失败不阻断）；
 * ② 取不到 → 公式区域占位块（page+bbox），渲染由视图层浏览器 pdf.js
 *    裁剪成图，明确标注「图像，非可编辑源」。 */

import { gatedFetchText } from '../literature/http.ts'
import type { RateGate } from '../literature/rate-gate.ts'
import type { BBox } from './extract.ts'

export interface FormulaBlock {
  readonly kind: 'formula' | 'table'
  readonly page: number
  readonly bbox: BBox
  /** arXiv 源码路径下取到的 LaTeX（有则可编辑；无则图像占位）。 */
  readonly latex?: string
  /** 图像占位引用（视图层按 page+bbox 用 pdf.js 裁剪渲染）。 */
  readonly imageRef?: { readonly page: number; readonly bbox: BBox }
  readonly note: string
}

/** 从块文本判公式/表格嫌疑：公式符号密度（=、∑、∫、^、_、\\frac 等）。 */
export function looksLikeFormula(text: string): boolean {
  const symbols = (text.match(/[=∑∫∏√^_]|\bfrac\b|\balpha\b|\bbeta\b|\btheta\b/g) ?? []).length
  return symbols >= 3 && /[a-zA-Z]/.test(text)
}

export function looksLikeTable(text: string): boolean {
  return /\b(Table|表)\s*\d+/i.test(text) || (text.split(/\s{2,}/).length >= 4 && /\d/.test(text))
}

/** arXiv 源码取 LaTeX（best-effort）：e-print 返回 tar/gz——这里只做
 * 轻量探测（ar5iv HTML 的公式），tar 解包不做（依赖成本 > 收益，M5+）。
 * 拿不到返回 undefined，绝不抛错阻断。 */
export async function fetchFormulaLatex(deps: {
  gate: RateGate
}, arxivId: string, hint: string): Promise<string | undefined> {
  try {
    const url = new URL(`https://ar5iv.labs.arxiv.org/html/${encodeURIComponent(arxivId)}`)
    const html = await gatedFetchText(deps.gate, url)
    // 粗匹配：含 hint 片段的第一个 <math alttext="..."> 的 alttext
    const escaped = hint.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = html.match(new RegExp(`alttext="([^"]{4,400})"[^>]*>[^<]*<semantics[^>]*>[\\s\\S]{0,400}?${escaped}`))
    return match?.[1]
  } catch {
    return undefined
  }
}

/** 占位块构造：无 LaTeX 时唯一诚实出口。 */
export function placeholderFormulaBlock(page: number, bbox: BBox, kind: 'formula' | 'table' = 'formula'): FormulaBlock {
  return {
    kind,
    page,
    bbox,
    imageRef: { page, bbox },
    note: '公式/表格为图像，非可编辑源（视图层按 page+bbox 裁剪渲染）',
  }
}
