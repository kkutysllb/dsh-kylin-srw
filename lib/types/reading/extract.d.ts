/** PDF 抽取器（0205 Task 4.2 / R6）：自带 pdfjs-dist legacy Node build
 * （宿主无主机侧抽取能力——0102 §7.1.2 一手核对）。管线：items → 分栏
 * 识别（x 中心直方图两簇 + gutter）→ 行重建（y 容差分桶、x 升序、间距
 * 补空格）→ 块切分（同栏相邻行、行距近）→ 质量分级。
 *
 * **双栏绝不能全页按 y 排序**（会左右交错）——先分栏、栏内再序。 */
export type BlockKind = 'title' | 'abstract' | 'heading' | 'para' | 'list' | 'caption' | 'table' | 'formula' | 'reference' | 'code' | 'footnote';
export type BlockQuality = 'ok' | 'suspicious';
export interface BBox {
    readonly x0: number;
    readonly yTop: number;
    readonly x1: number;
    readonly yBottom: number;
}
export interface ExtractedBlock {
    /** `p{page}-b{index}`（页内序）。 */
    readonly id: string;
    readonly page: number;
    readonly kind: BlockKind;
    /** 全文阅读序（0 起）。 */
    readonly order: number;
    readonly text: string;
    readonly bbox: BBox;
    readonly quality: BlockQuality;
}
export interface ExtractResult {
    readonly pages: number;
    readonly blocks: readonly ExtractedBlock[];
}
interface TextItemLike {
    readonly str: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
/** 分栏识别：x 中心直方图找「两簇 + 中间显著空带」。返回 gutter x 或
 * undefined（单栏）。 */
export declare function detectGutter(items: readonly TextItemLike[], pageWidth: number): number | undefined;
/** 行重建：y 容差分桶 → 桶内 x 升序 → 按间距补空格。 */
export declare function buildLines(items: readonly TextItemLike[]): Array<{
    text: string;
    x0: number;
    x1: number;
    y: number;
    height: number;
    size: number;
    suspicious: boolean;
}>;
/** 全文抽取：pages 页 → 阅读序块表。 */
export declare function extractPdfBlocks(data: Uint8Array): Promise<ExtractResult>;
export {};
