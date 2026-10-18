/** M7 计算域共享类型与纯助手（analysis/goals/04 §4/§5）：7 态生命周期、
 * 脱敏（IPv4/IPv6/user@/:port//home|Users 全 redact）、hostRef=sha256(hostId)[:8]、
 * projectRef=sha256(项目绝对路径)[:12]、run.json 形状与校验。
 * 红线：本目录永不出现宿主凭据文件字样（tests 断言 0 命中）；地址/用户名/端口
 * 只存在于内存，不落工作区（落盘/输出前一律过 redact）。 */

import { createHash } from 'node:crypto'

/* ── 生命周期 7 态（§5.3）：pid/exit/done 全缺且日志无增长 → unknown，绝不假成功 ── */

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted', 'unknown'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** 终态（数据只增不删；interrupted/unknown 仍可 reconcile 恢复）。 */
export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['succeeded', 'failed', 'cancelled'])

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (RUN_STATUSES as readonly string[]).includes(value)
}

/* ── 哈希与引用 ── */

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** hostRef = 'h-' + sha256(hostId).slice(0,8)：唯一可落盘的主机标识
 * （真机 P1 实测 hostId 本身含 IP，绝不当 ref/label 用）。 */
export function hostRefOf(hostId: string): string {
  return 'h-' + sha256Hex(hostId).slice(0, 8)
}

/** projectRef = sha256(项目绝对路径)[:12]：远端目录不泄露本地路径（§5.2）。 */
export function projectRefOf(projectAbsPath: string): string {
  return sha256Hex(projectAbsPath).slice(0, 12)
}

/* ── 脱敏（§4.4）：落盘/日志/输出唯一允许的主机信息是 hostRef+label ── */

const IPV4_RE = /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g
/** 冒号十六进制 token（IPv6 与时间戳同形）；isIpv6Like 再筛，避免毁掉 hh:mm:ss。 */
const COLON_HEX_RE = /[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4})+/g
const USER_AT_RE = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g
const HOME_PATH_RE = /(?:\/home\/|\/Users\/|\/root\/)[A-Za-z0-9._-]+/g
/** host:port（4-5 位数字、前随主机名或已脱敏标记、后非小数）；hh:mm（2 位）不受影响。 */
const PORT_RE = /(?<=[A-Za-z0-9>]):\d{4,5}(?!\.\d)(?!\d)/g
/** 短端口（:22/:80）只紧跟 <ssh-target> 标记时脱敏——避免毁掉 hh:mm:ss。 */
const PORT_SHORT_RE = /<ssh-target>:(\d{2,5})(?!\.\d)(?!\d)/g

function isIpv6Like(token: string): boolean {
  if (token.includes('::')) return true
  const groups = token.split(':').filter(part => part !== '')
  return groups.length >= 4 && groups.every(part => /^[0-9A-Fa-f]{1,4}$/.test(part))
}

export const REDACT_IP = '<ip>'
export const REDACT_TARGET = '<ssh-target>'
export const REDACT_HOME = '<home>'
export const REDACT_PORT = ':<port>'

/** 单行脱敏（确定性纯函数，测试面）：IPv4/IPv6 → <ip>；user@host → <ssh-target>；
 * /home/<user> 等家目录 → <home>；host:port → :<port>。 */
export function redact(text: string): string {
  // 顺序即语义：先 user@host（吞掉其中的 IPv4/主机名），再裸 IP，再家目录，
  // 最后端口（前随字符可能是上一轮的脱敏标记 '>'，lookbehind 一并放行）。
  return text
    .replace(USER_AT_RE, REDACT_TARGET)
    .replace(IPV4_RE, REDACT_IP)
    .replace(COLON_HEX_RE, token => (isIpv6Like(token) ? REDACT_IP : token))
    .replace(HOME_PATH_RE, REDACT_HOME)
    .replace(PORT_RE, REDACT_PORT)
    .replace(PORT_SHORT_RE, '<ssh-target>:<port>')
}

/** 结构化脱敏：JSON 序列化 → redact → 反序列化。输出面统一走这里
 * （调用方仍须遵守 lossless 纪律：先条件展开可选键，再进本函数）。 */
