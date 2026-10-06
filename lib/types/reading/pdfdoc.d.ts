/** 精读结果 PDF（译注版，0205 附记四）：`readings/<YYYY-MM-DD>/<paperKey>.pdf`。
 * 结构对齐用户既往精读成果（递归自我改进综述·中文精读译注版）：
 * 封面信息表 → 阅读指南 → 全文导读（LLM）→ 论文信息 → 正文全译（逐段双语
 * + 每节【本节速览】与 ◆精读备注盒 + 图内标注）→ 附录（图表清单/术语对照表/
 * 参考文献英文原样/译注体例与免责说明）→ 页眉页脚。
 * 宿主没有 PDF 生成能力 → pdfkit 自带依赖（0102 §7.1.2 纪律）；CJK 用系统
 * 字体回退链，glyph 子集内嵌——产物可移植。 */
export interface PdfParagraphInput {
    readonly id: string;
    readonly kind?: string;
    readonly state: 'verified' | 'mismatch' | 'orphan';
    readonly sourceText: string;
    readonly translation?: string;
}
export interface PdfSectionNote {
    readonly summary: string;
    readonly note: string;
}
export interface ReadingPdfInput {
    readonly paperKey: string;
    /** 封面中文标题（title 块译文，无则源文）。 */
    readonly titleZh: string;
    /** 封面英文原题（title 块源文）。 */
    readonly titleEn: string;
    /** 作者与单位（title 后第一段的启发式；拿不到则不出现在封面）。 */
    readonly authors?: string;
    readonly pdfPath?: string;
    readonly exportedAt: string;
    readonly model?: string;
    readonly glossary?: Readonly<Record<string, string>>;
    /** 全文导读（notes.guide；未生成则封面注明）。 */
    readonly guide?: string;
    /** 每节批注：heading 块 id → 速览+备注。 */
    readonly sectionNotes?: Readonly<Record<string, PdfSectionNote>>;
    readonly summary: {
        readonly pages: number;
        readonly blocks: number;
        readonly translated: number;
        readonly verified: number;
        readonly mismatch: number;
        readonly orphan: number;
        readonly missing: number;
    };
    /** 正文阅读流（不含 references/figlabel/furniture）。 */
    readonly flow: readonly PdfParagraphInput[];
    /** 参考文献段（英文原样）。 */
    readonly references: readonly PdfParagraphInput[];
    /** 图内标注：图注块 id → 标注碎片（源文，随图注呈现）。 */
    readonly figureNotes?: Readonly<Record<string, readonly string[]>>;
    /** 附录 A 图表清单（caption 段 + 所在页）。 */
    readonly figureList?: readonly {
        readonly text: string;
        readonly page: number;
    }[];
}
export declare function resolveCjkFont(): {
    readonly path: string;
    readonly name?: string;
} | undefined;
/** 译注版 PDF。 */
export declare function renderReadingPdf(input: ReadingPdfInput): Promise<Buffer>;
