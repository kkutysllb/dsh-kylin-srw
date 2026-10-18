/** Task 2.1：RateGate 令牌桶/退避/熔断 + 文件锁互斥（含跨进程）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, utimes, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RateGate } from '../src/literature/rate-gate.ts'
import { withFileLock, lockPathFor } from '../src/literature/file-lock.ts'
import { DeadlineError, withDeadline } from '../src/net/deadline.ts'

const run = promisify(execFile)

async function withTemp(run_: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'srw-rate-'))
  try {
    await run_(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('rate-gate：同域令牌桶——并发预约间隔 ≥ interval（正抖动下限，不低于官方下限）', async () => {
  await withTemp(async (dir) => {
    const gate = new RateGate({
      ledgerPath: join(dir, 'ledger.json'),
      intervalsOverride: { 'a.test': 100 },
      sleepFn: async () => {}, // 只验预约序，不真睡
    })
    const t0 = Date.now()
    const slots = await Promise.all([1, 2, 3, 4, 5].map(() => gate.acquire('a.test', t0)))
    const ats = slots.map(s => s.at).sort((a, b) => a - b)
    for (let i = 1; i < ats.length; i++) {
      assert.ok(ats[i]! - ats[i - 1]! >= 100, `slot ${i} spacing ${ats[i]! - ats[i - 1]!} < 100`)
    }
    // 跨域不受影响
    const other = await gate.acquire('b.test', t0)
    assert.equal(other.waitedMs, 0)
  })
})

test('rate-gate：429 退避生效且 Retry-After 取大者；熔断后抛 RATE_CIRCUIT_OPEN', async () => {
  await withTemp(async (dir) => {
    const sleeps: number[] = []
    const gate = new RateGate({
      ledgerPath: join(dir, 'ledger.json'),
      intervalsOverride: { 'a.test': 10 },
      sleepFn: async (ms) => { sleeps.push(ms) },
    })
    const t0 = Date.now()
    await gate.acquire('a.test', t0)
    // 第 1 次失败：退避 1s；Retry-After=60 → 取 60s
    await gate.reportFailure('a.test', 60, t0)
    const next = await gate.acquire('a.test', t0 + 5)
    assert.ok(next.waitedMs >= 59_000, `waited ${next.waitedMs} < 59s`)
    // 连续 5 次失败 → 熔断
    for (let i = 0; i < 5; i++) {
      await gate.reportFailure('a.test', undefined, t0)
    }
    await assert.rejects(
      () => gate.acquire('a.test', t0),
      (e: unknown) => (e as { code?: string }).code === 'RATE_CIRCUIT_OPEN',
    )
    // 成功清零并解除熔断
    await gate.reportSuccess('a.test')
    const ok = await gate.acquire('a.test', Date.now())
    assert.ok(ok.at > 0)
  })
})

test('rate-gate：账本持久化 + 换实例读取（跨进程语义的进程内模拟）', async () => {
  await withTemp(async (dir) => {
    const path = join(dir, 'ledger.json')
    const gate1 = new RateGate({ ledgerPath: path, intervalsOverride: { 'a.test': 500 }, sleepFn: async () => {} })
    const t0 = Date.now()
    await gate1.acquire('a.test', t0)
    // 新实例（模拟另一进程后启动）读到 lastRequestAt → 需等待
    const gate2 = new RateGate({ ledgerPath: path, intervalsOverride: { 'a.test': 500 }, sleepFn: async () => {} })
    const second = await gate2.acquire('a.test', t0 + 10)
    assert.ok(second.waitedMs >= 390, `cross-instance waited ${second.waitedMs} < 390`)
  })
})

test('rate-gate：跨实例——A 装载旧账本后 B 推后账本，A 再 acquire 必须看到 B 的预约', async () => {
  await withTemp(async (dir) => {
    const path = join(dir, 'ledger.json')
    const t0 = 1_000_000
    const gateA = new RateGate({
      ledgerPath: path,
      intervalsOverride: { 'a.test': 1_000 },
      sleepFn: async () => {}, // 只验预约序，不真睡
    })
    const first = await gateA.acquire('a.test', t0)
    assert.equal(first.waitedMs, 0)

    // B 以更晚的 now 抢到锁：账本被推到 t0+5000（旧实现 A 的缓存仍停在 t0）
    const gateB = new RateGate({ ledgerPath: path, intervalsOverride: { 'a.test': 1_000 }, sleepFn: async () => {} })
    const second = await gateB.acquire('a.test', t0 + 5_000)
    assert.equal(second.waitedMs, 0)
    assert.equal(second.at, t0 + 5_000)

    // A 再 acquire：必须从磁盘看到 B 的预约 → 等待，且落点比 B 晚 ≥ interval
    const third = await gateA.acquire('a.test', t0 + 5_500)
    assert.ok(third.waitedMs > 0, `旧实现命中缓存会 0 等待（实际 ${third.waitedMs}）`)
    assert.ok(third.at - second.at >= 1_000, `A 未看到 B 的预约：间距 ${third.at - second.at} < 1000`)
  })
})

test('rate-gate：同一实例换 ledgerPath——换根从新账本开始，不继承旧根等待', async () => {
  await withTemp(async (dir) => {
    const t0 = 1_000_000
    let current = join(dir, 'ledger-a.json')
    const sleeps: number[] = []
    const gate = new RateGate({
      ledgerPath: () => current,
      intervalsOverride: { 'a.test': 1_000 },
      sleepFn: async (ms) => { sleeps.push(ms) },
    })
    // 根 A：把账本预约推到 t0+500,000（模拟该根下已有外部预约）
    const seeded = await gate.acquire('a.test', t0 + 500_000)
    assert.equal(seeded.waitedMs, 0)
    // 换根 B：旧实现仍用缓存 A → 以 now=t0 再 acquire 会等待 ~500s
    current = join(dir, 'ledger-b.json')
    const fresh = await gate.acquire('a.test', t0)
    assert.equal(fresh.waitedMs, 0, '换根后应从空账本开始，不继承根 A 的预约')
    assert.equal(fresh.at, t0)
    assert.deepEqual(sleeps, [])
    // 换回根 A：同样重新读盘，看到的是 A 的预约（不是 B 的）
    current = join(dir, 'ledger-a.json')
    const back = await gate.acquire('a.test', t0 + 500_500)
    assert.ok(back.waitedMs > 0, '换回根 A 应看到 A 的预约')
    assert.ok(back.at - seeded.at >= 1_000, `换回根 A 未排在其预约之后：${back.at - seeded.at} < 1000`)
    assert.equal(sleeps.length, 1)
  })
})

test('file-lock：临界区互斥（并发无重叠）+ 陈旧锁强破', async () => {
  await withTemp(async (dir) => {
    const target = join(dir, 'state.json')
    const sections: Array<{ start: number; end: number }> = []
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      withFileLock(lockPathFor(target), async () => {
        const start = Date.now()
        await writeFile(target, String(i))
        await new Promise(resolve => { setTimeout(resolve, 30) })
        sections.push({ start, end: Date.now() })
      })))
    sections.sort((a, b) => a.start - b.start)
    for (let i = 1; i < sections.length; i++) {
      assert.ok(sections[i]!.start >= sections[i - 1]!.end - 2, `section ${i} overlaps`)
    }
    // 陈旧锁：手工放一个 mtime 40s 前的锁 → 应被强破而非超时
    const stale = lockPathFor(target)
    await writeFile(stale, '99999')
    const old = new Date(Date.now() - 40_000)
    await utimes(stale, old, old)
    const result = await withFileLock(stale, async () => 'entered')
    assert.equal(result, 'entered')
  })
})

test('file-lock：跨进程互斥（子进程并发写序）', async () => {
  await withTemp(async (dir) => {
    const target = join(dir, 'shared.json')
    const lock = lockPathFor(target)
    // 子进程脚本：抢锁 → 读文件 → +1 → 睡 20ms → 写回（无锁的读改写必然丢更新）
    const script = `
      const { withFileLock, lockPathFor } = await import(${JSON.stringify(process.cwd() + '/src/literature/file-lock.ts')});
      const { readFile, writeFile } = await import('node:fs/promises');
      const target = ${JSON.stringify(target)};
      for (let i = 0; i < 5; i++) {
        await withFileLock(${JSON.stringify(lock)}, async () => {
          let n = 0;
          try { n = Number(await readFile(target, 'utf8')) || 0 } catch {}
          await new Promise(r => setTimeout(r, 20));
          await writeFile(target, String(n + 1));
        });
      }
    `
    const tmpScript = join(dir, 'worker.mjs')
    await writeFile(tmpScript, script)
    // 4 个子进程 × 5 次 = 20；锁生效则恰好 20，不生效必然 <20
    await Promise.all(Array.from({ length: 4 }, () =>
      run(process.execPath, ['--import', 'tsx', tmpScript], { cwd: process.cwd() })))
    const final = Number(await readFile(target, 'utf8'))
    assert.equal(final, 20)
  })
})

test('withDeadline：超时抛 DeadlineError 且信号 abort；不超时透传', async () => {
  await assert.rejects(() => withDeadline(50, async (signal) => {
    await new Promise((_r, reject) => { signal.addEventListener('abort', () => { reject(new Error('aborted')) }) })
  }), DeadlineError)
  const value = await withDeadline(1_000, async () => 42)
  assert.equal(value, 42)
})
