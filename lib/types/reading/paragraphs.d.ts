/** 段落装配（呈现层，0205 附记三/四）：把抽取块序列装配成「整篇逐段」的
 * 阅读段落。source_map/缓存/verify 全部仍以**块**为基底层（不动、不重译），
 * 装配只发生在 paper.md 解析之后、呈现（面板/归档 PDF）之前——块级正确性
 * 锚与段落级阅读体验分层。
 *
 * 译注版（0205 附记四）：正文流里不再出现版面杂讯（furniture）、图内标注
 * 碎片（figlabel，归到所属图注做「图内标注」）与参考文献（reference，英文
 * 原样单独收集）——分别进 references / figureNotes 通道。 */
import type { BlockState, ParsedBlock } from './render.ts';
export interface ReadingParagraph {
    /** 段首块 id（笔记/定位仍可挂块，段 id 只是段首块的别名）。 */
    readonly id: string;
    readonly blockIds: readonly string[];
    readonly kind?: string;
    readonly sourceText: string;
    readonly translation?: string;
    /** 段内最坏块状态：mismatch > orphan > verified。 */
    readonly state: BlockState;
}
export interface AssembledReading {
    /** 正文阅读流：标题/摘要/标题行/图注/正文段（连续双语）。 */
    readonly flow: readonly ReadingParagraph[];
    /** 参考文献段（英文原样，不译）。 */
    readonly references: readonly ReadingParagraph[];
    /** 图内标注：图注块 id → 该图内的标注碎片（按阅读序）。 */
    readonly figureNotes: Readonly<Record<string, readonly string[]>>;
}
/** 跨块拼句：前块以行尾连字符收 → 去连字符直拼；CJK 邻接不加空格；
 * 其余补一个空格。 */
export declare function joinTexts(a: string, b: string): string;
export declare function worstState(states: readonly BlockState[]): BlockState;
/** 装配规则（保守，呈现层错误零成本所以宁缺毋滥）：仅 para↔para 且前块
 * 不以句末标点收尾才合并——标题/图注/列表项永不并入正文段；跨页/跨栏
 * 自然续接（阅读序已由抽取层按分栏排好）。 */
export declare function assembleReading(blocks: readonly ParsedBlock[], states: Readonly<Record<string, BlockState>>): AssembledReading;
export interface ReadingSection {
    /** 节标题段 id；undefined = 首个标题行之前的导语部分（题名/摘要）。 */
    readonly headingId: string | undefined;
    readonly headingSource: string;
    readonly headingTranslation?: string;
    readonly paragraphs: readonly ReadingParagraph[];
}
/** 分节：标题行切块（导语部分 headingId=undefined）。精读备注按节生成。 */
export declare function splitSections(flow: readonly ReadingParagraph[]): readonly ReadingSection[];
