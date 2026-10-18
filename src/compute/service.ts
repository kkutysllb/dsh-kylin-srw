/** ComputeService（M7 实验与算力 MVP，analysis/goals/04 §4–§8）：唯一编排入口。
 * 单主机、无 UI、无多机调度；三级链实现 ① ControlMaster 复用与 ③ 直连
 * （② tool 通道留接口注释不实现）。provider 可注入（测试全用 fake，绝不真连）。
 *
 * 纪律落地：hosts.json 只读；地址/用户名/端口绝不落盘（run.json 只存
 * hostRef+label，remote.runDir 是波浪号形式，展开用的 $HOME 只在内存）；
 * 每个输出面过 redactJson；7 态生命周期 unknown 绝不假成功；日志偏移续读 +
 * 上限显式失败；取消 kill -TERM -<pid> → 宽限 → -KILL，不可达 → interrupted；
 * spec 门复用 venue/depth D 档；错误码 INVALID/NOT_FOUND/NO_PROVIDER/GATE。
 * 永不读取宿主凭据（本目录 0 命中，tests 断言）。 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SLUG_RE } from '../core/schema.ts'
import { assertInsideRoot, type SrwFsLike } from '../host.ts'
import { ServiceError } from '../service.ts'
import { inventoryEnv, pickGpu, probeHost } from './env.ts'
import { sortGapQueue, generateGaps, type GapItem } from './gaps.ts'
import { checkClaim, ClaimsStore, validateClaimRecord, validateMetricsFile, type ClaimRecord, type ClaimVerification, type MetricsByRun, type MetricsFile } from './claims.ts'
import { cancelRemote, classifyRun, probeRun } from './lifecycle.ts'
import { parseOffsetFile, pullRunLog, type LogOffsetFile } from './logs.ts'
import { collectRun } from './collect.ts'
import { pickTransport, discoverHosts, resolveHostRef, type ResolvedHost } from './hosts.ts'
import type { ComputeProvider, HostTarget } from './provider.ts'
import { SshProvider } from './provider.ts'
import { RegistryStore } from './registry.ts'
import { assertSpecOrThrow, EXP_ID_RE, gateSpec, isSafeRemoteRelPath, normalizeSpec, RUN_ID_RE, type ExperimentSpec } from './spec.ts'
import { buildJobScript, buildLaunchScript, expandTilde, LAUNCH_OK_SENTINEL, remoteRunDirTilde } from './submit.ts'
import { hostRefOf, projectRefOf, redactJson, remotePathsFor, TERMINAL_STATUSES, validateRunRecord, type EnvSnapshot, type RunRecord, type RunStatus } from './types.ts'

export interface ComputeDeps {
  /** 宿主 fs（路径护栏；缺席 fail-closed，照 patent/materials 模式）。 */
  readonly fs: SrwFsLike | undefined
  readonly rootDir: () => string | undefined
  /** provider 注入点：缺省真实 SshProvider（①cm/③direct）；测试注入 fake。 */
  readonly provider?: ComputeProvider
  /** home 候选 env（缺省 process.env；测试注入隔离）。 */
  readonly env?: Record<string, string | undefined>
  readonly offline?: () => boolean
  readonly now?: () => string
  readonly staleThreshold?: number
  readonly killGraceMs?: number
  readonly cancelStepMs?: number
  /** probe 超时（默认 15s）。 */
  readonly probeTimeoutMs?: number
}

export interface SubmitInput {
  readonly expId: string
  readonly spec?: unknown
  readonly files?: readonly unknown[]
  readonly hostRef?: string
  readonly seed?: number
  readonly confirm?: boolean
  /** 显式接受 D 档缺口（D_TIER_GAP ack；spec.revisions 留痕）。 */
  readonly ack?: boolean
  readonly runId?: string
}

export interface HostRowView {
  readonly ref: string
  readonly label: string
  readonly auth: 'key' | 'password'
  readonly transport: 'cm' | 'direct' | null
  readonly usable: boolean
  readonly reachable: boolean
  readonly latencyMs: number | null
  readonly detail: string
  readonly env?: {
    readonly os: string
    readonly kernel: string
    readonly arch: string
    readonly cpuCount: number | null
    readonly memTotalMiB: number | null
    readonly gpuCount: number
    readonly gpus: readonly EnvSnapshot['gpus'][number][]
    readonly nvcc: EnvSnapshot['nvcc']
    readonly python3: EnvSnapshot['python3']
    readonly node: string | null
    readonly tools: Readonly<Record<string, boolean>>
    readonly disk: EnvSnapshot['disk']
  }
}

const MAX_FILES = 20
const MAX_FILE_CHARS = 512 * 1024

export class ComputeService {
  private readonly provider: ComputeProvider
  private readonly registry: RegistryStore
  private readonly claims: ClaimsStore
  /** ref → HostTarget（含地址/私钥路径；内存 only，绝不落盘）。 */
  private readonly book = new Map<string, HostTarget>()
  /** ref → 远端 $HOME（内存 only；run.json 只存波浪号路径）。 */
  private readonly homes = new Map<string, string>()

