/** 生命周期（§3 子能力 8/10 + §4.5 判活/取消）：远端探测（pid/exit/done/日志
 * 尺寸）→ 7 态分类（纯函数）；pid/exit/done 全缺且日志无增长 → unknown，
 * 绝不假成功；取消 = cancel.request + kill -TERM -<pid>（进程组）→ 宽限后
 * -KILL → kill -0 消失为准；不可达 → interrupted。 */
import type { ComputeProvider, HostTarget } from './provider.ts';
import type { RunStatus } from './types.ts';
export interface RemoteProbe {
    /** false = 传输级不可达（ssh 抛错）——断线保持原状态，绝不改判终态。 */
    readonly probeOk: boolean;
    readonly pid: number | null;
    readonly pidAlive: boolean;
    readonly exitCode: number | null;
    readonly exitRead: boolean;
    readonly doneExists: boolean;
    readonly logSize: number | null;
    readonly detail: string;
}
/** 远端探测（绝对路径逐项探测；单项失败不炸）。 */
export declare function probeRun(provider: ComputeProvider, host: HostTarget, runDirAbs: string): Promise<RemoteProbe>;
export interface ClassifyInput {
    readonly prev: RunStatus;
    readonly probe: RemoteProbe;
    readonly prevLogSize: number;
    readonly staleCount: number;
    /** 连续「全缺且无日志增长」多少次后判 unknown（默认 2，可注入）。 */
    readonly staleThreshold?: number;
}
export interface ClassifyOutcome {
    readonly status: RunStatus;
    readonly reason: string | null;
    readonly staleCount: number;
}
/** 7 态分类（纯函数，测试面）：
 * - 不可达：保持原状态（断线 §8.1；终态/unknown 也不许被断线改写）；
 * - exit.code + done 齐备：exit=0 → succeeded，否则 failed；
 * - pid 活 / 日志在涨：running；
 * - 全缺且无增长：stale 累计达阈值 → unknown（绝不 succeeded）。 */
export declare function classifyRun(input: ClassifyInput): ClassifyOutcome;
export interface CancelOptions {
    readonly killGraceMs?: number;
    readonly stepMs?: number;
}
export type CancelOutcome = 'killed' | 'unreachable';
/** 取消（§4.5）：写 cancel.request（best-effort）→ kill -TERM -<pid>（setsid
 * 会话首进程，负号杀整组）→ 宽限（默认 15s）→ -KILL → kill -0 消失为准；
 * 任一传输失败 → 'unreachable'（服务层转 interrupted，下次 reconcile 重试）。 */
export declare function cancelRemote(provider: ComputeProvider, host: HostTarget, runDirAbs: string, pid: number | null, options?: CancelOptions): Promise<CancelOutcome>;
