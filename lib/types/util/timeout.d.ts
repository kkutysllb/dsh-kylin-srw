/** 超时融合（0205 Task 4.1）：宿主 GenerateOptions 没有 timeout 字段
 * （0102 §7.1 一手核对），翻译链在调用外融合 deadline；并区分「我方超时」
 * 与「上游取消/失败」——我方超时可重试，上游失败按其语义处理。 */
/** 我方超时（可重试）vs 上游失败（按语义）。 */
export declare class TimeoutError extends Error {
    readonly ms: number;
    constructor(ms: number);
}
/** 外部信号（取消）透传为外部原因。 */
export declare class UpstreamError extends Error {
    readonly cause: unknown;
    constructor(cause: unknown);
}
/** 带外部取消的限时执行：`ms` 内完成 → 值；超时 → TimeoutError（我方）；
 * 外部 signal 先触发 → UpstreamError（外部）；任务自身抛错原样透传。 */
export declare function timeoutOf<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T>;
/** 指数退避重试：`attempts` 次尝试（含首次），仅对可重试错误（判定函数）
 * 退避 `base * 2^n` ms；不可重试错误立即透传。 */
export declare function retryWithBackoff<T>(options: {
    attempts: number;
    baseMs: number;
    isRetryable: (error: unknown) => boolean;
    run: (attempt: number) => Promise<T>;
    sleep?: (ms: number) => Promise<void>;
}): Promise<T>;
