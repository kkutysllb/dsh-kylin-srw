/** 骨架生成（Task 5.2）：按 venue schema 渲染 main.tex + sections/ 空节 +
 * refs.bib 占位。宏包单链：algorithm/booktabs/tikz/pgfplots（ADR-12 的
 * M5 部分）；中文刊物（lang=zh）走 ctexart，节名中文。 */
import type { VenueSchema } from '../venue/types.ts';
export interface ScaffoldPlan {
    readonly mainTex: string;
    /** 相对路径 → 内容（sections/*.tex 与 refs.bib）。 */
    readonly files: Readonly<Record<string, string>>;
    readonly sections: readonly string[];
}
/** main.tex 的输入清单标记：outline.save/confirm 与 compile 都按这对标记
 * 重写同一段，避免「大纲改名、正文写进不被编译的文件」静默丢节。 */
export declare const INPUT_BEGIN = "% srw:inputs:begin";
export declare const INPUT_END = "% srw:inputs:end";
/** 章节文件相对路径的合法形状（防大纲里写入 ../ 或绝对路径）。 */
export declare function isSafeSectionFile(file: string): boolean;
/** 把 \input 里的路径归一成相对 .tex（sections/01-intro → sections/01-intro.tex）。 */
export declare function normalizeInputPath(raw: string): string;
/** 从 main.tex 提取 sections/ 输入清单（保持出现顺序）。 */
export declare function sectionInputPaths(mainTex: string): string[];
/** 用大纲的章节文件重写 main.tex 的输入清单。
 * 新项目走标记块；旧项目（无标记）替换第一段连续的 \input{sections/…}；
 * 都没有则插到 \bibliographystyle/\bibliography 之前（最后退 \end{document}）。 */
export declare function syncInputBlock(mainTex: string, sections: readonly {
    readonly title: string;
    readonly file: string;
}[]): string;
/** 骨架：sections 顺序取 venue.sectionOrder；必列章节缺失时仍按全序生成
 * （合规检查会提示缺声明/缺节——骨架先给全，作者自行删）。 */
export declare function renderScaffold(input: {
    readonly venue: VenueSchema;
    readonly title: string;
    readonly authors?: string;
    readonly abstract?: string;
}): ScaffoldPlan;
