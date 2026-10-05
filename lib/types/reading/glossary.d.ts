/** 术语表硬约束（0205 Task 4.5 / R6）：术语命中必须用指定译名——不是提示。
 * 两道闸：① 输入侧：术语表写进 prompt（translator 已做）；② 输出侧：
 * 译后校验——译文中出现术语原文（且术语是多字节/拉丁词）即判违规，
 * 替换为指定译名（可配置替换或仅报告）。 */
export interface Glossary {
    /** 源术语（小写匹配）→ 指定译名。 */
    readonly entries: Readonly<Record<string, string>>;
}
export declare function glossaryHash(glossary: Glossary): string;
/** 译文中命中术语原文的位置（词边界敏感：拉丁词按 \b，CJK 直接 indexOf）。 */
export declare function findViolation(translation: string, term: string): boolean;
export interface GlossaryCheck {
    readonly violations: readonly string[];
    /** 替换后的译文（repair=false 时与输入相同）。 */
    readonly repaired: string;
}
/** 译后硬约束：report 违规；repair=true 时把术语原文替换为指定译名。 */
export declare function enforceGlossary(translation: string, glossary: Glossary, repair?: boolean): GlossaryCheck;
/** 判定哪些块的缓存受术语表变更影响：返回「涉及的术语集合」与旧表有
 * 差异的块（srcText 含任一变更术语）。 */
export declare function affectedBlocks(blockTexts: readonly {
    readonly id: string;
    readonly srcText: string;
}[], changedTerms: readonly string[]): readonly string[];
