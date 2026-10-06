/** 预算门（0205 Task 4.10）：开工前给「块数 × 估均 token」——超预算必须
 * 确认；预估 vs 实际误差入账（校准下一次估算）。纯函数 + 状态封装。 */

export interface BudgetEstimate {
  readonly blocks: number
  readonly estimatedTokens: number
  readonly budget: number
  readonly needsConfirmation: boolean
}

/** 粗估：源字符 → token 系数（英文学术文本 ≈ 4 chars/token，译文略多）。
 * 均值可由历史实际值覆盖（charsPerToken 缺省 4）。 */
export function estimate(blocks: readonly { readonly chars: number }[], budget: number, charsPerToken = 4): BudgetEstimate {
  const totalChars = blocks.reduce((sum, block) => sum + block.chars, 0)
  const estimatedTokens = Math.ceil((totalChars / charsPerToken) * 2) // 源+译双份
  return {
    blocks: blocks.length,
    estimatedTokens,
    budget,
    needsConfirmation: budget > 0 && estimatedTokens > budget,
  }
}

export interface CalibrationRecord {
  readonly estimated: number
  readonly actual: number
  readonly at: string
}

/** 误差入账：ratio = actual/estimated（>1 = 低估）。 */
export function calibrationRatio(records: readonly CalibrationRecord[]): number | undefined {
  if (records.length === 0) return undefined
  const sum = records.reduce((acc, record) => acc + record.actual / Math.max(1, record.estimated), 0)
  return sum / records.length
}
