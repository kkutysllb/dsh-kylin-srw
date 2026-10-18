/** 论文数字逐点对账（§5.6）：claims.json 是「正文每个数字必须指回真实
 * metrics.json 条目」红线唯一的机器可校验落点。check 为纯函数：
 * verified（重算一致）/ mismatch（不一致，阻断插入）/ unverifiable
 * （证据缺——缺 metrics/指标/成功 run；hashPolicy:none 也在 gaps 侧标
 * unverifiable，不假 verified）。 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'

export interface MetricsFile {
  readonly schemaVersion: number
  readonly runId: string
  readonly expId?: string
  readonly status?: 'complete' | 'partial' | 'failed'
  readonly metrics: ReadonlyArray<{ readonly name: string; readonly split?: string; readonly value: number }>
}

/** metrics.json 最小 schema（§5.4 收窄面）：metrics[].name+value 必须在。 */
export function validateMetricsFile(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['metrics.json 必须是对象']
  const m = value as Record<string, unknown>
  const errors: string[] = []
  if (typeof m['runId'] !== 'string' || m['runId'] === '') errors.push('runId 必填')
  const metrics = m['metrics']
  if (!Array.isArray(metrics) || metrics.length === 0) {
    errors.push('metrics 必须是非空数组')
    return errors
  }
  for (const item of metrics) {
    if (typeof item !== 'object' || item === null) {
      errors.push('metrics 元素必须是对象')
      continue
    }
    const row = item as Record<string, unknown>
    if (typeof row['name'] !== 'string' || row['name'] === '') errors.push('metrics[].name 必填')
    if (typeof row['value'] !== 'number' || !Number.isFinite(row['value'])) errors.push('metrics[].value 必须是有限数字')
  }
  return errors
}

export interface ClaimSource {
  readonly expId: string
  readonly runIds: readonly string[]
  readonly metric: string
  readonly split?: string
  readonly reducer: 'mean' | 'median' | 'last'
}

export interface ClaimVerification {
  readonly status: 'verified' | 'mismatch' | 'unverifiable'
  readonly computed: number | null
  readonly reason: string | null
  readonly checkedAt: string
  readonly metricsSha256: readonly string[]
}

export interface ClaimRecord {
  readonly id: string
  readonly kind: 'number' | 'table-cell'
  readonly paper?: { readonly file?: string; readonly line?: number; readonly label?: string; readonly cell?: string }
  readonly source: ClaimSource
  readonly value: number
  readonly digits: number
  readonly tolerance?: number
  verification?: ClaimVerification | null
}

export const CLAIM_ID_RE = /^clm-[a-z0-9][a-z0-9-]{0,40}$/

export function validateClaimRecord(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['claim 必须是对象']
  const c = value as Record<string, unknown>
  const errors: string[] = []
  if (typeof c['id'] !== 'string' || !CLAIM_ID_RE.test(c['id'])) errors.push('id 必须匹配 clm-* slug')
  if (c['kind'] !== 'number' && c['kind'] !== 'table-cell') errors.push('kind 必须是 number|table-cell')
  const source = c['source']
  if (typeof source !== 'object' || source === null) {
    errors.push('source 必填（expId/runIds/metric/reducer）')
  } else {
    const s = source as Record<string, unknown>
    if (typeof s['expId'] !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(s['expId'])) errors.push('source.expId 必须是实验 slug')
    if (!Array.isArray(s['runIds']) || s['runIds'].length === 0 || !s['runIds'].every((id: unknown) => typeof id === 'string' && /^r-[a-z0-9][a-z0-9-]{0,31}$/.test(id))) {
      errors.push('source.runIds 必须是非空 r-* runId 数组')
    }
    if (typeof s['metric'] !== 'string' || s['metric'] === '') errors.push('source.metric 必填')
    if (s['reducer'] !== 'mean' && s['reducer'] !== 'median' && s['reducer'] !== 'last') errors.push('source.reducer 必须是 mean|median|last')
  }
  if (typeof c['value'] !== 'number' || !Number.isFinite(c['value'])) errors.push('value 必须是有限数字（论文声称值）')
  if (typeof c['digits'] !== 'number' || !Number.isSafeInteger(c['digits']) || c['digits'] < 0 || c['digits'] > 10) errors.push('digits 必须是 0..10 整数')
  if (c['tolerance'] !== undefined && (typeof c['tolerance'] !== 'number' || !(c['tolerance'] >= 0))) errors.push('tolerance 必须是非负数字')
  return errors
}

