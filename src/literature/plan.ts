/** 检索计划与重放（P0-5）：`<project>/literature/searches/<planId>.json`
 * 保存检索 DSL；`runs/<runId>/{plan.json,results.jsonl,summary.json}` 存运行
 * 快照。执行 = 三源并发（各源既有 RateGate）→ 归一化 → 以 identityKey 去重
 * （复用 identity 的合并守卫）→ 稳定排序（identityKey 升序）→ resultHash。
 * replay 只读本地 results.jsonl，不联网，离线可用。
 *
 * 设计口径（0203/01-查论文 §4.3）：
 * - plan.save 不触网；plan.run 才触网，离线抛 OFFLINE；
 * - 同一 plan 连续 live run 的 resultHash 必须一致（排序与身份规则确定性）；
 * - 在线 API 漂移只允许体现为 diff 的新增/消失，不允许同键漂移。
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { identityKey, mergeInto } from './identity.ts'
import type { LitCandidate, LitSource } from './types.ts'

export const PLAN_SCHEMA_VERSION = 1
export const MAX_PER_SOURCE_LIMIT = 50
export const MAX_SOURCES = 3
export const PLAN_SORTS = ['relevance', 'citations', 'year'] as const
export type PlanSort = (typeof PLAN_SORTS)[number]

export const PLAN_SOURCES: readonly LitSource[] = ['arxiv', 'openalex', 'crossref']

export interface PlanFilters {
  readonly yearFrom?: number
  readonly yearTo?: number
  readonly source?: readonly LitSource[]
}

export interface PlanQuery {
  readonly text: string
  readonly filters?: PlanFilters
}

export interface SearchPlan {
  readonly schemaVersion: typeof PLAN_SCHEMA_VERSION
  readonly planId: string
  readonly query: PlanQuery
  readonly sources: readonly LitSource[]
  readonly perSourceLimit: number
  readonly sort: PlanSort
  readonly createdAt: string
}

export interface PlanRunCounts {
  readonly bySource: Readonly<Record<string, number>>
  readonly identified: number
  readonly deduped: number
}

export interface PlanRunError {
  readonly source: string
  readonly code: string
  readonly message: string
}

export interface PlanRunSummary {
  readonly runId: string
  readonly planId: string
  readonly counts: PlanRunCounts
  readonly resultHash: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly errors: readonly PlanRunError[]
}

export interface PlanRunResult extends PlanRunSummary {
  readonly runDir: string
  readonly plan: SearchPlan
  readonly resultKeys: readonly string[]
}

export interface ReplayDiff {
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

export interface ReplayResult {
  readonly planId: string
  readonly runId: string
  readonly previousRunId?: string
  readonly resultHash: string
  readonly recomputedHash: string
  readonly consistent: boolean
  readonly diff: ReplayDiff
  readonly integrity: {
    readonly added: readonly string[]
    readonly removed: readonly string[]
  }
  readonly keyCount: number
  readonly keys: readonly string[]
}

/** 计划执行依赖：search 由 LiteratureService 注入（测试可给纯函数）。 */
export interface PlanDeps {
  readonly fs: SrwFsLike | undefined
  readonly rootDir: string
  readonly offline: () => boolean
  readonly search: (source: LitSource, query: string, limit: number) => Promise<readonly LitCandidate[]>
  readonly now?: () => Date
  readonly newRunId?: () => string
}

export interface SavePlanInput {
  readonly text?: unknown
  readonly query?: unknown
  readonly sources?: unknown
  readonly perSourceLimit?: unknown
  readonly limit?: unknown
  readonly sort?: unknown
  readonly filters?: unknown
  readonly planId?: unknown
}

function assertProject(project: string): string {
  if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', `项目 slug 非法：${JSON.stringify(project)}`)
  return project
}

function assertPlanId(planId: string): string {
  if (!/^sp-[a-z0-9][a-z0-9-]{2,63}$/.test(planId)) {
    throw new ServiceError('INVALID', `planId 非法：${JSON.stringify(planId)}`)
  }
  return planId
}

