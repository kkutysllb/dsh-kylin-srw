/** 审稿意见 → 响应信（8.3）：reviews/round-<n>/{reviews,responses}.json +
 * response.<md|tex>。证据门：responses 的每条 change 必须能在
 * paperDiff(baseSnapshotId, snapshotId) 中定位到 file+hunkIndex，否则
 * RESPONSE_UNBACKED——防「编造已修改」。门只证「引用存在」，不证「改得对」
 * （goals/02 R6）：结论须作者本人复核。 */
import type { PaperDiff } from './diff.ts';
export interface ReviewComment {
    readonly id: string;
    readonly text: string;
    readonly area?: string;
}
export interface ReviewEntry {
    readonly reviewer: string;
    readonly comments: readonly ReviewComment[];
}
export interface ReviewsFile {
    readonly schemaVersion: 1;
    readonly round: number;
    readonly venueId: string;
    /** 证据基线：首轮基线快照或上一轮投稿快照（respond 的 diff 以此为 from）。 */
    readonly baseSnapshotId: string;
    readonly reviews: readonly ReviewEntry[];
}
export interface ResponseChange {
    readonly snapshotId: string;
    readonly file: string;
    readonly hunkIndex: number;
    readonly note?: string;
}
export interface ResponseItem {
    readonly commentId: string;
    readonly response: string;
    readonly changes: readonly ResponseChange[];
}
export interface ResponsesFile {
    readonly schemaVersion: 1;
    readonly round: number;
    readonly baseSnapshotId: string;
    readonly items: readonly ResponseItem[];
}
export interface ReviewInput {
    readonly venueId: string;
    readonly baseSnapshotId: string;
    readonly reviews: readonly ReviewEntry[];
}
/** 开轮入参校验（服务层调用；错误码 INVALID）。 */
export declare function parseReviewInput(round: number, input: ReviewInput): ReviewsFile;
/** change 形状校验（不查 diff——证据门在 service 层做，因为要读盘）。 */
export declare function parseChanges(raw: unknown): readonly ResponseChange[];
export declare function findComment(reviews: ReviewsFile, commentId: string): {
    reviewer: string;
    comment: ReviewComment;
} | undefined;
export interface ExportInput {
    readonly reviews: ReviewsFile;
    readonly responses: readonly ResponseItem[];
    /** snapshotId → diff（service 层用 paperDiff(base, snapshotId) 预取）。 */
    readonly diffs: Readonly<Record<string, PaperDiff>>;
}
export declare function renderResponseMd({ reviews, responses, diffs }: ExportInput): string;
export declare function renderResponseTex({ reviews, responses, diffs }: ExportInput): string;
