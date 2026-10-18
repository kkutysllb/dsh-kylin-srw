/** 补数据缺口模型（§6.1/§6.4）：四路输入（spec+D 档阈值 / runs 完成度 /
 * metrics 缺失与失败 run / 未 verified 的 claim）→ P0/P1/P2 缺口 + queue
 * 排序（P0=阻断 claim > P1=D 档硬要求 > P2=成本/显著性；同级 estGpuHours
 * 升序填谷）。「补数据补完」= P0/P1 为空。 */

import type { ClaimRecord } from './claims.ts'
import type { ExperimentSpec } from './spec.ts'
import { DEPTH_PROFILES, type DepthProfile } from '../venue/depth.ts'
import type { RunStatus } from './types.ts'

export type GapKind =
  | 'missing-run' | 'missing-dataset' | 'missing-baseline' | 'missing-metric'
  | 'missing-stat' | 'failed-run' | 'stale-input' | 'unverifiable'

export interface GapItem {
  readonly id: string
  readonly kind: GapKind
  readonly detail: string
  readonly blockingClaims: readonly string[]
  readonly priority: 'P0' | 'P1' | 'P2'
  readonly estGpuHours?: number
  readonly suggestion: string
}

export interface GapRunSummary {
  readonly runId: string
  readonly status: RunStatus
  readonly seed: number
  readonly metricsNames: readonly string[]
  readonly inputs: ReadonlyArray<{ readonly datasetId: string; readonly version: string }>
}

export interface GapInput {
  readonly spec: ExperimentSpec | null
  readonly tier: 'D1' | 'D2' | 'D3'
  readonly runs: readonly GapRunSummary[]
  readonly claims: readonly ClaimRecord[]
  readonly registry: ReadonlyArray<{ readonly id: string; readonly version: string }>
}

const PRIORITY_ORDER: Readonly<Record<'P0' | 'P1' | 'P2', number>> = { P0: 0, P1: 1, P2: 2 }

/** 排序（纯函数）：P0 → P1 → P2；同级 estGpuHours 升序（缺省排最后）、再按 id 稳定。 */
export function sortGapQueue(items: readonly GapItem[]): GapItem[] {
  return [...items].sort((a, b) => {
    const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (byPriority !== 0) return byPriority
    const ah = a.estGpuHours ?? Number.POSITIVE_INFINITY
    const bh = b.estGpuHours ?? Number.POSITIVE_INFINITY
    if (ah !== bh) return ah - bh
    return a.id.localeCompare(b.id)
  })
}