function assertRunId(runId: string): string {
  if (!/^run-[a-z0-9][a-z0-9-]{2,95}$/.test(runId)) {
    throw new ServiceError('INVALID', `runId 非法：${JSON.stringify(runId)}`)
  }
  return runId
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ServiceError('INVALID', `${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseSourceList(value: unknown): LitSource[] {
  if (value === undefined) return [...PLAN_SOURCES]
  if (!Array.isArray(value)) throw new ServiceError('INVALID', 'sources 必须是数组')
  const sources: LitSource[] = []
  for (const raw of value) {
    const source = PLAN_SOURCES.find(item => item === raw)
    if (source === undefined) {
      throw new ServiceError('INVALID', `source 必须是 ${PLAN_SOURCES.join('|')}，收到 ${JSON.stringify(raw)}`)
    }
    if (!sources.includes(source)) sources.push(source)
  }
  if (sources.length === 0) throw new ServiceError('INVALID', 'sources 不能为空')
  if (sources.length > MAX_SOURCES) throw new ServiceError('INVALID', `sources 最多 ${MAX_SOURCES} 个`)
  return sources
}

function parseYear(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 3000) {
    throw new ServiceError('INVALID', `${label} 必须是 0..3000 的整数`)
  }
  return value
}

function parseFilters(value: unknown): PlanFilters | undefined {
  if (value === undefined) return undefined
  const raw = record(value, 'filters')
  const yearFrom = parseYear(raw['yearFrom'], 'filters.yearFrom')
  const yearTo = parseYear(raw['yearTo'], 'filters.yearTo')
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) {
    throw new ServiceError('INVALID', 'filters.yearFrom 不能大于 filters.yearTo')
  }
  const source = raw['source'] === undefined ? undefined : parseSourceList(raw['source'])
  const filters: PlanFilters = {
    ...(yearFrom === undefined ? {} : { yearFrom }),
    ...(yearTo === undefined ? {} : { yearTo }),
    ...(source === undefined ? {} : { source }),
  }
  return Object.keys(filters).length === 0 ? undefined : filters
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 20
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ServiceError('INVALID', 'perSourceLimit 必须是数字')
  }
  return Math.min(MAX_PER_SOURCE_LIMIT, Math.max(1, Math.floor(value)))
}

function parseSort(value: unknown): PlanSort {
  if (value === undefined) return 'relevance'
  const sort = PLAN_SORTS.find(item => item === value)
  if (sort === undefined) throw new ServiceError('INVALID', `sort 必须是 ${PLAN_SORTS.join('|')}`)
  return sort
}

function canonicalPlanPayload(input: {
  text: string
  filters?: PlanFilters
  sources: readonly LitSource[]
  perSourceLimit: number
  sort: PlanSort
}): string {
  return JSON.stringify({
    text: input.text,
    filters: input.filters ?? null,
    sources: input.sources,
    perSourceLimit: input.perSourceLimit,
    sort: input.sort,
  })
}

function searchesDir(rootDir: string, project: string): string {
  return join(rootDir, project, 'literature', 'searches')
}

function runsDir(rootDir: string, project: string): string {
  return join(rootDir, project, 'literature', 'runs')
}

function planPath(rootDir: string, project: string, planId: string): string {
  return join(searchesDir(rootDir, project), `${planId}.json`)
}

async function guard(deps: PlanDeps, path: string): Promise<void> {
  await assertInsideRoot(deps.fs, deps.rootDir, path)
}

async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  } catch (error: unknown) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

function summarizeCounts(plan: SearchPlan, bySource: Record<string, number>, identified: number, deduped: number): PlanRunCounts {
  const ordered: Record<string, number> = {}
  for (const source of plan.sources) ordered[source] = bySource[source] ?? 0
  return { bySource: ordered, identified, deduped }
}

/** 保存计划（不触网）：planId 由内容指纹确定性生成；同内容重复保存保留
 * 原 createdAt，不产生新文件。 */
export async function savePlan(deps: PlanDeps, project: string, input: SavePlanInput): Promise<SearchPlan> {
  assertProject(project)
  const recordInput = record(input, 'plan')
  const queryRaw = recordInput['query']
  const queryObject = typeof queryRaw === 'object' && queryRaw !== null && !Array.isArray(queryRaw)
    ? queryRaw as Record<string, unknown>
    : undefined
  const text = asString(recordInput['text']) ?? (typeof queryRaw === 'string' ? queryRaw : asString(queryObject?.['text']))
  if (text === undefined || text.trim() === '') throw new ServiceError('INVALID', 'plan.query.text 必填')
  const filters = parseFilters(recordInput['filters'] ?? queryObject?.['filters'])
  const sources = parseSourceList(recordInput['sources'] ?? filters?.source)
  const perSourceLimit = parseLimit(recordInput['perSourceLimit'] ?? recordInput['limit'])
  const sort = parseSort(recordInput['sort'])
  const canonical = canonicalPlanPayload({ text: text.trim(), ...(filters === undefined ? {} : { filters }), sources, perSourceLimit, sort })
  const explicitId = asString(recordInput['planId'])
  const planId = explicitId === undefined
    ? `sp-${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`
    : assertPlanId(explicitId)

  const path = planPath(deps.rootDir, project, planId)
  await guard(deps, path)
  const now = deps.now ?? (() => new Date())
  let createdAt: string | undefined
  try {
    const existing = JSON.parse(await readFile(path, 'utf8')) as Partial<SearchPlan>
    if (typeof existing.createdAt === 'string') createdAt = existing.createdAt
  } catch { /* 新计划/坏文件：以 now 覆盖 */ }
  const plan: SearchPlan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    planId,
    query: { text: text.trim(), ...(filters === undefined ? {} : { filters }) },
    sources,
    perSourceLimit,
    sort,
    createdAt: createdAt ?? now().toISOString(),
  }
  await writeTextAtomic(path, JSON.stringify(plan, null, 2) + '\n')
  return plan
}

/** 读计划；缺失 → NOT_FOUND，形状坏 → INVALID。 */
export async function loadPlan(deps: PlanDeps, project: string, planId: string): Promise<SearchPlan> {
  assertProject(project)
  const id = assertPlanId(planId)
  const path = planPath(deps.rootDir, project, id)
  await guard(deps, path)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') throw new ServiceError('NOT_FOUND', `检索计划不存在：${id}`)
    throw new ServiceError('INVALID', `检索计划不是合法 JSON：${path}`)
  }
  const raw = record(parsed, 'plan')
  if (raw['schemaVersion'] !== PLAN_SCHEMA_VERSION || raw['planId'] !== id) {
    throw new ServiceError('INVALID', `检索计划版本/planId 不匹配：${id}`)
  }
  const queryRaw = record(raw['query'], 'plan.query')
  const text = asString(queryRaw['text'])
  if (text === undefined || text === '') throw new ServiceError('INVALID', '检索计划缺 query.text')
  const filters = parseFilters(queryRaw['filters'])
  const sources = parseSourceList(raw['sources'])
  const perSourceLimit = parseLimit(raw['perSourceLimit'])
  const sort = parseSort(raw['sort'])
  const createdAt = asString(raw['createdAt'])
  if (createdAt === undefined) throw new ServiceError('INVALID', '检索计划缺 createdAt')
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    planId: id,
    query: { text, ...(filters === undefined ? {} : { filters }) },
    sources,
    perSourceLimit,
    sort,
    createdAt,
  }
}

/** 列计划（createdAt 倒序；坏文件跳过，不让一个坏计划毁掉列表）。 */
export async function listPlans(deps: PlanDeps, project: string): Promise<readonly SearchPlan[]> {
  assertProject(project)
  const dir = searchesDir(deps.rootDir, project)
  await guard(deps, dir)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return []
    throw error
  }
  const plans: SearchPlan[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const planId = name.slice(0, -'.json'.length)
    try {
      plans.push(await loadPlan(deps, project, planId))
    } catch { /* 坏文件跳过 */ }
  }
  return plans.sort((a, b) => {
    const byTime = b.createdAt.localeCompare(a.createdAt)
    return byTime !== 0 ? byTime : a.planId.localeCompare(b.planId)
  })
}

/** resultHash = sha256(JSON.stringify(sortedIdentityKeys))（hex）。 */
export function resultHashOf(keys: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(keys)).digest('hex')
}

function yearAllowed(candidate: LitCandidate, filters: PlanFilters | undefined): boolean {
  if (filters === undefined) return true
  const year = candidate.identity.year
  if (year <= 0) return true // 年份未知：不因过滤丢条目（可解释性优先）
  if (filters.yearFrom !== undefined && year < filters.yearFrom) return false
  if (filters.yearTo !== undefined && year > filters.yearTo) return false
  return true
}

function resultLine(item: LitCandidate & { readonly key: string; readonly seenIn: readonly string[] }): Record<string, unknown> {
  return {
    source: item.source,
    identity: item.identity,
    identityKey: identityKey(item.identity),
    key: item.key,
    authors: item.authors,
    venue: item.venue,
    abstract: item.abstract,
    ...(item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt }),
    ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
    ...(item.pdfUrl === undefined ? {} : { pdfUrl: item.pdfUrl }),
    ...(item.oaUrl === undefined ? {} : { oaUrl: item.oaUrl }),
    ...(item.citedByCount === undefined ? {} : { citedByCount: item.citedByCount }),
    ...(item.openalexId === undefined ? {} : { openalexId: item.openalexId }),
    ...(item.retracted === undefined ? {} : { retracted: item.retracted }),
  }
}

function errorOf(source: string, error: unknown): PlanRunError {
  const code = (error as { code?: unknown }).code
  return {
    source,
    code: typeof code === 'string' ? code : 'UPSTREAM',
    message: error instanceof Error ? error.message : String(error),
  }
}

/** 执行计划：三源并发（各源自带 RateGate）→ 过滤 → 去重 → 稳定排序 → 快照。 */
export async function runPlan(deps: PlanDeps, project: string, planId: string): Promise<PlanRunResult> {
  assertProject(project)
  if (deps.offline()) throw new ServiceError('OFFLINE', '离线模式开启：检索计划执行需要联网（plan.replay/list 仍可用）')
  const plan = await loadPlan(deps, project, planId)
  const now = deps.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const settled = await Promise.allSettled(plan.sources.map(async source =>
    await deps.search(source, plan.query.text, plan.perSourceLimit)))
  const errors: PlanRunError[] = []
  const bySource: Record<string, number> = {}
  const all: LitCandidate[] = []
  for (let index = 0; index < plan.sources.length; index += 1) {
    const source = plan.sources[index]!
    const result = settled[index]
    bySource[source] = 0
    if (result === undefined) continue
    if (result.status === 'rejected') {
      errors.push(errorOf(source, result.reason))
      continue
    }
    const filtered = result.value
      .filter(candidate => yearAllowed(candidate, plan.query.filters))
      .slice(0, plan.perSourceLimit)
    bySource[source] = filtered.length
    all.push(...filtered)
  }
  const identified = all.length
  const merged = mergeInto(all, [])
  const sorted = [...merged.fresh].sort((a, b) => {
    const keyA = identityKey(a.identity)
    const keyB = identityKey(b.identity)
    if (keyA !== keyB) return keyA < keyB ? -1 : 1
    return a.key.localeCompare(b.key)
  })
  const resultKeys = [...new Set(sorted.map(item => identityKey(item.identity)))].sort()
  const resultHash = resultHashOf(resultKeys)
  const finishedAt = now().toISOString()
  const runId = deps.newRunId?.() ?? `run-${finishedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`
  assertRunId(runId)
  const runDir = join(runsDir(deps.rootDir, project), runId)
  await guard(deps, runDir)
  const summary: PlanRunSummary = {
    runId,
    planId: plan.planId,
    counts: summarizeCounts(plan, bySource, identified, sorted.length),
    resultHash,
    startedAt,
    finishedAt,
    errors,
  }
  const planCopyPath = join(runDir, 'plan.json')
  const resultsPath = join(runDir, 'results.jsonl')
  const summaryPath = join(runDir, 'summary.json')
  await guard(deps, planCopyPath)
  await guard(deps, resultsPath)
  await guard(deps, summaryPath)
  await writeTextAtomic(planCopyPath, JSON.stringify(plan, null, 2) + '\n')
  await writeTextAtomic(resultsPath, sorted.map(item => JSON.stringify(resultLine(item))).join('\n') + (sorted.length > 0 ? '\n' : ''))
  await writeTextAtomic(summaryPath, JSON.stringify(summary, null, 2) + '\n')
  return { ...summary, runDir, plan, resultKeys }
}

interface RunSnapshot {
  readonly runId: string
  readonly dir: string
  readonly summary: PlanRunSummary
}

async function readSummary(deps: PlanDeps, dir: string): Promise<PlanRunSummary | undefined> {
  const path = join(dir, 'summary.json')
  await guard(deps, path)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const raw = parsed as Record<string, unknown>
  if (typeof raw['runId'] !== 'string' || typeof raw['planId'] !== 'string'
    || typeof raw['resultHash'] !== 'string' || typeof raw['startedAt'] !== 'string'
    || typeof raw['finishedAt'] !== 'string' || typeof raw['counts'] !== 'object' || raw['counts'] === null) {
    return undefined
  }
  return raw as unknown as PlanRunSummary
}

async function listRunSnapshots(deps: PlanDeps, project: string, planId: string): Promise<RunSnapshot[]> {
  const dir = runsDir(deps.rootDir, project)
  await guard(deps, dir)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return []
    throw error
  }
  const snapshots: RunSnapshot[] = []
  for (const name of names) {
    if (!/^run-[a-z0-9][a-z0-9-]{2,95}$/.test(name)) continue
    const runDir = join(dir, name)
    const summary = await readSummary(deps, runDir)
    if (summary === undefined || summary.planId !== planId) continue
    snapshots.push({ runId: summary.runId, dir: runDir, summary })
  }
  return snapshots.sort((a, b) => {
    const byFinished = a.summary.finishedAt.localeCompare(b.summary.finishedAt)
    return byFinished !== 0 ? byFinished : a.runId.localeCompare(b.runId)
  })
}

/** 读取一个 run 的 results.jsonl → identityKey 集合（去重 + 排序）。 */
async function keysFromResults(deps: PlanDeps, runDir: string): Promise<{ keys: string[]; recorded: string[] }> {
  const path = join(runDir, 'results.jsonl')
  await guard(deps, path)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') throw new ServiceError('NOT_FOUND', `run 缺 results.jsonl：${runDir}`)
    throw error
  }
  const candidates: LitCandidate[] = []
  const recorded: string[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new ServiceError('INVALID', 'results.jsonl 含非法 JSON 行')
    }
    const row = record(parsed, 'results 行')
    const identityRaw = record(row['identity'], 'results.identity')
    const title = asString(identityRaw['title'])
    const year = typeof identityRaw['year'] === 'number' ? identityRaw['year'] : 0
    if (title === undefined) throw new ServiceError('INVALID', 'results.identity.title 缺失')
    const source = asString(row['source'])
    const candidate: LitCandidate = {
      source: PLAN_SOURCES.find(item => item === source) ?? 'arxiv',
      identity: {
        title,
        year,
        ...(asString(identityRaw['doi']) === undefined ? {} : { doi: asString(identityRaw['doi'])! }),
        ...(asString(identityRaw['arxivId']) === undefined ? {} : { arxivId: asString(identityRaw['arxivId'])! }),
        ...(asString(identityRaw['canonicalDoi']) === undefined ? {} : { canonicalDoi: asString(identityRaw['canonicalDoi'])! }),
      },
      authors: Array.isArray(row['authors']) ? row['authors'].filter((item): item is string => typeof item === 'string') : [],
      venue: asString(row['venue']) ?? '',
      abstract: asString(row['abstract']) ?? '',
    }
    candidates.push(candidate)
    recorded.push(asString(row['identityKey']) ?? identityKey(candidate.identity))
  }
  const keys = [...new Set(mergeInto(candidates, []).fresh.map(item => identityKey(item.identity)))].sort()
  return { keys, recorded: [...new Set(recorded)].sort() }
}

function diffOf(current: readonly string[], baseline: readonly string[]): ReplayDiff {
  const currentSet = new Set(current)
  const baselineSet = new Set(baseline)
  return {
    added: current.filter(key => !baselineSet.has(key)),
    removed: baseline.filter(key => !currentSet.has(key)),
  }
}

/** 离线重放：只读本地 results.jsonl 重算 resultHash，并给出 diff。
 * 有上一 run 时 diff 是「本次相对上次」的新增/消失；否则 diff 是
 * 「重算相对文件记录」的一致性差异（正常为空）。 */
export async function replayPlan(
  deps: PlanDeps,
  project: string,
  planId: string,
  runId?: string,
): Promise<ReplayResult> {
  assertProject(project)
  const id = assertPlanId(planId)
  // 计划存在性校验（不触网）；坏计划直接报错
  await loadPlan(deps, project, id)
  const snapshots = await listRunSnapshots(deps, project, id)
  if (snapshots.length === 0) throw new ServiceError('NOT_FOUND', `计划还没有运行记录：${id}`)
  let index = snapshots.length - 1
  if (runId !== undefined) {
    const target = assertRunId(runId)
    const found = snapshots.findIndex(snapshot => snapshot.runId === target)
    if (found < 0) throw new ServiceError('NOT_FOUND', `run 不存在：${target}`)
    index = found
  }
  const snapshot = snapshots[index]!
  const previous = index > 0 ? snapshots[index - 1] : undefined
  const current = await keysFromResults(deps, snapshot.dir)
  const recomputedHash = resultHashOf(current.keys)
  const integrity = diffOf(current.keys, current.recorded)
  let diff = integrity
  let previousRunId: string | undefined
  if (previous !== undefined) {
    const baseline = await keysFromResults(deps, previous.dir)
    diff = diffOf(current.keys, baseline.keys)
    previousRunId = previous.runId
  }
  return {
    planId: id,
    runId: snapshot.runId,
    ...(previousRunId === undefined ? {} : { previousRunId }),
    resultHash: snapshot.summary.resultHash,
    recomputedHash,
    consistent: recomputedHash === snapshot.summary.resultHash,
    diff,
    integrity,
    keyCount: current.keys.length,
    keys: current.keys,
  }
}
