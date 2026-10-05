/** 订阅模型（0204 §2）：`<root>/.srw/watch.json` 的行形状 + 入参校验。
 * 时钟任务本体归宿主「自动化任务」（ctx.schedule，0204 §1 修订版），
 * 这里只存订阅本体与绑定 id——不复制宿主时钟字段。 */
export declare const WATCH_SCHEMA_VERSION = 1;
/** 频率地板：宿主 schedule 仅限 every≥60（domain.ts MIN_EVERY_INTERVAL_SECONDS），
 * 这里再收紧——文献抓取没意义更频，且礼貌限速。无上限（周/双周订阅合法）。 */
export declare const WATCH_EVERY_FLOOR = 900;
export declare const WATCH_SOURCES: readonly ["arxiv", "openalex", "crossref"];
export type WatchSource = (typeof WATCH_SOURCES)[number];
/** 一次运行的结果（面板可见性全靠它：失败可见 → 手动 run 或下个周期重试）。 */
export interface WatchResult {
    readonly at: string;
    readonly kind: 'ok' | 'error';
    readonly fresh?: number;
    readonly error?: string;
}
export interface WatchSub {
    readonly id: string;
    readonly project: string;
    readonly source: WatchSource;
    readonly query: string;
    readonly everySeconds: number;
    readonly enabled: boolean;
    readonly createdAt: string;
    /** schedule 投递目标会话（创建时的会话；面板创建绑最新根会话）。 */
    readonly boundSessionId?: string;
    /** 绑定成功的宿主时钟任务 id；pause 即删任务、resume 重建。 */
    readonly scheduleId?: string;
    readonly lastRunAt?: string;
    readonly lastResult?: WatchResult;
}
export interface WatchDoc {
    readonly schemaVersion: typeof WATCH_SCHEMA_VERSION;
    revision: number;
    subs: WatchSub[];
}
export declare function emptyWatchDoc(): WatchDoc;
export declare function watchDocPath(rootDir: string): string;
/** 新订阅入参校验（RPC/工具共用的唯一 choke point）。 */
export declare function validateWatchInput(input: {
    project?: unknown;
    source?: unknown;
    query?: unknown;
    everySeconds?: unknown;
}): {
    project: string;
    source: WatchSource;
    query: string;
    everySeconds: number;
};
/** 确定性时钟任务标题（自动化任务页里人可读；对账锚点）。 */
export declare function scheduleTitle(sub: Pick<WatchSub, 'id' | 'query'>): string;
/** 自包含投递 prompt：唤醒会话里的 agent 调 run 并一句话汇报（0 条也说）。 */
export declare function schedulePrompt(sub: Pick<WatchSub, 'id' | 'project'>): string;
