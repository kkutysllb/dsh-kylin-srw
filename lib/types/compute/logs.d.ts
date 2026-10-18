/** 日志偏移续读（§3 子能力 9 + §4.5 断线续读）：tail -c +N 增量拉取 +
 * 本地镜像对账（mirrorSha256 + 远端尺寸回退检测）+ 总量上限显式失败
 * （LOG_CAP_EXCEEDED，绝不静默截断）。本地镜像落盘前过 redact()（§4.4：
 * 落盘只允许脱敏内容），offset.json 记录远端字节偏移。 */
import type { ComputeProvider, HostTarget } from './provider.ts';
export interface LogOffsetFile {
    stdoutBytes: number;
    lastReadAt: string | null;
    /** 本地镜像（脱敏后全文）的 sha256——下次读取先对账，被手改即整段重读。 */
    mirrorSha256: string | null;
}
/** 宽松解析 offset.json（缺文件/坏 JSON → 归零重读，绝不带着坏偏移续读）。 */
export declare function parseOffsetFile(raw: unknown): LogOffsetFile;
export interface PullRunLogInput {
    readonly provider: ComputeProvider;
    readonly host: HostTarget;
    readonly runDirAbs: string;
    readonly localLogPath: string;
    readonly localOffsetPath: string;
    readonly prev: LogOffsetFile;
    readonly maxLogBytes: number;
    readonly now: string;
    readonly chunkCap?: number;
}
export interface PullRunLogOutcome {
    readonly appendedBytes: number;
    readonly totalRemoteBytes: number;
    readonly offset: LogOffsetFile;
    /** true = 镜像对账失败/远端回退，已归零整段重读。 */
    readonly reconciled: boolean;
    readonly tailText: string;
}
export declare function pullRunLog(input: PullRunLogInput): Promise<PullRunLogOutcome>;
