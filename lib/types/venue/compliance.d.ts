/** 合规检查（R5 的机读出口）：把深度档阈值 + 刊物要求变成 `checks[]`——
 * 每条 `{id, level, pass, actual, expected, where}`，UI 可点跳转整改。
 * **confidence 语义**：venue 为 `unverified` 时所有检查降为 `warn`（只建议）；
 * `verified`（人工核定过）才可能出现 `error` 阻断级。 */
import type { DepthTier, VenueSchema } from './types.ts';
export type ComplianceLevel = 'error' | 'warn';
export interface ComplianceFacts {
    /** 编译产物页数（无引擎/未编译时 undefined → 检查项 pass=undefined 不判）。 */
    readonly pages?: number | undefined;
    readonly sections: readonly string[];
    readonly figures: number;
    readonly tables: number;
    readonly referenceCount: number;
    /** 已存在的声明节/声明字段（如 'Data Availability' 节标题或 \section*）。 */
    readonly statementsPresent: readonly string[];
    readonly hasAppendix: boolean;
}
export interface ComplianceCheck {
    readonly id: string;
    readonly level: ComplianceLevel;
    /** undefined = 事实缺失，无法判定（提示补事实，不算不过）。 */
    readonly pass: boolean | undefined;
    readonly actual: string;
    readonly expected: string;
    /** 跳转落点（面板用：'sections'/'refs.bib'/'main.tex'/节名）。 */
    readonly where: string;
}
/** 跑全部合规检查。order 固定：篇幅 → 章节 → 声明 → 图表 → 文献 → 附录。 */
export declare function runCompliance(input: {
    readonly venue: VenueSchema;
    /** 档位：项目 project.json 的 depthTier，覆盖 venue.depthTier。 */
    readonly tier: DepthTier;
    readonly facts: ComplianceFacts;
}): readonly ComplianceCheck[];
export declare const STATEMENT_LABELS: Readonly<Record<string, string>>;
