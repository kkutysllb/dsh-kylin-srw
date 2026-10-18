/** 实验作业规格（§5/§3 子能力 5/6）：schema + 校验 + D 档设计门
 * （复用 venue/depth.ts 的 DEPTH_PROFILES 阈值——第三落点，改动要回写表）。 */

import { SLUG_RE } from '../core/schema.ts'
import { ServiceError } from '../service.ts'
import { DEPTH_PROFILES } from '../venue/depth.ts'

export type DepthTierName = 'D1' | 'D2' | 'D3'

export const RUN_ID_RE = /^r-[a-z0-9][a-z0-9-]{0,31}$/
export const EXP_ID_RE = SLUG_RE

export interface ExperimentSpec {
  readonly schemaVersion: 1
  readonly expId: string
  readonly title?: string
  readonly tier?: DepthTierName
  /** 远端入口 argv（如 ['bash','job.sh']）——逐参数引用，绝不字符串插值。 */
  readonly entry: readonly string[]
  readonly gpus: number
  readonly seeds: readonly number[]
  readonly datasets: readonly string[]
  readonly baselines: readonly string[]
  readonly metrics: readonly string[]
  readonly outputs: { readonly metrics: string; readonly artifacts?: readonly string[] }
  readonly env?: Readonly<Record<string, string>>
  readonly maxHours: number
  readonly maxLogBytes: number
  /** D2/D3 档位声明（gate 消费；缺省 false）。 */
  readonly ablation?: boolean
  readonly significance?: boolean
  readonly costAnalysis?: boolean
  confirmed?: boolean
  confirmedAt?: string | null
}

function isTier(value: unknown): value is DepthTierName {
  return value === 'D1' || value === 'D2' || value === 'D3'
}

function parseSeed(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^-?\d{1,9}$/.test(value)) return Number.parseInt(value, 10)
  return null
}

function stringArray(value: unknown, cap: number, maxLen: number): string[] | null {
  if (!Array.isArray(value) || value.length > cap) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item === '' || item.length > maxLen) return null
    out.push(item)
  }
  return out
}

/** 校验（返回中文错误清单；空数组 = 合法）。字段面收窄：未知键直接丢弃
 * （normalize 时），防止脏数据进 run 溯源链。 */