export function reduceValues(values: readonly number[], reducer: 'mean' | 'median' | 'last'): number {
  if (values.length === 0) return Number.NaN
  if (reducer === 'last') return values[values.length - 1] as number
  if (reducer === 'mean') return values.reduce((sum, v) => sum + v, 0) / values.length
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] as number : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/** 每个 runId → { sha256, file }：file=null = 缺失/损坏/失败 run（→ unverifiable）。 */
export type MetricsByRun = ReadonlyMap<string, { readonly sha256: string; readonly file: MetricsFile | null }>

/** 对账纯函数（测试面）：verified 当 |声称值-重算值| ≤ 容差（缺省 0.5*10^-digits）。 */
export function checkClaim(claim: ClaimRecord, metricsByRun: MetricsByRun, checkedAt: string): ClaimVerification {
  const shas: string[] = []
  const values: number[] = []
  for (const runId of claim.source.runIds) {
    const entry = metricsByRun.get(runId)
    if (entry === undefined || entry.file === null) {
      return { status: 'unverifiable', computed: null, reason: 'run ' + runId + ' 的 metrics.json 缺失/损坏/非成功态', checkedAt, metricsSha256: [] }
    }
    shas.push(entry.sha256)
    if (entry.file.status === 'failed') {
      return { status: 'unverifiable', computed: null, reason: 'run ' + runId + ' 状态 failed（不假 verified）', checkedAt, metricsSha256: shas }
    }
    const matched = entry.file.metrics.filter(row => row.name === claim.source.metric && (claim.source.split === undefined || row.split === claim.source.split))
    if (matched.length === 0) {
      return { status: 'unverifiable', computed: null, reason: 'run ' + runId + ' 缺指标 ' + claim.source.metric + (claim.source.split !== undefined ? '@' + claim.source.split : ''), checkedAt, metricsSha256: shas }
    }
    values.push(...matched.map(row => row.value))
  }
  const computed = reduceValues(values, claim.source.reducer)
  const tolerance = claim.tolerance ?? 0.5 * Math.pow(10, -claim.digits)
  const ok = Math.abs(claim.value - computed) <= tolerance + 1e-12
  return { status: ok ? 'verified' : 'mismatch', computed, reason: ok ? null : '重算 ' + String(computed) + ' ≠ 论文 ' + String(claim.value) + '（容差 ' + String(tolerance) + '）', checkedAt, metricsSha256: shas }
}

export interface ClaimsDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: () => string | undefined
}

export class ClaimsStore {
  constructor(private readonly deps: ClaimsDeps) {}

  private requireRoot(): string {
    const root = this.deps.rootDir()
    if (root === undefined || root === '') throw new ServiceError('NO_PROVIDER', '科研总根未设置（先在面板选择）')
    return root
  }

  private filePath(project: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(project)) throw new ServiceError('INVALID', '项目 slug 非法：' + JSON.stringify(project))
    return join(this.requireRoot(), project, 'paper', 'claims.json')
  }

  private async guard(absPath: string): Promise<void> {
    await assertInsideRoot(this.deps.fs, this.requireRoot(), absPath)
  }

  async load(project: string): Promise<ClaimRecord[]> {
    const abs = this.filePath(project)
    await this.guard(abs)
    let text: string
    try {
      text = await readFile(abs, 'utf8')
    } catch {
      return []
    }
    let raw: unknown
    try {
      raw = JSON.parse(text) as unknown
    } catch {
      throw new ServiceError('INVALID', 'paper/claims.json 损坏（非法 JSON）——请手工修复后再操作')
    }
    const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    if (!Array.isArray(row['claims'])) return []
    return (row['claims'] as unknown[]).filter(item => validateClaimRecord(item).length === 0) as ClaimRecord[]
  }

  async save(project: string, claims: readonly ClaimRecord[]): Promise<void> {
    const abs = this.filePath(project)
    await this.guard(abs)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, JSON.stringify({ schemaVersion: 1, claims }, null, 2) + '\n', 'utf8')
  }

  /** upsert：同 id 替换（verification 一并替换），其余保留。 */
  async upsert(project: string, claim: ClaimRecord): Promise<void> {
    const all = await this.load(project)
    const rest = all.filter(row => row.id !== claim.id)
    await this.save(project, [...rest, claim])
  }
}
