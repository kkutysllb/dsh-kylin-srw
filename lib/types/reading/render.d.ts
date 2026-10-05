/** paper.md 渲染与解析（0205 Task 4.6 / R6）：双语正文，块锚
 * `<!-- srw:<id> ... -->` 把每一段钉死在 source_map 的块上——译文永远
 * 绑定真实源段（结构性防幻觉）。解析与渲染互为逆操作，verify 消费解析结果。 */
import type { SourceMap } from './source-map.ts';
export type BlockState = 'verified' | 'mismatch' | 'orphan';
declare const ANCHOR_RE: RegExp;
declare const ZH_MARK = "<!-- srw:zh -->";
declare const END_MARK = "<!-- /srw -->";
export interface ParsedBlock {
    readonly id: string;
    readonly kind?: string;
    readonly declaredState?: string;
    readonly sourceText: string;
    readonly translation?: string;
}
/** 解析 paper.md → 块序列（锚顺序）。格式不合法的锚忽略。 */
export declare function parsePaper(markdown: string): readonly ParsedBlock[];
/** 渲染双语 paper.md：每块 = 锚 + 源文（+ 译文）。 */
export declare function renderPaper(sourceMap: SourceMap, translations: Readonly<Record<string, string>>, states?: Readonly<Record<string, BlockState>>): string;
/** 带源文的渲染（正常路径）：sources = id → 原文文本。 */
export declare function renderPaperWithSources(sourceMap: SourceMap, sources: Readonly<Record<string, string>>, translations: Readonly<Record<string, string>>, states?: Readonly<Record<string, BlockState>>): string;
export { ANCHOR_RE, END_MARK, ZH_MARK };