export function validateExperimentSpec(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['spec 必须是对象']
  const s = value as Record<string, unknown>
  const errors: string[] = []
  if (s['schemaVersion'] !== undefined && s['schemaVersion'] !== 1) errors.push('schemaVersion 必须为 1')
  if (typeof s['expId'] !== 'string' || !SLUG_RE.test(s['expId'])) errors.push('expId 必须匹配 ^[a-z0-9][a-z0-9-]{0,63}$')
  if (stringArray(s['entry'] ?? [], 40, 200) === null || (s['entry'] as unknown[] | undefined)?.length === 0) {
    errors.push('entry 必须是非空 argv 数组（如 ["bash","job.sh"]）')
  }
  if (s['gpus'] !== undefined && (typeof s['gpus'] !== 'number' || !Number.isSafeInteger(s['gpus']) || s['gpus'] < 1 || s['gpus'] > 8)) {
    errors.push('gpus 必须是 1..8 整数')
  }
  // seeds 兼容数字与数字字符串（工具入参两种形态都合法）
  const seedList = Array.isArray(s['seeds']) ? (s['seeds'] as unknown[]).map(parseSeed) : []
  if (seedList.length === 0 || seedList.length > 64 || seedList.some(seed => seed === null)) {
    errors.push('seeds 必须是非空整数数组（≤64 个）')
  }
  if (stringArray(s['datasets'] ?? [], 32, 64) === null) errors.push('datasets 必须是字符串数组（≤32）')
  if (stringArray(s['baselines'] ?? [], 32, 64) === null) errors.push('baselines 必须是字符串数组（≤32）')
  if (stringArray(s['metrics'] ?? [], 32, 64) === null || (s['metrics'] as unknown[] | undefined)?.length === 0) {
    errors.push('metrics 必须是非空指标名数组')
  }
  const outputs = s['outputs']
  if (outputs !== undefined) {
    if (typeof outputs !== 'object' || outputs === null) errors.push('outputs 必须是对象')
    else {
      const o = outputs as Record<string, unknown>
      if (o['metrics'] !== undefined && (typeof o['metrics'] !== 'string' || o['metrics'].length > 200 || o['metrics'].includes('..'))) {
        errors.push('outputs.metrics 必须是 ≤200 字符的远端相对路径（无 ..）')
      }
      if (o['artifacts'] !== undefined && stringArray(o['artifacts'] ?? [], 20, 200) === null) {
        errors.push('outputs.artifacts 必须是字符串数组（≤20）')
      }
    }
  }
  if (s['env'] !== undefined) {
    if (typeof s['env'] !== 'object' || s['env'] === null) errors.push('env 必须是字符串键值对象')
    else {
      const rows = Object.entries(s['env'] as Record<string, unknown>)
      if (rows.length > 16) errors.push('env 至多 16 项')
      for (const [key, value] of rows) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) errors.push('env 键必须是合法 shell 变量名：' + key)
        if (typeof value !== 'string' || value.length > 500) errors.push('env 值必须是非空字符串（≤500）：' + key)
      }
    }
  }
  if (s['maxHours'] !== undefined && (typeof s['maxHours'] !== 'number' || !(s['maxHours'] > 0) || s['maxHours'] > 72)) {
    errors.push('maxHours 必须是 (0,72] 的数字')
  }
  if (s['maxLogBytes'] !== undefined && (typeof s['maxLogBytes'] !== 'number' || !Number.isSafeInteger(s['maxLogBytes']) || s['maxLogBytes'] < 1024 || s['maxLogBytes'] > 2 * 1024 * 1024 * 1024)) {
    errors.push('maxLogBytes 必须是 1KiB..2GiB 的整数')
  }
  if (s['tier'] !== undefined && !isTier(s['tier'])) errors.push('tier 必须是 D1|D2|D3')
  if (s['title'] !== undefined && (typeof s['title'] !== 'string' || s['title'].length > 200)) errors.push('title ≤200 字')
  for (const key of ['ablation', 'significance', 'costAnalysis'] as const) {
    if (s[key] !== undefined && typeof s[key] !== 'boolean') errors.push(key + ' 必须是布尔')
  }
  return errors
}

const DEFAULT_MAX_HOURS = 8
const DEFAULT_MAX_LOG_BYTES = 256 * 1024 * 1024