export function redactJson<T>(value: T): T {
  return JSON.parse(redact(JSON.stringify(value))) as T
}

/* ── 远端作业契约（真机实测：setsid nohup + run.pid/exit.code/done + tail -c 偏移）── */

export interface RemoteRunPaths {
  /** 波浪号形式（~/srw-runs/<projectRef>/<runId>）——这是唯一可落盘的形态。 */
  readonly runDir: string
  readonly pidFile: string
  readonly logFile: string
  readonly exitFile: string
  readonly doneFile: string
}

export function remotePathsFor(runDir: string): RemoteRunPaths {
  return { runDir, pidFile: 'run.pid', logFile: 'run.log', exitFile: 'exit.code', doneFile: 'done' }
}

/* ── run.json（§5.3，MVP 字段面）：每 run 生命周期 + 溯源真相源 ── */

export interface RunGpuSnapshot {
  readonly index: number
  readonly name: string
  readonly memoryUsedMiB: number
  readonly memoryTotalMiB: number
}

export interface RunRecord {
  readonly schemaVersion: 1
  readonly runId: string
  readonly expId: string
  readonly attempt: number
  readonly parentRunId: string | null
  status: RunStatus
  readonly host: { readonly ref: string; readonly label: string; readonly provider: 'cm' | 'direct' }
  readonly remote: RemoteRunPaths
  /** 远端进程组 pid（setsid 会话首进程）；判不了活时可能为 null。 */
  pid: number | null
  readonly env: { readonly cudaVisibleDevices: string; readonly gpus: readonly RunGpuSnapshot[] }
  readonly seed: number
  readonly inputs: ReadonlyArray<{ readonly datasetId: string; readonly version: string; readonly sha256: string | null; readonly locator: string }>
  outputs: {
    readonly metrics: { readonly path: string; readonly sha256: string | null; readonly schemaOk: boolean } | null
    readonly artifacts: ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly bytes: number }>
  }
  log: { stdoutBytes: number; lastReadAt: string | null; staleCount: number }
  cancel: { requestedAt: string | null; reason: string | null }
  readonly timestamps: {
    readonly createdAt: string
    readonly submittedAt: string | null
    readonly endedAt: string | null
    lastPolledAt: string | null
  }
  lastError: string | null
}

/** run.json 宽松校验（坏文件 → INVALID，绝不静默重建——数据只增不删）。 */
export function validateRunRecord(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['run.json 必须是对象']
  const r = value as Record<string, unknown>
  const errors: string[] = []
  if (r['schemaVersion'] !== 1) errors.push('schemaVersion 必须为 1')
  if (typeof r['runId'] !== 'string' || r['runId'] === '') errors.push('runId 必填')
  if (typeof r['expId'] !== 'string' || r['expId'] === '') errors.push('expId 必填')
  if (!isRunStatus(r['status'])) errors.push('status 必须是 ' + RUN_STATUSES.join('|'))
  const host = r['host']
  const hostRef = typeof host === 'object' && host !== null ? (host as Record<string, unknown>)['ref'] : undefined
  if (typeof hostRef !== 'string' || !hostRef.startsWith('h-')) {
    errors.push('host.ref 必须是 h- 前缀哈希（绝不允许原始 hostId/地址）')
  }
  return errors
}

/* ── 环境快照（§5.2，MVP 字段面）── */

export interface GpuInfo {
  readonly index: number
  readonly name: string
  readonly driver?: string
  readonly memoryTotalMiB: number
  readonly memoryUsedMiB: number
  readonly utilPct?: number
  readonly computeCap?: string
}

export interface EnvSnapshot {
  readonly os: string
  readonly kernel: string
  readonly arch: string
  readonly cpuCount: number | null
  readonly memTotalMiB: number | null
  readonly gpus: readonly GpuInfo[]
  readonly nvidiaSmiPath: string | null
  readonly nvcc: { readonly path: string; readonly version: string } | null
  readonly python3: { readonly path: string; readonly version: string } | null
  readonly node: string | null
  readonly tools: Readonly<Record<string, boolean>>
  readonly disk: { readonly path: string; readonly totalKiB: number; readonly availKiB: number } | null
  readonly probedAt: string
}
