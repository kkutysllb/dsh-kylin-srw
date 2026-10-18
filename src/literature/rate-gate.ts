/** RateGate（0102 §12 / 0203 Task 2.1）：按域的礼貌限速闸。
 *
 * - 令牌桶语义：同域请求间隔 ≥ minIntervalMs（含 +0–20% 正抖动，避免节拍
 *   共振；抖动不低于官方下限）；跨域互不影响。
 * - 账本持久化 `<root>/.srw/rate-ledger.json`：跨进程唯一性由 withFileLock
 *   保证（读改写全程持锁）。**每次 mutate 都在锁内重新读盘**，不跨调用缓存
 *   账本——因此外部实例的预约立即可见，换根（ledgerPath getter 返回新路径）
 *   也从新账本开始。
 * - 429/503 退避：`reportFailure` 指数退避（2^n × 1s，n 为连续失败数），
 *   `Retry-After` 取大者；连续 5 次熔断 10 分钟（circuitUntil），
 *   熔断期 acquire 直接抛 `RATE_CIRCUIT_OPEN`。成功请求清零计数。
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ServiceError } from '../service.ts'
import { atomicWrite, withFileLock } from './file-lock.ts'

const LEDGER_VERSION = 1
/** 默认最小间隔（毫秒）：未登记域的保守值。 */
const DEFAULT_MIN_INTERVAL_MS = 1_000
/** 各源礼貌间隔（0102 §12）：arXiv 官方要求 3s。 */
export const DOMAIN_INTERVALS_MS: Readonly<Record<string, number>> = {
  'export.arxiv.org': 3_000,
  'arxiv.org': 3_000,
  'api.openalex.org': 1_000,
  'api.crossref.org': 1_000,
  'data.crossref.org': 1_000,
}
/** 退避参数。 */
const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_N = 5
const CIRCUIT_MS = 10 * 60 * 1_000

interface DomainLedger {
  lastRequestAt: number
  consecutive429: number
  circuitUntil?: number
}

interface Ledger {
  schemaVersion: typeof LEDGER_VERSION
  domains: Record<string, DomainLedger>
}

function emptyLedger(): Ledger {
  return { schemaVersion: LEDGER_VERSION, domains: {} }
}

/** 正抖动 +0–20%：返回 [1.0, 1.2] 区间乘子。负抖动会让 arXiv 的 3s
 * 实际间隔落到 2.4s、低于官方下限，故只向上抖。 */
function jitter(ms: number): number {
  return ms * (1 + Math.random() * 0.2)
}

export interface RateGateOptions {
  /** 账本文件绝对路径（`<root>/.srw/rate-ledger.json`）；getter 形式支持
   * 总根运行期变更（setRoot 后账本跟根走）。 */
  readonly ledgerPath: string | (() => string)
  /** 测试注入：覆盖域间隔（缺省用 DOMAIN_INTERVALS_MS/默认值）。 */
  readonly intervalsOverride?: Readonly<Record<string, number>>
  /** 测试注入：等待函数（fake timer 用）；缺省真 setTimeout。 */
  readonly sleepFn?: (ms: number) => Promise<void>
}

export class RateGate {
  private readonly ledgerPath: () => string
  private readonly intervals: Readonly<Record<string, number>>
  private readonly sleepFn: (ms: number) => Promise<void>

