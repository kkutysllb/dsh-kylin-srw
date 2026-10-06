/** 精读推荐与 G2 同意门（0205 Task 4.9）：库内 unread 条目按引用数/新旧
 * 打分排序 → 推荐一批；同意（进入精读队列）/拒绝（不再推）/换一批（下翻）。
 * 状态机纯函数。 */
export interface RecommendCandidate {
    readonly key: string;
    readonly title: string;
    readonly citedByCount?: number;
    readonly year: number;
    readonly status: string;
}
export interface Recommendation {
    readonly key: string;
    readonly title: string;
    readonly score: number;
}
export interface RecommendationState {
    /** 已拒绝：不再出现在任何批次。 */
    readonly rejected: readonly string[];
    /** 已同意：进入精读队列。 */
    readonly accepted: readonly string[];
}
export declare const INITIAL_RECOMMENDATION_STATE: RecommendationState;
/** 出一批推荐：unread + 未拒绝 + 未同意，按分排序取前 limit。 */
export declare function recommendBatch(candidates: readonly RecommendCandidate[], state: RecommendationState, limit?: number): readonly Recommendation[];
/** G2 门动作。 */
export declare function acceptRecommendation(state: RecommendationState, key: string): RecommendationState;
export declare function rejectRecommendation(state: RecommendationState, key: string): RecommendationState;
