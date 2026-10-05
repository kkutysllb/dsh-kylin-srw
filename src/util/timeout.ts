/** 超时融合（0205 Task 4.1）：宿主 GenerateOptions 没有 timeout 字段
 * （0102 §7.1 一手核对），翻译链在调用外融合 deadline；并区分「我方超时」
 * 与「上游取消/失败」——我方超时可重试，上游失败按其语义处理。 */

import { DeadlineError } from '../net/deadline.ts'

/** 我方超时（可重试）vs 上游失败（按语义）。 */
export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/** 外部信号（取消）透传为外部原因。 */
export class UpstreamError extends Error {
  constructor(readonly cause: unknown) {
    super(`upstream failure: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'UpstreamError'
  }
}

/** 带外部取消的限时执行：`ms` 内完成 → 值；超时 → TimeoutError（我方）；
 * 外部 signal 先触发 → UpstreamError（外部）；任务自身抛错原样透传。 */
export async function timeoutOf<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const onExternal = (): void => { controller.abort() }
  external?.addEventListener('abort', onExternal, { once: true })
  const timer = setTimeout(() => { controller.abort() }, ms)
  try {
    return await run(controller.signal)
  } catch (error: unknown) {
    if (external?.aborted === true) throw new UpstreamError(error)
    if (error instanceof DeadlineError || controller.signal.aborted) throw new TimeoutError(ms)
    throw error
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onExternal)
  }
}

/** 指数退避重试：`attempts` 次尝试（含首次），仅对可重试错误（判定函数）
 * 退避 `base * 2^n` ms；不可重试错误立即透传。 */
export async function retryWithBackoff<T>(options: {
  attempts: number
  baseMs: number
  isRetryable: (error: unknown) => boolean
  run: (attempt: number) => Promise<T>
  sleep?: (ms: number) => Promise<void>
}): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) }))
  let lastError: unknown
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await options.run(attempt)
    } catch (error: unknown) {
      lastError = error
      if (attempt === options.attempts || !options.isRetryable(error)) throw error
      await sleep(options.baseMs * 2 ** (attempt - 1))
    }
  }
  throw lastError
}