  constructor(options: RateGateOptions) {
    const raw = options.ledgerPath
    this.ledgerPath = typeof raw === 'function' ? raw : () => raw
    this.intervals = options.intervalsOverride ?? DOMAIN_INTERVALS_MS
    this.sleepFn = options.sleepFn ?? ((ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) }))
  }

  private currentLedgerPath(): string {
    return this.ledgerPath()
  }

  private minInterval(domain: string): number {
    return this.intervals[domain] ?? DEFAULT_MIN_INTERVAL_MS
  }

  /** 从 path 读账本（**不缓存**）：缺文件/坏文件返回空账本。 */
  private async loadLedger(path: string): Promise<Ledger> {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) {
        const m = parsed as Record<string, unknown>
        if (m['schemaVersion'] === LEDGER_VERSION && typeof m['domains'] === 'object' && m['domains'] !== null) {
          return parsed as Ledger
        }
      }
    } catch { /* 缺文件/坏文件：全新账本 */ }
    return emptyLedger()
  }

  private async saveLedger(path: string, ledger: Ledger): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await atomicWrite(path, JSON.stringify(ledger, null, 2) + '\n')
  }

  /** 账本读改写（跨进程持锁——O_EXCL 文件锁对同进程并发同样互斥）。
   * 锁内**每次重新读盘**，外部实例/变更根后的账本立即生效；回调内完成全部
   * 判定与更新。路径在进锁前取一次，避免 getter 中途换根造成读到 A 写到 B。 */
  private async mutate<T>(fn: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    const path = this.currentLedgerPath()
    return await withFileLock(`${path}.lock`, async () => {
      const ledger = await this.loadLedger(path)
      const result = await fn(ledger)
      await this.saveLedger(path, ledger)
      return result
    })
  }

  /** 取一个放行槽：同域距上次放行不足 minInterval（含抖动）时等待。
   * 悲观预约——lastRequestAt 在持锁时即写为目标放行时刻，后来者（含
   * 跨进程）读到该值会自动排在其后。熔断期直接抛错。 */
  async acquire(domain: string, now = Date.now()): Promise<{ at: number; waitedMs: number }> {
    const { at, waitMs } = await this.mutate((ledger) => {
      const entry: DomainLedger = ledger.domains[domain] ?? { lastRequestAt: 0, consecutive429: 0 }
      if (entry.circuitUntil !== undefined && now < entry.circuitUntil) {
        const seconds = Math.ceil((entry.circuitUntil - now) / 1000)
        throw new ServiceError('RATE_CIRCUIT_OPEN', `域 ${domain} 熔断中（还需 ${seconds}s）：连续 429/503 触发上限退避`)
      }
      const interval = jitter(this.minInterval(domain))
      const earliest = entry.lastRequestAt + interval
      const resolvedWait = Math.max(0, earliest - now)
      const reservedAt = now + resolvedWait
      entry.lastRequestAt = reservedAt
      ledger.domains[domain] = entry
      return { at: reservedAt, waitMs: resolvedWait }
    })
    if (waitMs > 0) await this.sleepFn(waitMs)
    return { at, waitedMs: waitMs }
  }

  /** 上报一次被限流（429/503）：指数退避（2^n × 1s）与 Retry-After 取大者，
   * 通过**把 lastRequestAt 推到退避截止**生效（下一次 acquire 自然等待）；
   * 连续 n≥5 熔断 10 分钟。 */
  async reportFailure(domain: string, retryAfterSeconds?: number, now = Date.now()): Promise<void> {
    await this.mutate((ledger) => {
      const entry: DomainLedger = ledger.domains[domain] ?? { lastRequestAt: 0, consecutive429: 0 }
      entry.consecutive429 += 1
      const backoffMs = Math.min(BACKOFF_MAX_N, entry.consecutive429) ** 2 * BACKOFF_BASE_MS
      const retryAfterMs = retryAfterSeconds !== undefined ? retryAfterSeconds * 1_000 : 0
      const until = now + Math.max(backoffMs, retryAfterMs)
      entry.lastRequestAt = Math.max(entry.lastRequestAt, until)
      if (entry.consecutive429 >= BACKOFF_MAX_N) {
        entry.circuitUntil = now + CIRCUIT_MS
        entry.consecutive429 = 0
      }
      ledger.domains[domain] = entry
    })
  }

  /** 上报一次成功：清零失败计数、解除熔断。 */
  async reportSuccess(domain: string): Promise<void> {
    await this.mutate((ledger) => {
      const entry: DomainLedger = ledger.domains[domain] ?? { lastRequestAt: 0, consecutive429: 0 }
      entry.consecutive429 = 0
      if (entry.circuitUntil !== undefined) delete entry.circuitUntil
      ledger.domains[domain] = entry
    })
  }
}
