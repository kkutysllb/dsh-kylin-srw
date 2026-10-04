/** RateGate（0102 §12 / 0203 Task 2.1）：按域的礼貌限速闸。
 *
 * - 令牌桶语义：同域请求间隔 ≥ minIntervalMs（含 ±20% 抖动，避免节拍共振）；
 *   跨域互不影响。
 * - 账本持久化 `<root>/.srw/rate-ledger.json`：跨进程唯一性由 withFileLock
 *   保证（读改写全程持锁）；本进程内另有内存串行链，省去同进程反复抢锁。
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

/** 全抖动 ±20%：返回 [0.8, 1.2] 区间乘子。 */
function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4)
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
  private cache: Ledger | null = null

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

  private async loadLedger(): Promise<Ledger> {
    if (this.cache !== null) return this.cache
    try {
      const parsed: unknown = JSON.parse(await readFile(this.currentLedgerPath(), 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) {
        const m = parsed as Record<string, unknown>
        if (m['schemaVersion'] === LEDGER_VERSION && typeof m['domains'] === 'object' && m['domains'] !== null) {
          this.cache = parsed as Ledger
          return this.cache
        }
      }
    } catch { /* 缺文件/坏文件：全新账本 */ }
    this.cache = emptyLedger()
    return this.cache
  }

  private async saveLedger(ledger: Ledger): Promise<void> {
    await mkdir(dirname(this.currentLedgerPath()), { recursive: true })
    await atomicWrite(this.currentLedgerPath(), JSON.stringify(ledger, null, 2) + '\n')
  }

  /** 账本读改写（跨进程持锁——O_EXCL 文件锁对同进程并发同样互斥）。
   * 回调内完成全部判定与更新。 */
  private async mutate<T>(fn: (ledger: Ledger) => T | Promise<T>): Promise<T> {
    return await withFileLock(`${this.currentLedgerPath()}.lock`, async () => {
      const ledger = await this.loadLedger()
      const result = await fn(ledger)
      await this.saveLedger(ledger)
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
