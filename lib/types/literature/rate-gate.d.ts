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
/** 各源礼貌间隔（0102 §12）：arXiv 官方要求 3s。 */
export declare const DOMAIN_INTERVALS_MS: Readonly<Record<string, number>>;
export interface RateGateOptions {
    /** 账本文件绝对路径（`<root>/.srw/rate-ledger.json`）。 */
    readonly ledgerPath: string;
    /** 测试注入：覆盖域间隔（缺省用 DOMAIN_INTERVALS_MS/默认值）。 */
    readonly intervalsOverride?: Readonly<Record<string, number>>;
    /** 测试注入：等待函数（fake timer 用）；缺省真 setTimeout。 */
    readonly sleepFn?: (ms: number) => Promise<void>;
}
export declare class RateGate {
    private readonly ledgerPath;
    private readonly intervals;
    private readonly sleepFn;
    private cache;
    constructor(options: RateGateOptions);
    private minInterval;
    private loadLedger;
    private saveLedger;
    /** 账本读改写（跨进程持锁——O_EXCL 文件锁对同进程并发同样互斥）。
     * 回调内完成全部判定与更新。 */
    private mutate;
    /** 取一个放行槽：同域距上次放行不足 minInterval（含抖动）时等待。
     * 悲观预约——lastRequestAt 在持锁时即写为目标放行时刻，后来者（含
     * 跨进程）读到该值会自动排在其后。熔断期直接抛错。 */
    acquire(domain: string, now?: number): Promise<{
        at: number;
        waitedMs: number;
    }>;
    /** 上报一次被限流（429/503）：指数退避（2^n × 1s）与 Retry-After 取大者，
     * 通过**把 lastRequestAt 推到退避截止**生效（下一次 acquire 自然等待）；
     * 连续 n≥5 熔断 10 分钟。 */
    reportFailure(domain: string, retryAfterSeconds?: number, now?: number): Promise<void>;
    /** 上报一次成功：清零失败计数、解除熔断。 */
    reportSuccess(domain: string): Promise<void>;
}
