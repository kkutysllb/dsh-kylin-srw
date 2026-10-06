/** 深度档位 D1/D2/D3（0102 §7.3 的产品模型表）：本产品自建，不绑定刊物。
 * 三个落点之一（此处给阈值；另两个落点在 outline 提示词与 compliance 检查项）。
 * 数值即 0102 §7.3 的表——改动要回写架构文档。 */

import type { DepthTier, StatementKind } from './types.ts'

export interface DepthProfile {
  readonly pages: { readonly min: number; readonly max: number }
  readonly sections: { readonly min: number; readonly requireRelatedWork: boolean; readonly allowAppendix: boolean }
  readonly experiments: {
    readonly datasets: number
    readonly baselines: number
    readonly seeds: number
    readonly ablation: boolean
    readonly significance: boolean
    readonly costAnalysis: boolean
  }
  readonly figures: { readonly min: number; readonly max: number }
  readonly tables: { readonly min: number; readonly max: number }
  readonly references: { readonly min: number; readonly max: number }
  readonly statements: readonly StatementKind[]
  /** 复现材料清单（M6/M7 的证明链与实验要消费）。 */
  readonly repro: readonly string[]
}

export const DEPTH_PROFILES: Readonly<Record<DepthTier, DepthProfile>> = {
  D1: {
    pages: { min: 4, max: 6 },
    sections: { min: 4, requireRelatedWork: false, allowAppendix: false },
    experiments: { datasets: 1, baselines: 2, seeds: 1, ablation: false, significance: false, costAnalysis: false },
    figures: { min: 2, max: 3 },
    tables: { min: 1, max: 1 },
    references: { min: 20, max: 30 },
    statements: [],
    repro: ['脚本'],
  },
  D2: {
    pages: { min: 8, max: 10 },
    sections: { min: 6, requireRelatedWork: true, allowAppendix: false },
    experiments: { datasets: 2, baselines: 4, seeds: 1, ablation: true, significance: false, costAnalysis: false },
    figures: { min: 5, max: 8 },
    tables: { min: 3, max: 5 },
    references: { min: 40, max: 60 },
    statements: ['dataAvailability', 'codeAvailability', 'limitations'],
    repro: ['脚本', '种子', '环境'],
  },
  D3: {
    pages: { min: 12, max: 20 },
    sections: { min: 7, requireRelatedWork: true, allowAppendix: true },
    experiments: { datasets: 3, baselines: 6, seeds: 3, ablation: true, significance: true, costAnalysis: true },
    figures: { min: 8, max: 15 },
    tables: { min: 5, max: 10 },
    references: { min: 60, max: 120 },
    statements: ['dataAvailability', 'codeAvailability', 'limitations', 'conflictOfInterest', 'ethics', 'authorContributions'],
    repro: ['脚本', '种子', '环境', '容器/镜像', '硬件清单', '统计检验脚本'],
  },
}

/** 落点②：实验设计的最少检查项（M7 实验视图/spec 校验直接复用）。 */
export function experimentsChecklist(tier: DepthTier): readonly string[] {
  const profile = DEPTH_PROFILES[tier]
  const items = [
    `数据集 ≥ ${profile.experiments.datasets}`,
    `基线 ≥ ${profile.experiments.baselines}`,
    `随机种子 ≥ ${profile.experiments.seeds}`,
  ]
  if (profile.experiments.ablation) items.push('消融实验（去掉各核心构件）')
  if (profile.experiments.significance) items.push('显著性检验（配对 t 检验或 bootstrap）')
  if (profile.experiments.costAnalysis) items.push('训练/推理成本分析')
  return items
}
