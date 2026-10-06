/** 公式/表格诚实策略（0205 Task 4.10 / R6）：glyph 重建不出语义 LaTeX——
 * ① 优先 arXiv 源码/ar5iv 取 LaTeX（best-effort，失败不阻断）；
 * ② 取不到 → 公式区域占位块（page+bbox），渲染由视图层浏览器 pdf.js
 *    裁剪成图，明确标注「图像，非可编辑源」。 */
import type { RateGate } from '../literature/rate-gate.ts';
import type { BBox } from './extract.ts';
export interface FormulaBlock {
    readonly kind: 'formula' | 'table';
    readonly page: number;
    readonly bbox: BBox;
    /** arXiv 源码路径下取到的 LaTeX（有则可编辑；无则图像占位）。 */
    readonly latex?: string;
    /** 图像占位引用（视图层按 page+bbox 用 pdf.js 裁剪渲染）。 */
    readonly imageRef?: {
        readonly page: number;
        readonly bbox: BBox;
    };
    readonly note: string;
}
/** 从块文本判公式/表格嫌疑：公式符号密度（=、∑、∫、^、_、\\frac 等）。 */
export declare function looksLikeFormula(text: string): boolean;
export declare function looksLikeTable(text: string): boolean;
/** arXiv 源码取 LaTeX（best-effort）：e-print 返回 tar/gz——这里只做
 * 轻量探测（ar5iv HTML 的公式），tar 解包不做（依赖成本 > 收益，M5+）。
 * 拿不到返回 undefined，绝不抛错阻断。 */
export declare function fetchFormulaLatex(deps: {
    gate: RateGate;
}, arxivId: string, hint: string): Promise<string | undefined>;
/** 占位块构造：无 LaTeX 时唯一诚实出口。 */
export declare function placeholderFormulaBlock(page: number, bbox: BBox, kind?: 'formula' | 'table'): FormulaBlock;
