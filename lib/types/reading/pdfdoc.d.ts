/** 精读结果 PDF 归档（用户指令：项目工作区独立子目录、按日期归档）：
 * `readings/<YYYY-MM-DD>/<paperKey>.pdf`。宿主没有 PDF 生成能力 → pdfkit
 * 自带依赖（0102 §7.1.2 同一纪律）。CJK 用系统字体回退链（Hiragino/
 * PingFang/Songti/Arial Unicode/Noto），glyph 子集内嵌——产物可移植，
 * 生成机只要求装有一个候选字体。 */
export interface PdfBlockInput {
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
    readonly blocks: readonly PdfBlockInput[];
}
export declare function resolveCjkFont(): {
    readonly path: string;
    readonly name?: string;
} | undefined;
/** 双语 PDF：头部摘要 → 逐块（灯 + 源段 + 译文）→ 页脚页码。 */
export declare function renderReadingPdf(input: ReadingPdfInput): Promise<Buffer>;
