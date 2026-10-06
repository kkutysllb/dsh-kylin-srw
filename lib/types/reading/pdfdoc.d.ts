/** 精读结果 PDF 归档（0205 附记一/三）：`readings/<YYYY-MM-DD>/<paperKey>.pdf`。
 * **整篇逐段双语**：段落连续（段落装配层产出），原文一段 + 译文一段，
 * 标题/标题行分级排版；只有出问题的段才亮 ⚠（verified 段零 chunk 痕迹）。
 * 宿主没有 PDF 生成能力 → pdfkit 自带依赖（0102 §7.1.2 纪律）；CJK 用系统
 * 字体回退链（Hiragino/PingFang/Songti/Arial Unicode/Noto），glyph 子集内嵌
 * ——产物可移植，生成机只要求装有一个候选字体。 */
export interface PdfParagraphInput {
    readonly id: string;
    readonly kind?: string;
    readonly state: 'verified' | 'mismatch' | 'orphan';
    readonly sourceText: string;
    readonly translation?: string;
}
export interface ReadingPdfInput {
    readonly paperKey: string;
    /** 标题：title 块源文，回退 paperKey。 */
    readonly title: string;
    readonly pdfPath?: string;
    readonly exportedAt: string;
    readonly model?: string;
    readonly summary: {
        readonly pages: number;
        readonly blocks: number;
        readonly translated: number;
        readonly verified: number;
        readonly mismatch: number;
        readonly orphan: number;
        readonly missing: number;
    };
    readonly paragraphs: readonly PdfParagraphInput[];
}
export declare function resolveCjkFont(): {
    readonly path: string;
    readonly name?: string;
} | undefined;
/** 整篇逐段双语 PDF：封面摘要 → 标题/标题行/正文段连续排版（原文段灰、
 * 译文段黑）→ 页脚页码。 */
export declare function renderReadingPdf(input: ReadingPdfInput): Promise<Buffer>;