  constructor(private readonly deps: ComputeDeps) {
    this.provider = deps.provider ?? new SshProvider()
    this.registry = new RegistryStore({ fs: deps.fs, rootDir: deps.rootDir })
    this.claims = new ClaimsStore({ fs: deps.fs, rootDir: deps.rootDir })
  }

  private nowIso(): string {
    return this.deps.now !== undefined ? this.deps.now() : new Date().toISOString()
  }

  private requireRoot(): string {
    const root = this.deps.rootDir()
    if (root === undefined || root === '') throw new ServiceError('NO_PROVIDER', '科研总根未设置（先在面板选择）')
    return root
  }

  private projectDir(project: string): string {
    if (!SLUG_RE.test(project)) throw new ServiceError('INVALID', '项目 slug 非法：' + JSON.stringify(project))
    return join(this.requireRoot(), project)
  }

  private expDir(project: string, expId: string): string {
    if (!EXP_ID_RE.test(expId)) throw new ServiceError('INVALID', 'expId 必须匹配 ^[a-z0-9][a-z0-9-]{0,63}$：' + JSON.stringify(expId))
    return join(this.projectDir(project), 'experiments', expId)
  }

  private runDir(project: string, expId: string, runId: string): string {
    if (!RUN_ID_RE.test(runId)) throw new ServiceError('INVALID', 'runId 必须匹配 ^r-[a-z0-9][a-z0-9-]{0,31}$：' + JSON.stringify(runId))
    return join(this.expDir(project, expId), 'runs', runId)
  }

  private async guard(absPath: string): Promise<void> {
    await assertInsideRoot(this.deps.fs, this.requireRoot(), absPath)
  }

  private async assertProjectExists(project: string): Promise<void> {
    const dir = this.projectDir(project)
    await this.guard(dir)
    try {
      await stat(dir)
    } catch {
      throw new ServiceError('NOT_FOUND', '项目不存在：' + project + '（先 srw_project create/open）')
    }
  }

  private async readJsonAt(abs: string): Promise<unknown> {
    await this.guard(abs)
    try {
      return JSON.parse(await readFile(abs, 'utf8')) as unknown
    } catch {
      return undefined
    }
  }

