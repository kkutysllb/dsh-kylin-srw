/** 并发闸（0204 Task 4.1；宿主无 p-limit——0102 §7.1 一手核对）：上限内
 * 立即执行，满员排队 FIFO。run 抛错不吞（排队者照常推进）。
 *
 * 用途：翻译链逐块并发（默认 3，可配 1..6）。 */
export declare class Limiter {
    readonly concurrency: number;
    private active;
    private readonly queue;
    constructor(concurrency: number);
    /** 当前占用的闸位（观测/测试面）。 */
    get inFlight(): number;
    /** 等队长度（观测/测试面）。 */
    get pending(): number;
    /** 占闸执行；满员则排队。返回值/异常原样透传。 */
    run<T>(task: () => Promise<T>): Promise<T>;
    private start;
}
/** 全量并发跑 map（闸内）；保持输入顺序返回。 */
export declare function limitedMap<TIn, TOut>(limiter: Limiter, items: readonly TIn[], task: (item: TIn, index: number) => Promise<TOut>): Promise<TOut[]>;
