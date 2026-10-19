/** 投稿材料草稿（8.4）：submissions/draft.json 为状态真相源，每次 draft
 * 全量重渲染三件套 cover-letter.md / highlights.txt / declarations.tex。
 * 诚实性：刊物事实带 confidence（unverified → cover letter 显式「未核定」）；
 * 数据可得性从 experiments、data/registry.json 取证（authored 优先），取不到
 * 写「需作者确认」并进 warnings——D2/D3 pack 阻断在 8.6 消费。声明 label 按
 * venue.lang 取中/英（goals/02 R5）。纯函数 + 类型，IO 在 service 层。 */
import type { DepthTier, StatementKind, VenueSchema } from '../venue/types.ts';
export type StatementStatus = 'authored' | 'evidenced' | 'needs-author';
export interface StatementDraft {
    readonly id: StatementKind;
    readonly label: string;
    readonly text: string;
    readonly status: StatementStatus;
    /** status=evidenced 时的取证路径（experiments/<id>、data/registry.json）。 */
    readonly evidence?: readonly string[];
}
export interface SubmissionDraft {
    readonly schemaVersion: 1;
    readonly venueId: string;
    readonly venueConfidence: 'verified' | 'unverified';
    readonly tier: DepthTier;
    readonly lang: 'en' | 'zh';
    readonly round: number;
    readonly title: string;
    readonly coverLetterBody: string;
    readonly highlights: readonly string[];
    readonly statements: readonly StatementDraft[];
    readonly updatedAt: string;
}
export declare const STATEMENT_LABELS: Readonly<Record<StatementKind, {
    readonly en: string;
    readonly zh: string;
}>>;
/** 声明集：venue.mandatoryStatements 优先，空则按已应用档位的 profile。 */
export declare function statementKindsFor(venue: VenueSchema, tier: DepthTier): readonly StatementKind[];
export declare function newSubmissionDraft(venue: VenueSchema, tier: DepthTier, title: string): SubmissionDraft;
/** 落一笔草稿（返回新 draft；不改盘）。字段：coverLetter / highlights /
 * statement.<kind> / title / round。 */
export declare function applyDraftField(draft: SubmissionDraft, field: string, text: string): SubmissionDraft;
/** 重估自动状态：authored 永不被覆盖；dataAvailability 有取证则 evidenced；
 * 其余缺稿 → needs-author。同时产出 warnings（needs-author 与未起草项）。 */
export declare function refreshStatements(draft: SubmissionDraft, evidence: readonly string[]): {
    draft: SubmissionDraft;
    warnings: readonly string[];
};
export interface RenderedSubmission {
    readonly coverLetter: string;
    readonly highlights: string;
    readonly declarations: string;
}
export declare function renderSubmission(draft: SubmissionDraft): RenderedSubmission;
