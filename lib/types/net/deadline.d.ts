/** 超时纪律工具（0203 Task 2.1）：`withDeadline` 用 AbortController 包住
 * 异步动作——超时即 abort 信号 + 抛 DeadlineError，调用方负责让内部操作
 * 响应 signal（fetch 原生支持；文件操作尽力而为）。 */
export declare class DeadlineError extends Error {
    readonly ms: number;
    constructor(ms: number);
}
export declare function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T>;
