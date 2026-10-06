/** PDF 抽取器（0205 Task 4.2 / R6）：自带 pdfjs-dist legacy Node build
 * （宿主无主机侧抽取能力——0102 §7.1.2 一手核对）。管线：items → 分栏
 * 识别（x 中心直方图两簇 + gutter）→ 行重建（y 容差分桶、x 升序、间距
 * 补空格）→ 块切分（同栏相邻行、行距近）→ 质量分级。
 *
 * **双栏绝不能全页按 y 排序**（会左右交错）——先分栏、栏内再序。 */
export type BlockKind = 'title' | 'abstract' | 'heading' | 'para' | 'list' | 'caption' | 'table' | 'formula' | 'reference' | 'code' | 'footnote'
/** 版面杂讯（页眉/页脚/license 行/日期行）：不进正文、不翻译。 */
 | 'furniture'
/** 图表内部的标注碎片（坐标轴标签/图例文字）：不进正文，归到所属图注的
 * 「图内标注」。 */
 | 'figlabel';
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
    /** 块内最大行字号（pt）——版面判别（标题/杂讯）依据；source_map 不存。 */
    readonly size: number;
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
/** 版面二次判别（0205 附记四）：kindOf 只看块自身，这一遍看**版面语境**——
 * 页缘杂讯（页眉日期/license 行）、p1 标题重选、参考文献段、图内标注碎片。
 * 顺带让"参考文献英文原样保留""图内标注归图注"成为可能。 */
export declare function refineBlocks(blocks: readonly ExtractedBlock[], pageHeights: Readonly<Record<number, number>>): ExtractedBlock[];
/** 不参与翻译的版面 kind：furniture 无语义；figlabel 归图注「图内标注」
 * 呈现；reference 英文原样保留（译注版体例，0205 附记四）。 */
export declare const UNTRANSLATED_KINDS: ReadonlySet<string>;
/** 全文抽取：pages 页 → 阅读序块表。 */
export declare function extractPdfBlocks(data: Uint8Array): Promise<ExtractResult>;
export {};
