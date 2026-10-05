/** 并发闸与超时融合（0205 Task 4.1）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Limiter, limitedMap } from '../src/util/limiter.ts'
import { TimeoutError, UpstreamError, retryWithBackoff, timeoutOf } from '../src/util/timeout.ts'

const tick = (ms = 5): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

test('limiter：并发数被闸住；完成一个放进下一个', async () => {
  const limiter = new Limiter(2)
  let peak = 0
  let active = 0
  const task = async (): Promise<void> => {
    active += 1
    peak = Math.max(peak, active)
    await tick(20)
    active -= 1
  }
  await Promise.all(Array.from({ length: 6 }, () => limiter.run(task)))
  assert.equal(peak, 2, '峰值并发不得超过上限')
  assert.equal(limiter.inFlight, 0)
  assert.equal(limiter.pending, 0)
})

test('limiter：FIFO 排队；异常透传不堵队', async () => {
  const limiter = new Limiter(1)
  const order: string[] = []
  const boom = limiter.run(async () => {
    await tick(5)
    order.push('boom')
    throw new Error('task failed')
  })
  const after = limiter.run(async () => {
    order.push('after')
    return 'ok'
  })
  await assert.rejects(boom, /task failed/)
  assert.equal(await after, 'ok', '异常任务不堵队')
  assert.deepEqual(order, ['boom', 'after'])
})

test('limiter：非法并发数拒绝', () => {
  assert.throws(() => new Limiter(0), />= 1/)
  assert.throws(() => new Limiter(1.5), /integer/)
})

test('limitedMap：保序返回', async () => {
  const limiter = new Limiter(3)
  const out = await limitedMap(limiter, [1, 2, 3, 4, 5], async value => value * 10)
  assert.deepEqual(out, [10, 20, 30, 40, 50])
})

test('timeoutOf：超时抛 TimeoutError（我方）；外部取消抛 UpstreamError；成功透传', async () => {
  await assert.rejects(
    () => timeoutOf(20, signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted-inside')) })
    })),
    TimeoutError,
  )
  const external = new AbortController()
  const pending = timeoutOf(5_000, signal => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { reject(new Error('cancelled-inside')) })
  }), external.signal)
  setTimeout(() => { external.abort() }, 10)
  await assert.rejects(() => pending, UpstreamError)
  assert.equal(await timeoutOf(50, async () => 'value'), 'value')
})

test('retryWithBackoff：可重试错误退避后成功；不可重试立即透传', async () => {
  let calls = 0
  const value = await retryWithBackoff({
    attempts: 3,
    baseMs: 1,
    isRetryable: error => error instanceof TimeoutError,
    run: async () => {
      calls += 1
      if (calls < 3) throw new TimeoutError(1)
      return 'recovered'
    },
  })
  assert.equal(value, 'recovered')
  assert.equal(calls, 3)
  let fatalCalls = 0
  await assert.rejects(
    () => retryWithBackoff({
      attempts: 3,
      baseMs: 1,
      isRetryable: () => false,
      run: async () => {
        fatalCalls += 1
        throw new Error('fatal')
      },
    }),
    /fatal/,
  )
  assert.equal(fatalCalls, 1, '不可重试只调一次')
})