  /** 落盘统一走 redactJson（防脏数据进盘——纪律兜底）。 */
  private async writeJsonAt(abs: string, value: unknown): Promise<void> {
    await this.guard(abs)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, JSON.stringify(redactJson(value), null, 2) + '\n', 'utf8')
  }

  /* ── spec ── */

  private specPath(project: string, expId: string): string {
    return join(this.expDir(project, expId), 'spec.json')
  }

  async loadSpec(project: string, expId: string): Promise<ExperimentSpec> {
    const raw = await this.readJsonAt(this.specPath(project, expId))
    if (raw === undefined) throw new ServiceError('NOT_FOUND', '实验 spec 不存在：experiments/' + expId + '/spec.json（submit 时随参数提供 spec）')
    const spec = normalizeSpec(raw, expId)
    assertSpecOrThrow(spec)
    return spec
  }

  private async saveSpec(project: string, expId: string, spec: ExperimentSpec): Promise<void> {
    await this.writeJsonAt(this.specPath(project, expId), spec)
    if (spec.confirmed === true && spec.confirmedAt !== null && spec.confirmedAt !== undefined) {
      // 确认即留痕：spec.revisions/<ts>.json（只增不改）
      const ts = spec.confirmedAt.replace(/[-:]/g, '').replace(/\..*$/, '')
      await this.writeJsonAt(join(this.expDir(project, expId), 'spec.revisions', ts + '.json'), spec)
    }
  }

  /* ── run.json ── */

  private runJsonPath(project: string, expId: string, runId: string): string {
    return join(this.runDir(project, expId, runId), 'run.json')
  }

  private async loadRun(project: string, expId: string, runId: string): Promise<RunRecord> {
    const raw = await this.readJsonAt(this.runJsonPath(project, expId, runId))
    if (raw === undefined) throw new ServiceError('NOT_FOUND', 'run 不存在：experiments/' + expId + '/runs/' + runId + '/run.json')
    const errors = validateRunRecord(raw)
    if (errors.length > 0) throw new ServiceError('INVALID', 'run.json 损坏：' + errors.join('；'))
    return raw as RunRecord
  }

  private async saveRun(project: string, expId: string, run: RunRecord): Promise<void> {
    await this.writeJsonAt(this.runJsonPath(project, expId, run.runId), run)
  }

  private async listRunIds(project: string, expId: string): Promise<string[]> {
    const dir = join(this.expDir(project, expId), 'runs')
    await this.guard(dir)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return []
    }
    return entries.filter(entry => RUN_ID_RE.test(entry))
  }

  /* ── 主机与通道 ── */

  private async targetFor(resolved: ResolvedHost): Promise<HostTarget> {
    const { transport, cmSock } = pickTransport(resolved)
    const target: HostTarget = {
      ref: resolved.ref,
      transport,
      address: { host: resolved.entry.host, user: resolved.entry.user, ...(resolved.entry.port !== undefined ? { port: resolved.entry.port } : {}) },
      ...(cmSock !== undefined ? { cmSock } : {}),
      ...(resolved.entry.identityFile !== undefined ? { identityFile: resolved.entry.identityFile } : {}),
    }
    this.book.set(resolved.ref, target)
    return target
  }

  private async discoverResolved(): Promise<Array<{ resolved: ResolvedHost; target: HostTarget | null; detail: string }>> {
    const rows: Array<{ resolved: ResolvedHost; target: HostTarget | null; detail: string }> = []
    try {
      for (const { home, entries } of await discoverHosts(this.deps.env ?? process.env)) {
        for (const entry of entries) {
          const resolved: ResolvedHost = {
            entry,
            home,
            ref: hostRefOf(entry.id),
            label: entry.label ?? 'host-' + hostRefOf(entry.id).slice(2, 8),
          }
          try {
            rows.push({ resolved, target: await this.targetFor(resolved), detail: 'ok' })
          } catch (error) {
            rows.push({ resolved, target: null, detail: error instanceof Error ? error.message : String(error) })
          }
        }
      }
    } catch { /* 无任何 home 候选可读 → 空表 */ }
    return rows
  }

  /** ① 复用/③ 直连的远端 $HOME（内存 only；波浪号展开用）。 */
  private async remoteHome(target: HostTarget): Promise<string> {
    const cached = this.homes.get(target.ref)
    if (cached !== undefined) return cached
    // 传输层（provider.remoteLine）已对 argv 逐元素做 POSIX 引号包裹，
    // sh -c 的脚本引号不再被远端登录 shell 吃掉（真机踩中后已修）。
    const res = await this.provider.exec(target, ['sh', '-c', 'printf %s "$HOME"'], { maxBytes: 1024, timeoutMs: this.deps.probeTimeoutMs ?? 15_000 })
    const home = new TextDecoder().decode(res.stdout).trim()
    if (res.code !== 0 || home === '' || !home.startsWith('/')) {
      throw new ServiceError('NO_PROVIDER', '远端 $HOME 探测失败（' + target.ref + '）：' + res.stderr.slice(0, 120))
    }
    this.homes.set(target.ref, home)
    return home
  }

  private async expandRunDirAbs(target: HostTarget, tildeRunDir: string): Promise<string> {
    return expandTilde(tildeRunDir, await this.remoteHome(target))
  }

  /* ══ 10 个对外动作 ══ */

  /** hosts：盘点主机（probe + 可选 env 盘点）。输出已脱敏（无 IP/user@/port）。 */
  async hosts(project: string, options?: { env?: boolean }): Promise<{ homes: number; count: number; hosts: HostRowView[] }> {
    await this.assertProjectExists(project)
    const rows = await this.discoverResolved()
    const views: HostRowView[] = []
    for (const row of rows) {
      let reachable = false
      let latencyMs: number | null = null
      let detail = row.detail
      let envView: HostRowView['env'] | undefined
      if (row.target !== null) {
        const probe = await probeHost(this.provider, row.target, this.deps.probeTimeoutMs ?? 15_000)
        reachable = probe.reachable
        latencyMs = probe.latencyMs
        detail = probe.detail
        if (reachable && options?.env !== false) {
          try {
            const snapshot = await inventoryEnv(this.provider, row.target, this.nowIso())
            envView = {
              os: snapshot.os,
              kernel: snapshot.kernel,
              arch: snapshot.arch,
              cpuCount: snapshot.cpuCount,
              memTotalMiB: snapshot.memTotalMiB,
              gpuCount: snapshot.gpus.length,
              gpus: [...snapshot.gpus],
              nvcc: snapshot.nvcc,
              python3: snapshot.python3,
              node: snapshot.node,
              tools: snapshot.tools,
              disk: snapshot.disk,
            }
          } catch (error) {
            detail = 'env 盘点失败：' + (error instanceof Error ? error.message : String(error))
          }
        }
      }
      views.push({
        ref: row.resolved.ref,
        label: row.resolved.label,
        auth: row.resolved.entry.auth,
        transport: row.target?.transport ?? null,
        usable: row.target !== null,
        reachable,
        latencyMs,
        detail,
        ...(envView !== undefined ? { env: redactJson(envView) } : {}),
      })
    }
    const homes = new Set(rows.map(row => row.resolved.home)).size
    return redactJson({ homes, count: views.length, hosts: views })
  }

  /** submit：spec 门（confirm/ack）→ 主机/环境 → GPU 选卡 → 上传脚本 →
   * setsid 派发 → run.json（数据只增不删）。 */
  async submit(project: string, input: SubmitInput): Promise<Record<string, unknown>> {
    await this.assertProjectExists(project)
    if (this.deps.offline?.() === true) throw new ServiceError('GATE', 'OFFLINE：离线模式不派发远端作业（先在面板关闭离线模式）')
    if (typeof input.expId !== 'string' || !EXP_ID_RE.test(input.expId)) throw new ServiceError('INVALID', 'expId 必须匹配 ^[a-z0-9][a-z0-9-]{0,63}$')
    // ① spec：入参优先，回落已存 spec
    let rawSpec = input.spec
    if (rawSpec === undefined) {
      rawSpec = await this.readJsonAt(this.specPath(project, input.expId))
      if (rawSpec === undefined) throw new ServiceError('INVALID', 'submit 需要 spec（或先保存过 experiments/' + input.expId + '/spec.json）')
    }
    const spec = normalizeSpec(rawSpec, input.expId)
    assertSpecOrThrow(spec)
    // ② D 档设计门 + 确认状态机（A2：未确认 → SPEC_NOT_CONFIRMED；缺口 → 显式 ack）
    const gate = gateSpec(spec)
    if (input.confirm !== true) {
      throw new ServiceError('GATE', 'SPEC_NOT_CONFIRMED：spec 未确认，不会派发远端作业（confirm=true 确认）'
        + (gate.blockers.length > 0 ? '；blockers：' + gate.blockers.join('；') : '')
        + (gate.warnings.length > 0 ? '；warnings：' + gate.warnings.join('；') : ''))
    }
    if (!gate.ok && input.ack !== true) {
      throw new ServiceError('GATE', 'D_TIER_GAP：' + gate.blockers.join('；') + '——补齐或 ack=true 显式接受')
    }
    if (gate.ok && gate.warnings.length > 0 && input.ack !== true) {
      throw new ServiceError('GATE', 'D_TIER_WARN：' + gate.warnings.join('；') + '——接受请 ack=true')
    }
    const confirmed: ExperimentSpec = { ...spec, confirmed: true, confirmedAt: this.nowIso() }
    await this.saveSpec(project, input.expId, confirmed)
    // ③ 主机选择 + 可达性（不可达绝不假跑）
    const resolvedRows = await this.discoverResolved()
    let chosen: ResolvedHost | undefined
    let target: HostTarget | undefined
    if (typeof input.hostRef === 'string' && input.hostRef !== '') {
      const found = resolvedRows.find(row => row.resolved.ref === input.hostRef)
      if (found === undefined) throw new ServiceError('NOT_FOUND', 'hostRef 未知（先 action=hosts 盘点）：' + input.hostRef)
      chosen = found.resolved
      target = found.target ?? undefined
      if (target === undefined) throw new ServiceError('NO_PROVIDER', '主机 ' + chosen.label + ' 无可用通道：' + found.detail)
    } else {
      const found = resolvedRows.find(row => row.target !== null)
      if (found === undefined || found.target === null) {
        throw new ServiceError('NO_PROVIDER', 'hosts.json 未发现可用主机（password 认证需宿主 ① 级 ControlMaster socket；key 认证需 identityFile）——先跑 action=hosts')
      }
      chosen = found.resolved
      target = found.target
    }
    const probe = await probeHost(this.provider, target, this.deps.probeTimeoutMs ?? 15_000)
    if (!probe.reachable) throw new ServiceError('NO_PROVIDER', '主机 ' + chosen.label + ' 不可达（' + probe.detail + '）——作业未提交，不假跑')
    // ④ 环境盘点 + GPU 选卡（全忙 → NO_FREE_GPU，排队不在 MVP）
    const snapshot = await inventoryEnv(this.provider, target, this.nowIso())
    const gpuIndices = pickGpu(snapshot.gpus, { want: spec.gpus })
    const cudaVisibleDevices = gpuIndices.join(',')
    const gpuSnapshots = snapshot.gpus.filter(gpu => gpuIndices.includes(gpu.index)).map(gpu => ({ index: gpu.index, name: gpu.name, memoryUsedMiB: gpu.memoryUsedMiB, memoryTotalMiB: gpu.memoryTotalMiB }))
    // ⑤ runId / 数据集注册表核对
    const runId = typeof input.runId === 'string' && input.runId !== '' ? input.runId : 'r-' + Date.now().toString(36)
    if (!RUN_ID_RE.test(runId)) throw new ServiceError('INVALID', 'runId 必须匹配 ^r-[a-z0-9][a-z0-9-]{0,31}$')
    const localRunDir = this.runDir(project, input.expId, runId)
    await this.guard(localRunDir)
    try {
      await stat(localRunDir)
      throw new ServiceError('CONFLICT', 'run 已存在：' + runId + '（重跑请用新 runId，数据只增不删）')
    } catch (error) {
      if (error instanceof ServiceError) throw error
    }
    const inputs: Array<RunRecord['inputs'][number]> = []
    for (const datasetId of spec.datasets) {
      const record = await this.registry.get(project, datasetId)
      if (record === undefined) throw new ServiceError('NOT_FOUND', '数据集未注册：' + datasetId + '（先 action=dataset.register）')
      inputs.push({ datasetId: record.id, version: record.version, sha256: null, locator: 'remote:' + (record.locator?.path ?? '') })
    }
    // ⑥ 远端目录 + 文件上传（先落盘再执行；用户值只进文件字节）
    const projectRef = projectRefOf(this.projectDir(project))
    const tildeRunDir = remoteRunDirTilde(projectRef, runId)
    const runDirAbs = await this.expandRunDirAbs(target, tildeRunDir)
    try {
      await this.provider.exec(target, ['mkdir', '-p', runDirAbs + '/artifacts'], { maxBytes: 4096, timeoutMs: 30_000 })
      const seed = typeof input.seed === 'number' && Number.isSafeInteger(input.seed) ? input.seed : spec.seeds[0] ?? 0
      const files = Array.isArray(input.files) ? input.files : []
      if (files.length > MAX_FILES) throw new ServiceError('INVALID', 'files 至多 ' + String(MAX_FILES) + ' 个')
      for (const item of files) {
        if (typeof item !== 'object' || item === null) throw new ServiceError('INVALID', 'files 元素必须是 { path, content }')
        const row = item as Record<string, unknown>
        if (typeof row['path'] !== 'string' || !isSafeRemoteRelPath(row['path'])) throw new ServiceError('INVALID', 'files[].path 必须是安全相对路径（无 ..）：' + JSON.stringify(row['path']))
        if (typeof row['content'] !== 'string' || row['content'].length > MAX_FILE_CHARS) throw new ServiceError('INVALID', 'files[].content 必须是 ≤512KiB 的文本：' + String(row['path']))
        await this.provider.putBytes(target, runDirAbs + '/' + row['path'], new TextEncoder().encode(row['content']))
      }
      // 生成的包装器命名为 srw-wrapper.sh：与用户上传的 entry 脚本（常见名
      // job.sh）永不同名——真机踩中同名自递归（SHLVL 爆表 → exit 254）。
      await this.provider.putBytes(target, runDirAbs + '/srw-wrapper.sh', new TextEncoder().encode(buildJobScript({ runDirAbs, entry: spec.entry, seed, cudaVisibleDevices, ...(spec.env !== undefined ? { env: spec.env } : {}) })))
      await this.provider.putBytes(target, runDirAbs + '/launch.sh', new TextEncoder().encode(buildLaunchScript(runDirAbs)))
      // ⑦ 派发（bash 绝对路径；哨兵校验——F1 教训）
      const launch = await this.provider.exec(target, ['bash', runDirAbs + '/launch.sh'], { maxBytes: 4096, timeoutMs: 30_000 })
      const launchOut = new TextDecoder().decode(launch.stdout)
      if (launch.code !== 0 || !launchOut.includes(LAUNCH_OK_SENTINEL)) {
        throw new ServiceError('GATE', '派发失败：launch 哨兵未返回（exit ' + String(launch.code) + '）' + (launch.stderr !== '' ? '：' + launch.stderr.slice(0, 200) : ''))
      }
      const pidRes = await this.provider.exec(target, ['cat', runDirAbs + '/run.pid'], { maxBytes: 1024, timeoutMs: 15_000 })
      const pid = pidRes.code === 0 ? Number.parseInt(new TextDecoder().decode(pidRes.stdout).trim(), 10) : null
      // ⑧ run.json（本地真相源；host 只有 ref+label，remote 只有波浪号路径）
      const now = this.nowIso()
      const run: RunRecord = {
        schemaVersion: 1,
        runId,
        expId: input.expId,
        attempt: 1,
        parentRunId: null,
        status: 'running',
        host: { ref: target.ref, label: chosen.label, provider: target.transport },
        remote: remotePathsFor(tildeRunDir),
        pid: pid !== null && Number.isSafeInteger(pid) ? pid : null,
        env: { cudaVisibleDevices, gpus: gpuSnapshots },
        seed,
        inputs,
        outputs: { metrics: null, artifacts: [] },
        log: { stdoutBytes: 0, lastReadAt: null, staleCount: 0 },
        cancel: { requestedAt: null, reason: null },
        timestamps: { createdAt: now, submittedAt: now, endedAt: null, lastPolledAt: now },
        lastError: null,
      }
      await this.saveRun(project, input.expId, run)
      await this.writeJsonAt(join(localRunDir, 'logs', 'offset.json'), { stdoutBytes: 0, lastReadAt: null, mirrorSha256: null } satisfies LogOffsetFile)
      return redactJson({
        runId,
        expId: input.expId,
        status: run.status,
        host: run.host,
        pid: run.pid,
        seed,
        cudaVisibleDevices,
        remote: { runDir: tildeRunDir },
        spec: { tier: spec.tier ?? null, confirmedAt: confirmed.confirmedAt ?? null, ackUsed: input.ack === true },
        ...(gate.warnings.length > 0 ? { warnings: gate.warnings } : {}),
      })
    } catch (error) {
      if (error instanceof ServiceError) throw error
      throw new ServiceError('NO_PROVIDER', '派发中断（传输层）：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** status：轮询 + reconcile（7 态；unknown 绝不假成功）。 */
  async status(project: string, expId: string, runId?: string): Promise<Record<string, unknown>> {
    await this.assertProjectExists(project)
    const runIds = runId !== undefined && runId !== '' ? [runId] : await this.listRunIds(project, expId)
    if (runId !== undefined && runId !== '' && !(await this.listRunIds(project, expId)).includes(runId)) {
      throw new ServiceError('NOT_FOUND', 'run 不存在：' + runId)
    }
    const views: Record<string, unknown>[] = []
    for (const id of runIds) {
      let run = await this.loadRun(project, expId, id)
      if (!TERMINAL_STATUSES.has(run.status)) {
        run = await this.reconcileRun(project, expId, run)
      }
      views.push(redactJson(this.runView(run)))
    }
    return { expId, count: views.length, runs: views }
  }

  /** 单 run reconcile：探测 → 分类 → 写回（含 endedAt/lastError/staleCount）。 */
  private async reconcileRun(project: string, expId: string, run: RunRecord): Promise<RunRecord> {
    const target = this.book.get(run.host.ref) ?? (await this.rebuildTarget(run.host.ref))
    const now = this.nowIso()
    if (target === undefined) {
      // 主机移出 hosts.json：保持原状态（§8.1），提示人工确认，禁止 cancel 误判
      const next: RunRecord = { ...run, lastError: '主机已不在 hosts.json/通道不可用——保持 ' + run.status + '，需人工确认' }
      await this.saveRun(project, expId, next)
      return next
    }
    let probe
    try {
      const runDirAbs = await this.expandRunDirAbs(target, run.remote.runDir)
      probe = await probeRun(this.provider, target, runDirAbs)
    } catch (error) {
      probe = { probeOk: false, pid: null, pidAlive: false, exitCode: null, exitRead: false, doneExists: false, logSize: null, detail: error instanceof Error ? error.message : String(error) }
    }
    const verdict = classifyRun({
      prev: run.status,
      probe,
      prevLogSize: run.log.stdoutBytes,
      staleCount: run.log.staleCount,
      ...(this.deps.staleThreshold !== undefined ? { staleThreshold: this.deps.staleThreshold } : {}),
    })
    const ended = verdict.status === 'succeeded' || verdict.status === 'failed'
    const next: RunRecord = {
      ...run,
      status: verdict.status,
      pid: probe.probeOk ? probe.pid : run.pid,
      log: { ...run.log, stdoutBytes: probe.logSize ?? run.log.stdoutBytes, staleCount: verdict.staleCount },
      timestamps: { ...run.timestamps, lastPolledAt: now, ...(ended && run.timestamps.endedAt === null ? { endedAt: now } : {}) },
      lastError: verdict.reason,
    }
    await this.saveRun(project, expId, next)
    return next
  }

  /** 进程重启后 book 清空：从 hosts.json 重建通道（找不到 → undefined）。 */
  private async rebuildTarget(ref: string): Promise<HostTarget | undefined> {
    const rows = await this.discoverResolved()
    const found = rows.find(row => row.resolved.ref === ref)
    return found?.target ?? undefined
  }

  /** run 视图（模型/面板面向，有界脱敏）。 */
  private runView(run: RunRecord): Record<string, unknown> {
    return {
      runId: run.runId,
      expId: run.expId,
      status: run.status,
      host: run.host,
      pid: run.pid,
      seed: run.seed,
      cudaVisibleDevices: run.env.cudaVisibleDevices,
      remote: { runDir: run.remote.runDir },
      log: { stdoutBytes: run.log.stdoutBytes, staleCount: run.log.staleCount },
      cancel: { requestedAt: run.cancel.requestedAt, reason: run.cancel.reason },
      timestamps: {
        createdAt: run.timestamps.createdAt,
        submittedAt: run.timestamps.submittedAt,
        endedAt: run.timestamps.endedAt,
        lastPolledAt: run.timestamps.lastPolledAt,
      },
      outputs: {
        metrics: run.outputs.metrics === null ? null : { path: run.outputs.metrics.path, sha256: run.outputs.metrics.sha256, schemaOk: run.outputs.metrics.schemaOk },
        artifactsCount: run.outputs.artifacts.length,
      },
      ...(run.lastError !== null ? { lastError: run.lastError } : {}),
      ...(run.attempt !== 1 ? { attempt: run.attempt, parentRunId: run.parentRunId } : {}),
    }
  }

  /** logs：偏移续读 + 本地镜像 + 上限显式失败（LOG_CAP_EXCEEDED → run failed）。 */
  async logs(project: string, expId: string, runId: string): Promise<Record<string, unknown>> {
    await this.assertProjectExists(project)
    const run = await this.loadRun(project, expId, runId)
    if (TERMINAL_STATUSES.has(run.status) && run.status !== 'failed') {
      // 终态作业也允许回看日志（offset 之上没新字节就返回空 tail）
    }
    const target = this.book.get(run.host.ref) ?? (await this.rebuildTarget(run.host.ref))
    if (target === undefined) throw new ServiceError('NO_PROVIDER', '主机通道不可用（' + run.host.ref + '）——先 action=hosts')
    const localRunDir = this.runDir(project, expId, runId)
    const prev = parseOffsetFile(await this.readJsonAt(join(localRunDir, 'logs', 'offset.json')) ?? { stdoutBytes: run.log.stdoutBytes })
    try {
      const runDirAbs = await this.expandRunDirAbs(target, run.remote.runDir)
      const outcome = await pullRunLog({
        provider: this.provider,
        host: target,
        runDirAbs,
        localLogPath: join(localRunDir, 'logs', 'stdout.log'),
        localOffsetPath: join(localRunDir, 'logs', 'offset.json'),
        prev,
        maxLogBytes: (await this.loadSpec(project, expId)).maxLogBytes,
        now: this.nowIso(),
      })
      const next: RunRecord = { ...run, log: { ...run.log, stdoutBytes: outcome.offset.stdoutBytes, lastReadAt: outcome.offset.lastReadAt } }
      await this.saveRun(project, expId, next)
      return redactJson({
        runId,
        status: next.status,
        stdoutBytes: outcome.offset.stdoutBytes,
        appendedBytes: outcome.appendedBytes,
        totalRemoteBytes: outcome.totalRemoteBytes,
        reconciled: outcome.reconciled,
        tail: outcome.tailText,
      })
    } catch (error) {
      if (error instanceof ServiceError && error.message.includes('LOG_CAP_EXCEEDED')) {
        const now = this.nowIso()
        const failed: RunRecord = { ...run, status: 'failed', lastError: error.message, timestamps: { ...run.timestamps, endedAt: run.timestamps.endedAt ?? now } }
        await this.saveRun(project, expId, failed)
      }
      throw error
    }
  }

  /** collect：metrics/artifacts 回传 + sha256 对账，写 run.outputs。 */
  async collect(project: string, expId: string, runId: string): Promise<Record<string, unknown>> {
    await this.assertProjectExists(project)
    const run = await this.loadRun(project, expId, runId)
    const target = this.book.get(run.host.ref) ?? (await this.rebuildTarget(run.host.ref))
    if (target === undefined) throw new ServiceError('NO_PROVIDER', '主机通道不可用（' + run.host.ref + '）——先 action=hosts')
    const spec = await this.loadSpec(project, expId)
    const runDirAbs = await this.expandRunDirAbs(target, run.remote.runDir)
    const localRunDir = this.runDir(project, expId, runId)
    const outcome = await collectRun({ provider: this.provider, host: target, runDirAbs, metricsRel: spec.outputs.metrics, localRunDir })
    const now = this.nowIso()
    const next: RunRecord = {
      ...run,
      outputs: {
        metrics: outcome.metrics === null ? run.outputs.metrics : { path: outcome.metrics.path, sha256: outcome.metrics.sha256, schemaOk: outcome.metrics.schemaOk },
        artifacts: outcome.artifacts,
      },
      timestamps: { ...run.timestamps, lastPolledAt: now },
      ...(outcome.errors.length > 0 ? { lastError: outcome.errors[0] ?? null } : {}),
    }
    await this.saveRun(project, expId, next)
    await this.writeJsonAt(join(localRunDir, 'artifacts.json'), { schemaVersion: 1, runId, artifacts: outcome.artifacts, errors: outcome.errors })
    return redactJson({
      runId,
      metrics: outcome.metrics === null ? null : { path: outcome.metrics.path, sha256: outcome.metrics.sha256, schemaOk: outcome.metrics.schemaOk },
      artifacts: outcome.artifacts.map(artifact => ({ path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes })),
      errors: outcome.errors,
    })
  }

  /** cancel：kill -TERM -<pid> → 宽限 → -KILL；不可达 → interrupted（可重试）。 */
  async cancel(project: string, expId: string, runId: string, reason?: string): Promise<Record<string, unknown>> {
    await this.assertProjectExists(project)
    const run = await this.loadRun(project, expId, runId)
    if (run.status === 'cancelled') return redactJson(this.runView(run))
    if (TERMINAL_STATUSES.has(run.status)) throw new ServiceError('INVALID', 'run 已终态（' + run.status + '），无需取消')
    const target = this.book.get(run.host.ref) ?? (await this.rebuildTarget(run.host.ref))
    const now = this.nowIso()
    const withRequest: RunRecord = { ...run, cancel: { requestedAt: run.cancel.requestedAt ?? now, reason: reason ?? run.cancel.reason } }
    if (target === undefined) {
      // 主机不可见：标记 cancelRequested，下次 reconcile 重试（§8.1）
      const next: RunRecord = { ...withRequest, status: 'interrupted', lastError: '取消时主机通道不可用——远端可能仍在跑，恢复后 reconcile 重试' }
      await this.saveRun(project, expId, next)
      return redactJson(this.runView(next))
    }
    const runDirAbs = await this.expandRunDirAbs(target, run.remote.runDir)
    const outcome = await cancelRemote(this.provider, target, runDirAbs, run.pid, {
      ...(this.deps.killGraceMs !== undefined ? { killGraceMs: this.deps.killGraceMs } : {}),
      ...(this.deps.cancelStepMs !== undefined ? { stepMs: this.deps.cancelStepMs } : {}),
    })
    const next: RunRecord = outcome === 'killed'
      ? { ...withRequest, status: 'cancelled', timestamps: { ...withRequest.timestamps, endedAt: withRequest.timestamps.endedAt ?? this.nowIso() } }
      : { ...withRequest, status: 'interrupted', lastError: '取消时主机不可达——远端可能仍在跑，恢复后 reconcile 重试' }
    await this.saveRun(project, expId, next)
    return redactJson(this.runView(next))
  }

  /** env.setup：MVP 占位（显式 INVALID，绝不半吊子自动装环境）。 */
  async envSetup(): Promise<never> {
    throw new ServiceError('INVALID', 'env.setup 未实现（M7 MVP 占位）：自动创建 conda/torch 环境不在本期范围——请用 SSH 手动准备环境后再跑 action=hosts 看盘点')
  }

  /** claims.check：注册/更新 claim（可选）→ 从 metrics.json 重算 → 三态。 */
  async claimsCheck(project: string, input: { expId?: string; claim?: unknown; id?: string }): Promise<Record<string, unknown>> {
    await this.assertProjectExists(project)
    if (input.claim !== undefined) {
      const errors = validateClaimRecord(input.claim)
      if (errors.length > 0) throw new ServiceError('INVALID', 'claim 校验失败：' + errors.join('；'))
      const record = { ...(input.claim as Omit<ClaimRecord, 'verification'>), verification: null }
      await this.claims.upsert(project, record)
    }
    let all = await this.claims.load(project)
    if (typeof input.id === 'string' && input.id !== '') all = all.filter(claim => claim.id === input.id)
    if (typeof input.expId === 'string' && input.expId !== '') all = all.filter(claim => claim.source.expId === input.expId)
    const now = this.nowIso()
    const results: Record<string, unknown>[] = []
    for (const claim of all) {
      const metricsByRun: Map<string, { sha256: string; file: MetricsFile | null }> = new Map()
      for (const runId of claim.source.runIds) {
        metricsByRun.set(runId, await this.loadRunMetrics(project, claim.source.expId, runId))
      }
      const verification: ClaimVerification = checkClaim(claim, metricsByRun, now)
      const updated: ClaimRecord = { ...claim, verification }
      if (JSON.stringify(claim.verification) !== JSON.stringify(updated.verification)) {
        await this.claims.upsert(project, updated)
      }
      results.push({
        id: claim.id,
        kind: claim.kind,
        expId: claim.source.expId,
        metric: claim.source.metric,
        reducer: claim.source.reducer,
        value: claim.value,
        status: verification.status,
        computed: verification.computed,
        ...(verification.reason !== null ? { reason: verification.reason } : {}),
      })
    }
    return { count: results.length, claims: results }
  }

  /** 读某 run 的本地 metrics.json（含 run.json 记录的 sha256；缺/坏 → file:null）。 */
  private async loadRunMetrics(project: string, expId: string, runId: string): Promise<{ sha256: string; file: MetricsFile | null }> {
    const localRunDir = this.runDir(project, expId, runId)
    const metricsAbs = join(localRunDir, 'metrics.json')
    await this.guard(metricsAbs)
    let text: string
    try {
      text = await readFile(metricsAbs, 'utf8')
    } catch {
      return { sha256: '', file: null }
    }
    const bytes = new TextEncoder().encode(text)
    let sha = ''
    try {
      const rawRun = await this.readJsonAt(this.runJsonPath(project, expId, runId))
      const recorded = (rawRun as { outputs?: { metrics?: { sha256?: unknown } } } | undefined)?.outputs?.metrics?.sha256
      if (typeof recorded === 'string' && recorded.length === 64) sha = recorded
    } catch { /* 回落本地重算 */ }
    if (sha === '') {
      sha = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
    }
    try {
      const parsed = JSON.parse(text) as unknown
      if (validateMetricsFile(parsed).length > 0) return { sha256: sha, file: null }
      return { sha256: sha, file: parsed as MetricsFile }
    } catch {
      return { sha256: sha, file: null }
    }
  }

  /** gaps.list：缺口生成 + queue 排序（P0=阻断 claim > P1=D 档 > P2=成本/显著性）。 */
  async gapsList(project: string, expId: string): Promise<Record<string, unknown>> {
    await this.assertProjectExists(project)
    let spec: ExperimentSpec | null = null
    try {
      spec = await this.loadSpec(project, expId)
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== 'NOT_FOUND') throw error
    }
    const runIds = await this.listRunIds(project, expId)
    const runs = []
    for (const id of runIds) {
      try {
        const run = await this.loadRun(project, expId, id)
        const rawMetrics = await this.readJsonAt(join(this.runDir(project, expId, id), 'metrics.json'))
        const metricsNames = rawMetrics !== undefined && validateMetricsFile(rawMetrics).length === 0
          ? (rawMetrics as MetricsFile).metrics.map(row => row.name)
          : []
        runs.push({
          runId: run.runId,
          status: run.status,
          seed: run.seed,
          metricsNames,
          inputs: run.inputs.map(entry => ({ datasetId: entry.datasetId, version: entry.version })),
        })
      } catch { /* 坏 run.json 跳过（不影响其余缺口） */ }
    }
    const claims = (await this.claims.load(project)).filter(claim => claim.source.expId === expId)
    const registry = (await this.registry.list(project)).map(row => ({ id: row.id, version: row.version }))
    const items: GapItem[] = sortGapQueue(generateGaps({ spec, tier: spec?.tier ?? 'D1', runs, claims, registry }))
    const generatedAt = this.nowIso()
    await this.writeJsonAt(join(this.expDir(project, expId), 'gaps.json'), { schemaVersion: 1, expId, generatedAt, items })
    await this.writeJsonAt(join(this.expDir(project, expId), 'queue.json'), { schemaVersion: 1, expId, generatedAt, orderedIds: items.map(item => item.id) })
    const counts = {
      P0: items.filter(item => item.priority === 'P0').length,
      P1: items.filter(item => item.priority === 'P1').length,
      P2: items.filter(item => item.priority === 'P2').length,
    }
    return { expId, counts, items, queue: items.map(item => item.id) }
  }

  /** dataset.register：数据集注册（upsert 同 id+version）。 */
  async datasetRegister(project: string, dataset: unknown): Promise<Record<string, unknown>> {
    await this.assertProjectExists(project)
    const record = await this.registry.register(project, dataset, this.nowIso())
    return redactJson({ ...record })
  }
}
