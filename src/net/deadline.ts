/** 超时纪律工具（0203 Task 2.1）：`withDeadline` 用 AbortController 包住
 * 异步动作——超时即 abort 信号 + 抛 DeadlineError，调用方负责让内部操作
 * 响应 signal（fetch 原生支持；文件操作尽力而为）。 */

export class DeadlineError extends Error {
  constructor(readonly ms: number) {
    super(`deadline exceeded after ${ms}ms`)
    this.name = 'DeadlineError'
  }
}

export async function withDeadline<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ms)
  try {
    return await run(controller.signal)
  } catch (error: unknown) {
    if (controller.signal.aborted) throw new DeadlineError(ms)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
