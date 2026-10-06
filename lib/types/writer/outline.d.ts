/** 大纲一级真相源（Task 5.4 / 0102 §6.2）：`outline.json` 是章节树的唯一
 * 权威——正文节文件按它对齐。**G1 确认门**：`draft→confirmed` 由用户显式
 * 确认（落 revision+时间戳）；未确认的大纲**禁止触发正文生成**（门在
 * 服务层硬编码，不是提示词请求）。
 *
 * LLM 生成部分（章节意图/正文）走 agent 车道——本模块只管状态机与文件。 */
import type { DepthTier } from '../venue/types.ts';
export type OutlineStatus = 'draft' | 'confirmed';
export interface OutlineSection {
    readonly id: string;
    readonly title: string;
    /** 一句话本节意图（写给起草者看）。 */
    readonly intent: string;
    readonly targetWords: number;
    readonly status: OutlineStatus;
    /** 正文节文件（paper/ 内相对路径）——outline.save 按序分配，同名沿用。 */
    readonly file?: string;
}
export interface Outline {
    readonly schemaVersion: 1;
    readonly status: OutlineStatus;
    readonly confirmedAt?: string;
    /** 每次确认 +1——正文生成产物挂 revision，确认后改大纲必先落新 revision。 */
    readonly revision: number;
    readonly sections: readonly OutlineSection[];
}
export declare function emptyOutline(sections?: readonly {
    title: string;
    intent: string;
}[]): Outline;
/** 解析项目内 outline.json（坏数据 → INVALID；文件级 I/O 在服务层）。 */
export declare function parseOutline(raw: string): Outline;
export declare function serializeOutline(outline: Outline): string;
/** 确认（G1 通过动作）：draft → confirmed，revision+1。已确认再确认 →
 * 幂等返回原文（revision 不动）。 */
export declare function confirmOutline(outline: Outline): Outline;
/** 确认后又改大纲 → 打回 draft（revision 保持——改后的内容还没被确认过）。 */
export declare function draftOutline(outline: Outline, sections: readonly OutlineSection[]): Outline;
/** G1 门检查：正文生成只认 confirmed。 */
export declare function assertConfirmed(outline: Outline): void;
/** 落点①：大纲生成的 agent 提示词包（分档给章节骨架与目标字数）。 */
export declare function outlinePrompt(input: {
    readonly tier: DepthTier;
    readonly topic: string;
    readonly venueName: string;
}): string;