/** 缺口生成（纯函数，测试面）。claim 引用按 expId+metric/runIds 匹配。 */
export function generateGaps(input: GapInput): GapItem[] {
  const items: GapItem[] = []
  const spec = input.spec
  const tier = spec?.tier ?? input.tier
  const profile: DepthProfile = DEPTH_PROFILES[tier]
  const succeeded = input.runs.filter(run => run.status === 'succeeded')
  const estHours = spec?.maxHours ?? 8
  const claimsOf = (predicate: (claim: ClaimRecord) => boolean): string[] =>
    input.claims.filter(predicate).map(claim => claim.id)

  // ① missing-run：spec 声明的 seed 没有任何 run（不管成败——只补没跑的）
  if (spec !== null) {
    for (const seed of spec.seeds) {
      const exists = input.runs.some(run => run.seed === seed)
      if (!exists) {
        const cited = claimsOf(claim => claim.source.expId === spec.expId)
        items.push({
          id: 'gap-missing-run-seed-' + String(seed).replace(/^-/, 'neg-'),
          kind: 'missing-run',
          detail: 'seed ' + String(seed) + ' 尚无任何 run',
          blockingClaims: cited,
          priority: cited.length > 0 ? 'P0' : 'P1',
          estGpuHours: estHours,
          suggestion: '按 spec 提交 seed=' + String(seed) + ' 的 run（新 runId，数据只增不删）',
        })
      }
    }
    // ② failed-run：failed/interrupted/unknown 的 run（被 claim 引用 → P0）
    for (const run of input.runs) {
      if (run.status !== 'failed' && run.status !== 'interrupted' && run.status !== 'unknown') continue
      const cited = claimsOf(claim => claim.source.runIds.includes(run.runId))
      items.push({
        id: 'gap-failed-run-' + run.runId,
        kind: 'failed-run',
        detail: 'run ' + run.runId + '（seed ' + String(run.seed) + '）终态 ' + run.status,
        blockingClaims: cited,
        priority: cited.length > 0 ? 'P0' : 'P1',
        estGpuHours: estHours,
        suggestion: '重跑：新 runId + attempt+1 + parentRunId 指向旧 run（旧 run 保留）',
      })
    }
    // ③ missing-metric：spec 声明的指标在 succeeded run 中缺失
    for (const metric of spec.metrics) {
      const missingRuns = succeeded.filter(run => !run.metricsNames.includes(metric))
      if (missingRuns.length === 0) continue
      const cited = claimsOf(claim => claim.source.metric === metric)
      items.push({
        id: 'gap-missing-metric-' + metric,
        kind: 'missing-metric',
        detail: '指标 ' + metric + ' 在 ' + String(missingRuns.length) + '/' + String(succeeded.length) + ' 个成功 run 缺失',
        blockingClaims: cited,
        priority: cited.length > 0 ? 'P0' : 'P1',
        estGpuHours: estHours,
        suggestion: '补跑或检查作业是否写了 ' + metric + '（metrics.json.status=partial 也要给 missing 理由）',
      })
    }
    // ④ stale-input：registry 版本 ≠ run inputs 版本
    for (const run of input.runs) {
      for (const used of run.inputs) {
        const current = input.registry.find(row => row.id === used.datasetId)
        if (current !== undefined && current.version !== used.version) {
          const cited = claimsOf(claim => claim.source.runIds.includes(run.runId))
          items.push({
            id: 'gap-stale-input-' + run.runId + '-' + used.datasetId,
            kind: 'stale-input',
            detail: 'run ' + run.runId + ' 用 ' + used.datasetId + '@' + used.version + '，registry 已是 ' + current.version,
            blockingClaims: cited,
            priority: cited.length > 0 ? 'P0' : 'P1',
            estGpuHours: estHours,
            suggestion: '数据集升版后重跑受影响 run（旧 run 与旧版本哈希一起保留）',
          })
        }
      }
    }
  }
  // ⑤ missing-dataset / missing-baseline / missing-stat：D 档硬要求
  const datasetCount = spec?.datasets.length ?? 0
  if (datasetCount < profile.experiments.datasets) {
    items.push({
      id: 'gap-missing-dataset',
      kind: 'missing-dataset',
      detail: '数据集 ' + String(datasetCount) + ' < 档位 ' + tier + ' 要求 ' + String(profile.experiments.datasets),
      blockingClaims: [],
      priority: 'P1',
      suggestion: '注册并跑足数据集（dataset.register 后按 spec 提交）',
    })
  }
  const baselineCount = spec?.baselines.length ?? 0
  if (baselineCount < profile.experiments.baselines) {
    items.push({
      id: 'gap-missing-baseline',
      kind: 'missing-baseline',
      detail: '基线 ' + String(baselineCount) + ' < 档位 ' + tier + ' 要求 ' + String(profile.experiments.baselines),
      blockingClaims: [],
      priority: 'P1',
      suggestion: '把对比方法补进 spec.baselines 并各跑一个 run',
    })
  }
  if ((spec?.tier ?? tier) === 'D3' && DEPTH_PROFILES.D3.experiments.significance && spec?.significance !== true) {
    items.push({
      id: 'gap-missing-stat',
      kind: 'missing-stat',
      detail: '档位 D3 要求显著性检验/成本分析，spec 未声明且无 stats 产物',
      blockingClaims: [],
      priority: 'P2',
      suggestion: '提交 analysis/stats.py（脚本 sha256 + 种子 + 输入 metrics 哈希进 stats.json）',
    })
  }
  // ⑥ unverifiable：verification 非 verified 的 claim（证据缺 → 阻断论文数字）
  for (const claim of input.claims) {
    const status = claim.verification?.status ?? 'unverified'
    if (status === 'verified') continue
    items.push({
      id: 'gap-unverifiable-' + claim.id,
      kind: 'unverifiable',
      detail: 'claim ' + claim.id + ' 状态 ' + status + (claim.verification?.reason !== undefined && claim.verification.reason !== null ? '：' + claim.verification.reason : ''),
      blockingClaims: [claim.id],
      priority: 'P0',
      suggestion: '补齐证据（collect 回传 metrics）后重跑 claims.check；改过数字要改论文',
    })
  }
  // id 去重（同 id 保留第一条）
  const seen = new Set<string>()
  return items.filter(item => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}
