/** WatchManager（0204 §1 修订版）：触发绑定内置「自动化任务」（ctx.schedule）
 * ——订阅创建即建宿主时钟任务（自包含 prompt 唤醒绑定会话调 `srw_watch run`）；
 * 执行是我的 host 确定性代码（search→importEntries 幂等入库）。pause=删时钟
 * 任务留订阅；resume=重建（E3 验明的 create/delete 面，不依赖 update）。
 * 会话死亡 → schedule 投递 warn 卡 active（宿主已知语义）→ lastResult 停滞
 * 即面板信号，resume 可重绑新会话。 */
import type { LiteratureService } from '../literature/service.ts';
import { type WatchSub } from './model.ts';
import type { SrwFsLike } from '../host.ts';
/** 绑定层眼里的宿主时钟（只依赖 E3 验明过的 create/delete 两面）。 */
export interface SchedulePort {
    create(sessionId: string, request: Record<string, unknown>): Promise<unknown>;
    remove(input: {
        sessionId: string;
        id: string;
    }): Promise<unknown>;
}
/** 绑定层眼里的文献服务（窄面，测试注入 fake）。 */
export interface WatchLiterature {
    search(source: string, query: string, limit: number): Promise<readonly unknown[]>;
    importEntries(project: string, candidates: readonly unknown[]): Promise<{
        added: number;
        duplicates: number;
        retracted: string[];
        enriched: string[];
    }>;
}
export interface WatchDeps {
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: () => string | undefined;
    readonly offlineMode: () => boolean;
    readonly schedule: SchedulePort;
    readonly literature: () => WatchLiterature;
}
export declare class WatchManager {
    private readonly deps;
    constructor(deps: WatchDeps);
    private requireRoot;
    private store;
    list(): Promise<readonly WatchSub[]>;
    private requireSub;
    private patchById;
    /** 宿主时钟任务建投递（订阅已落盘后调用；失败只降级为「未排程」）。 */
    private bind;
    private unbind;
    /** 建订阅：先落盘（订阅本体是真相源），再尽量绑时钟。绑定失败/无会话都
     * 不回滚——面板明示「未排程」，resume 可补绑。 */
    create(input: {
        project?: unknown;
        source?: unknown;
        query?: unknown;
        everySeconds?: unknown;
    }, sessionId?: string): Promise<{
        sub: WatchSub;
        scheduled: boolean;
        hint?: string;
    }>;
    /** 删订阅：先解绑时钟（best-effort），再删本体。 */
    remove(id: string): Promise<void>;
    /** 暂停：删时钟任务（订阅与绑定会话保留）。 */
    pause(id: string): Promise<WatchSub>;
    /** 恢复：重建时钟任务。显式 sessionId 优先（重绑到当前会话），否则用原绑定。 */
    resume(id: string, sessionId?: string): Promise<{
        sub: WatchSub;
        scheduled: boolean;
        hint?: string;
    }>;
    /** 立即抓一次（也是时钟唤醒轮的执行体）：search→importEntries（幂等+自愈）
     * → lastResult 落账。失败/离线也落账后原样抛（调用方决定怎么呈现）。 */
    run(id: string): Promise<{
        fresh: number;
        duplicates: number;
        enriched: readonly string[];
    }>;
    private record;
}
/** 装配：从 SrwService 取动态参数（schedule 面 = E3 验明的 create/delete）。 */
export declare function attachWatch(service: import('../service.ts').SrwService, literature: () => LiteratureService): WatchManager;
