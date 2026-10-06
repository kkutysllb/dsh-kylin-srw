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
/** 骨架：sections 顺序取 venue.sectionOrder；必列章节缺失时仍按全序生成
 * （合规检查会提示缺声明/缺节——骨架先给全，作者自行删）。 */
export declare function renderScaffold(input: {
    readonly venue: VenueSchema;
    readonly title: string;
    readonly authors?: string;
    readonly abstract?: string;
}): ScaffoldPlan;
