/** 精读推荐与 G2 同意门（0205 Task 4.9）：库内 unread 条目按引用数/新旧
 * 打分排序 → 推荐一批；同意（进入精读队列）/拒绝（不再推）/换一批（下翻）。
 * 状态机纯函数。 */

export interface RecommendCandidate {
  readonly key: string
  readonly title: string
  readonly citedByCount?: number
  readonly year: number
  readonly status: string
}

export interface Recommendation {
  readonly key: string
  readonly title: string
  readonly score: number
}

export interface RecommendationState {
  /** 已拒绝：不再出现在任何批次。 */
  readonly rejected: readonly string[]
  /** 已同意：进入精读队列。 */
  readonly accepted: readonly string[]
}

export const INITIAL_RECOMMENDATION_STATE: RecommendationState = { rejected: [], accepted: [] }

const CURRENT_YEAR = 2026

function scoreOf(candidate: RecommendCandidate): number {
  let score = 0
  if (candidate.citedByCount !== undefined) score += Math.log10(candidate.citedByCount + 1) * 2
  score += Math.max(0, (candidate.year - (CURRENT_YEAR - 10)) / 10)
  return Math.round(score * 100) / 100
}

/** 出一批推荐：unread + 未拒绝 + 未同意，按分排序取前 limit。 */
export function recommendBatch(
  candidates: readonly RecommendCandidate[],
  state: RecommendationState,
  limit = 5,
): readonly Recommendation[] {
  const skipped = new Set([...state.rejected, ...state.accepted])
  return candidates
    .filter(candidate => candidate.status === 'unread' && !skipped.has(candidate.key))
    .map(candidate => ({ key: candidate.key, title: candidate.title, score: scoreOf(candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** G2 门动作。 */
export function acceptRecommendation(state: RecommendationState, key: string): RecommendationState {
  return { rejected: state.rejected, accepted: [...new Set([...state.accepted, key])] }
}

export function rejectRecommendation(state: RecommendationState, key: string): RecommendationState {
  return { rejected: [...new Set([...state.rejected, key])], accepted: state.accepted }
}