/** 归一化（填默认值、丢未知键）；spec 已合法时使用。 */
export function normalizeSpec(value: unknown, expId: string): ExperimentSpec {
  const s = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const outputs = (typeof s['outputs'] === 'object' && s['outputs'] !== null ? s['outputs'] : {}) as Record<string, unknown>
  const env: Record<string, string> = {}
  if (typeof s['env'] === 'object' && s['env'] !== null) {
    for (const [key, value] of Object.entries(s['env'] as Record<string, unknown>)) {
      if (typeof value === 'string') env[key] = value
    }
  }
  const spec: ExperimentSpec = {
    schemaVersion: 1,
    expId: typeof s['expId'] === 'string' && SLUG_RE.test(s['expId']) ? s['expId'] : expId,
    entry: stringArray(s['entry'] ?? [], 40, 200) ?? [],
    gpus: typeof s['gpus'] === 'number' && Number.isSafeInteger(s['gpus']) ? s['gpus'] : 1,
    seeds: (Array.isArray(s['seeds']) ? (s['seeds'] as unknown[]).map(parseSeed) : []).filter((seed): seed is number => seed !== null),
    datasets: stringArray(s['datasets'] ?? [], 32, 64) ?? [],
    baselines: stringArray(s['baselines'] ?? [], 32, 64) ?? [],
    metrics: stringArray(s['metrics'] ?? [], 32, 64) ?? [],
    outputs: {
      metrics: typeof outputs['metrics'] === 'string' && outputs['metrics'] !== '' ? outputs['metrics'] : 'metrics.json',
      ...(Array.isArray(outputs['artifacts']) ? { artifacts: stringArray(outputs['artifacts'], 20, 200) ?? [] } : {}),
    },
    ...(Object.keys(env).length > 0 ? { env } : {}),
    maxHours: typeof s['maxHours'] === 'number' && s['maxHours'] > 0 ? s['maxHours'] : DEFAULT_MAX_HOURS,
    maxLogBytes: typeof s['maxLogBytes'] === 'number' && Number.isSafeInteger(s['maxLogBytes']) ? s['maxLogBytes'] : DEFAULT_MAX_LOG_BYTES,
    ...(typeof s['title'] === 'string' && s['title'] !== '' ? { title: s['title'] } : {}),
    ...(isTier(s['tier']) ? { tier: s['tier'] } : {}),
    ...(s['ablation'] === true ? { ablation: true } : {}),
    ...(s['significance'] === true ? { significance: true } : {}),
    ...(s['costAnalysis'] === true ? { costAnalysis: true } : {}),
    confirmed: s['confirmed'] === true,
    confirmedAt: typeof s['confirmedAt'] === 'string' ? s['confirmedAt'] : null,
  }
  return spec
}

export interface SpecGate {
  readonly ok: boolean
  readonly blockers: readonly string[]
  readonly warnings: readonly string[]
}

/** D 档设计门（落点③）：阻断 = 数据集/种子低于档位、D3 缺显著性声明；
 * 警告 = 基线/消融/成本低于档位。全部 D_TIER_GAP 前缀，ack 可越过
 * （§7.2 A2：需显式 ack，spec.revisions 留痕）。 */
export function gateSpec(spec: ExperimentSpec): SpecGate {
  const tier: DepthTierName = spec.tier ?? 'D1'
  const profile = DEPTH_PROFILES[tier]
  const blockers: string[] = []
  const warnings: string[] = []
  if (spec.datasets.length < profile.experiments.datasets) {
    blockers.push('数据集 ' + spec.datasets.length + ' < 档位 ' + tier + ' 要求 ' + profile.experiments.datasets)
  }
  if (spec.seeds.length < profile.experiments.seeds) {
    blockers.push('随机种子 ' + spec.seeds.length + ' < 档位 ' + tier + ' 要求 ' + profile.experiments.seeds)
  }
  if (spec.baselines.length < profile.experiments.baselines) {
    warnings.push('基线 ' + spec.baselines.length + ' < 档位 ' + tier + ' 建议 ' + profile.experiments.baselines)
  }
  if (profile.experiments.ablation && spec.ablation !== true) {
    warnings.push('档位 ' + tier + ' 建议消融实验（spec.ablation 未声明）')
  }
  if (profile.experiments.significance && spec.significance !== true) {
    blockers.push('档位 D3 要求显著性检验（spec.significance 未声明；补检验或显式 ack）')
  }
  if (profile.experiments.costAnalysis && spec.costAnalysis !== true) {
    warnings.push('档位 D3 建议训练/推理成本分析（spec.costAnalysis 未声明）')
  }
  return { ok: blockers.length === 0, blockers, warnings }
}

/** spec 相对路径白名单（上传文件用）：无 ..、无绝对路径、无反斜杠。 */
export function isSafeRemoteRelPath(path: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(path) && !path.includes('..') && !path.includes('\\')
}

export function assertSpecOrThrow(spec: ExperimentSpec): void {
  const errors = validateExperimentSpec(spec)
  if (errors.length > 0) throw new ServiceError('INVALID', '实验 spec 校验失败：' + errors.join('；'))
}
