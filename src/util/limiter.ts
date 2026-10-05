/** 并发闸（0204 Task 4.1；宿主无 p-limit——0102 §7.1 一手核对）：上限内
 * 立即执行，满员排队 FIFO。run 抛错不吞（排队者照常推进）。
 *
 * 用途：翻译链逐块并发（默认 3，可配 1..6）。 */

export class Limiter {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`limiter concurrency must be an integer >= 1, got ${concurrency}`)
    }
  }

  /** 当前占用的闸位（观测/测试面）。 */
  get inFlight(): number {
    return this.active
  }

  /** 等队长度（观测/测试面）。 */
  get pending(): number {
    return this.queue.length
  }

  /** 占闸执行；满员则排队。返回值/异常原样透传。 */
  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.concurrency) {
      return this.start(task)
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.start(task).then(resolve, reject)
      })
    })
  }

  private start<T>(task: () => Promise<T>): Promise<T> {
    this.active += 1
    return task().finally(() => {
      this.active -= 1
      const next = this.queue.shift()
      if (next !== undefined) next()
    })
  }
}

/** 全量并发跑 map（闸内）；保持输入顺序返回。 */
export async function limitedMap<TIn, TOut>(
  limiter: Limiter,
  items: readonly TIn[],
  task: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length)
  let cursor = 0
  await Promise.all(items.map(() => {
    const index = cursor
    cursor += 1
    return limiter.run(async () => {
      results[index] = await task(items[index] as TIn, index)
    })
  }))
  return results
}
