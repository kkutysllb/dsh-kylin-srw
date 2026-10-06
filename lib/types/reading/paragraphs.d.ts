/** 段落装配（呈现层，0205 附记三）：把抽取块序列装配成「整篇逐段」的
 * 阅读段落。source_map/缓存/verify 全部仍以**块**为基底层（不动、不重译），
 * 装配只发生在 paper.md 解析之后、呈现（面板/归档 PDF）之前——块级正确性
 * 锚与段落级阅读体验分层。 */
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
/** 跨块拼句：前块以行尾连字符收 → 去连字符直拼；CJK 邻接不加空格；
 * 其余补一个空格。 */
export declare function joinTexts(a: string, b: string): string;
export declare function worstState(states: readonly BlockState[]): BlockState;
/** 装配规则（保守，呈现层错误零成本所以宁缺毋滥）：仅 para↔para 且前块
 * 不以句末标点收尾才合并——标题/图注/列表项永不并入正文段；跨页/跨栏
 * 自然续接（阅读序已由抽取层按分栏排好）。 */
export declare function assembleParagraphs(blocks: readonly ParsedBlock[], states: Readonly<Record<string, BlockState>>): readonly ReadingParagraph[];
