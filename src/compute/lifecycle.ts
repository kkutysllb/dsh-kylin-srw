/** 生命周期（§3 子能力 8/10 + §4.5 判活/取消）：远端探测（pid/exit/done/日志
 * 尺寸）→ 7 态分类（纯函数）；pid/exit/done 全缺且日志无增长 → unknown，
 * 绝不假成功；取消 = cancel.request + kill -TERM -<pid>（进程组）→ 宽限后
 * -KILL → kill -0 消失为准；不可达 → interrupted。 */

import type { ComputeProvider, HostTarget } from './provider.ts'
import type { RunStatus } from './types.ts'

export interface RemoteProbe {
  /** false = 传输级不可达（ssh 抛错）——断线保持原状态，绝不改判终态。 */
  readonly probeOk: boolean
  readonly pid: number | null
  readonly pidAlive: boolean
  readonly exitCode: number | null
  readonly exitRead: boolean
  readonly doneExists: boolean
  readonly logSize: number | null
  readonly detail: string
}

/** 远端探测（绝对路径逐项探测；单项失败不炸）。 */
export async function probeRun(provider: ComputeProvider, host: HostTarget, runDirAbs: string): Promise<RemoteProbe> {
  const text = async (argv: readonly string[]): Promise<{ code: number | null; out: string } | null> => {
    try {
      const res = await provider.exec(host, argv, { maxBytes: 4096, timeoutMs: 20_000 })
      return { code: res.code, out: new TextDecoder().decode(res.stdout) }
    } catch {
      return null
    }
  }
  // 首个探测兼作可达性判定：传输抛错 = 不可达（不改判终态）
  const pidRes = await text(['cat', runDirAbs + '/run.pid'])
  if (pidRes === null) {
    return { probeOk: false, pid: null, pidAlive: false, exitCode: null, exitRead: false, doneExists: false, logSize: null, detail: 'probe-unreachable' }
  }
  const pid = pidRes.code === 0 ? Number.parseInt(pidRes.out.trim(), 10) : null
  let pidAlive = false
  if (pid !== null && Number.isSafeInteger(pid) && pid > 0) {
    const alive = await text(['kill', '-0', '-' + String(pid)])
    pidAlive = alive !== null && alive.code === 0
  }
  const exitRes = await text(['cat', runDirAbs + '/exit.code'])
  const exitRead = exitRes !== null && exitRes.code === 0
  const exitCode = exitRead ? Number.parseInt((exitRes?.out ?? '').trim(), 10) : null
  const doneRes = await text(['test', '-f', runDirAbs + '/done'])
  const doneExists = doneRes !== null && doneRes.code === 0
  const sizeRes = await text(['stat', '-c', '%s', runDirAbs + '/run.log'])
  const logSize = sizeRes !== null && sizeRes.code === 0 ? Number.parseInt(sizeRes.out.trim(), 10) : null
  return {
    probeOk: true,
    pid: pid !== null && Number.isSafeInteger(pid) ? pid : null,
    pidAlive,
    exitCode: exitRead && Number.isSafeInteger(exitCode) ? exitCode : null,
    exitRead,
    doneExists,
    logSize: logSize !== null && Number.isSafeInteger(logSize) ? logSize : null,
    detail: 'ok',
  }
}

export interface ClassifyInput {
  readonly prev: RunStatus
  readonly probe: RemoteProbe
  readonly prevLogSize: number
  readonly staleCount: number
  /** 连续「全缺且无日志增长」多少次后判 unknown（默认 2，可注入）。 */
  readonly staleThreshold?: number
}

export interface ClassifyOutcome {
  readonly status: RunStatus
  readonly reason: string | null
  readonly staleCount: number
}

/** 7 态分类（纯函数，测试面）：
 * - 不可达：保持原状态（断线 §8.1；终态/unknown 也不许被断线改写）；
 * - exit.code + done 齐备：exit=0 → succeeded，否则 failed；
 * - pid 活 / 日志在涨：running；
 * - 全缺且无增长：stale 累计达阈值 → unknown（绝不 succeeded）。 */
export function classifyRun(input: ClassifyInput): ClassifyOutcome {
  const threshold = input.staleThreshold ?? 2
  if (!input.probe.probeOk) {
    return { status: input.prev, reason: input.prev === 'unknown' ? 'unreachable（保持 unknown）' : 'probe-unreachable（保持原状态）', staleCount: input.staleCount }
  }
  if (input.probe.exitRead && input.probe.doneExists) {
    const ok = input.probe.exitCode === 0
    return { status: ok ? 'succeeded' : 'failed', reason: ok ? null : 'exit ' + String(input.probe.exitCode ?? 'unknown'), staleCount: 0 }
  }
  if (input.probe.pidAlive) return { status: 'running', reason: null, staleCount: 0 }
  if (input.probe.logSize !== null && input.prevLogSize >= 0 && input.probe.logSize > input.prevLogSize) {
    return { status: 'running', reason: null, staleCount: 0 }
  }
  const staleCount = input.staleCount + 1
  if (staleCount >= threshold) {
    return { status: 'unknown', reason: 'pid/exit/done 全缺且日志无增长（连续 ' + String(staleCount) + ' 次）——需人工确认', staleCount }
  }
  const keepRunning = input.prev === 'queued' || input.prev === 'running'
  return { status: keepRunning ? input.prev : 'unknown', reason: keepRunning ? 'stale-probe（宽限中）' : null, staleCount }
}

export interface CancelOptions {
  readonly killGraceMs?: number
  readonly stepMs?: number
}

export type CancelOutcome = 'killed' | 'unreachable'

/** 取消（§4.5）：写 cancel.request（best-effort）→ kill -TERM -<pid>（setsid
 * 会话首进程，负号杀整组）→ 宽限（默认 15s）→ -KILL → kill -0 消失为准；
 * 任一传输失败 → 'unreachable'（服务层转 interrupted，下次 reconcile 重试）。 */
export async function cancelRemote(
  provider: ComputeProvider,
  host: HostTarget,
  runDirAbs: string,
  pid: number | null,
  options?: CancelOptions,
): Promise<CancelOutcome> {
  const graceMs = options?.killGraceMs ?? 15_000
  const stepMs = options?.stepMs ?? 200
  const sleep = async (ms: number): Promise<void> => { await new Promise<void>(resolve => { setTimeout(resolve, ms) }) }
  try {
    // cancel.request：哪怕 pid 判不了也先落标记（审计 + 重试依据）
    await provider.putBytes(host, runDirAbs + '/cancel.request', new TextEncoder().encode(new Date().toISOString() + '\n'))
    if (pid === null || pid <= 0) return 'killed'
    const term = await provider.exec(host, ['kill', '-TERM', '-' + String(pid)], { maxBytes: 1024, timeoutMs: 20_000 })
    if (term.code !== 0 && term.code !== null) {
      // 组已不存在 = 早已退出 → 视为已杀
      return 'killed'
    }
    const deadline = Date.now() + graceMs
    while (Date.now() < deadline) {
      await sleep(stepMs)
      const alive = await provider.exec(host, ['kill', '-0', '-' + String(pid)], { maxBytes: 1024, timeoutMs: 20_000 })
      if (alive.code !== 0) return 'killed'
    }
    await provider.exec(host, ['kill', '-KILL', '-' + String(pid)], { maxBytes: 1024, timeoutMs: 20_000 })
    await sleep(stepMs)
    return 'killed'
  } catch {
    return 'unreachable'
  }
}
