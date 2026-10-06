/** 译注版分析层（0205 附记四）：全文导读 + 每节【本节速览】/◆精读备注。
 * 翻译给出「说了什么」，这一层给出「怎么读」——参照用户既往精读成果的
 * 译注版体例。LLM 经窄面（宿主默认模型）逐节生成；输出是**结构化文本**
 * （字段行约定），不做 JSON——LLM 的 JSON 可靠性不够支撑逐字段渲染。 */
import type { LlmPort } from './translator.ts';
import type { ReadingSection } from './paragraphs.ts';
export interface SectionNote {
    /** 【本节速览】2-4 行（每行一条提要）。 */
    readonly summary: string;
    /** ◆精读备注：要点/概念/论证/证据/评述 字段行。 */
    readonly note: string;
}
export interface NotesFile {
    readonly version: 1;
    readonly model: string;
    readonly at: string;
    /** 全文导读（多行结构化文本）；undefined = 未生成。 */
    readonly guide?: string;
    readonly sections: Readonly<Record<string, SectionNote>>;
}
export declare function emptyNotesFile(model: string): NotesFile;
export declare const SECTION_SYSTEM_PROMPT: string;
export declare const GUIDE_SYSTEM_PROMPT: string;
export declare function buildSectionPrompt(section: ReadingSection): string;
export interface GuideInput {
    readonly title: string;
    readonly abstract?: string;
    readonly headings: readonly string[];
}
export declare function buildGuidePrompt(input: GuideInput): string;
/** 解析节批注输出：以【本节速览】/◆精读备注 分段；字段缺失时整段退为
 * note（宁可有内容、不做假结构）。 */
export declare function parseSectionOutput(text: string): {
    summary: string;
    note: string;
};
export interface NotesDeps {
    readonly llm: LlmPort;
    readonly provider: string;
    readonly model: string;
    /** 逐节 deadline（默认 90s）。 */
    readonly timeoutMs?: number;
}
/** 生成全文导读。 */
export declare function generateGuide(deps: NotesDeps, input: GuideInput): Promise<string>;
/** 生成一节的速览 + 备注。 */
export declare function generateSectionNote(deps: NotesDeps, section: ReadingSection): Promise<SectionNote>;
