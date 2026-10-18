/** M7 计算域共享类型与纯助手（analysis/goals/04 §4/§5）：7 态生命周期、
 * 脱敏（IPv4/IPv6/user@/:port//home|Users 全 redact）、hostRef=sha256(hostId)[:8]、
 * projectRef=sha256(项目绝对路径)[:12]、run.json 形状与校验。
 * 红线：本目录永不出现宿主凭据文件字样（tests 断言 0 命中）；地址/用户名/端口
 * 只存在于内存，不落工作区（落盘/输出前一律过 redact）。 */
export declare const RUN_STATUSES: readonly ["queued", "running", "succeeded", "failed", "cancelled", "interrupted", "unknown"];
export type RunStatus = (typeof RUN_STATUSES)[number];
/** 终态（数据只增不删；interrupted/unknown 仍可 reconcile 恢复）。 */
export declare const TERMINAL_STATUSES: ReadonlySet<RunStatus>;
export declare function isRunStatus(value: unknown): value is RunStatus;
export declare function sha256Hex(data: Uint8Array | string): string;
/** hostRef = 'h-' + sha256(hostId).slice(0,8)：唯一可落盘的主机标识
 * （真机 P1 实测 hostId 本身含 IP，绝不当 ref/label 用）。 */
export declare function hostRefOf(hostId: string): string;
/** projectRef = sha256(项目绝对路径)[:12]：远端目录不泄露本地路径（§5.2）。 */
export declare function projectRefOf(projectAbsPath: string): string;
export declare const REDACT_IP = "<ip>";
export declare const REDACT_TARGET = "<ssh-target>";
export declare const REDACT_HOME = "<home>";
export declare const REDACT_PORT = ":<port>";
/** 单行脱敏（确定性纯函数，测试面）：IPv4/IPv6 → <ip>；user@host → <ssh-target>；
 * /home/<user> 等家目录 → <home>；host:port → :<port>。 */
export declare function redact(text: string): string;
/** 结构化脱敏：JSON 序列化 → redact → 反序列化。输出面统一走这里
 * （调用方仍须遵守 lossless 纪律：先条件展开可选键，再进本函数）。 */
export declare function redactJson<T>(value: T): T;
export interface RemoteRunPaths {
    /** 波浪号形式（~/srw-runs/<projectRef>/<runId>）——这是唯一可落盘的形态。 */
    readonly runDir: string;
    readonly pidFile: string;
    readonly logFile: string;
    readonly exitFile: string;
    readonly doneFile: string;
}
export declare function remotePathsFor(runDir: string): RemoteRunPaths;
export interface RunGpuSnapshot {
    readonly index: number;
    readonly name: string;
    readonly memoryUsedMiB: number;
    readonly memoryTotalMiB: number;
}
export interface RunRecord {
    readonly schemaVersion: 1;
    readonly runId: string;
    readonly expId: string;
    readonly attempt: number;
    readonly parentRunId: string | null;
    status: RunStatus;
    readonly host: {
        readonly ref: string;
        readonly label: string;
        readonly provider: 'cm' | 'direct';
    };
    readonly remote: RemoteRunPaths;
    /** 远端进程组 pid（setsid 会话首进程）；判不了活时可能为 null。 */
    pid: number | null;
    readonly env: {
        readonly cudaVisibleDevices: string;
        readonly gpus: readonly RunGpuSnapshot[];
    };
    readonly seed: number;
    readonly inputs: ReadonlyArray<{
        readonly datasetId: string;
        readonly version: string;
        readonly sha256: string | null;
        readonly locator: string;
    }>;
    outputs: {
        readonly metrics: {
            readonly path: string;
            readonly sha256: string | null;
            readonly schemaOk: boolean;
        } | null;
        readonly artifacts: ReadonlyArray<{
            readonly path: string;
            readonly sha256: string;
            readonly bytes: number;
        }>;
    };
    log: {
        stdoutBytes: number;
        lastReadAt: string | null;
        staleCount: number;
    };
    cancel: {
        requestedAt: string | null;
        reason: string | null;
    };
    readonly timestamps: {
        readonly createdAt: string;
        readonly submittedAt: string | null;
        readonly endedAt: string | null;
        lastPolledAt: string | null;
    };
    lastError: string | null;
}
/** run.json 宽松校验（坏文件 → INVALID，绝不静默重建——数据只增不删）。 */
export declare function validateRunRecord(value: unknown): string[];
export interface GpuInfo {
    readonly index: number;
    readonly name: string;
    readonly driver?: string;
    readonly memoryTotalMiB: number;
    readonly memoryUsedMiB: number;
    readonly utilPct?: number;
    readonly computeCap?: string;
}
export interface EnvSnapshot {
    readonly os: string;
    readonly kernel: string;
    readonly arch: string;
    readonly cpuCount: number | null;
    readonly memTotalMiB: number | null;
    readonly gpus: readonly GpuInfo[];
    readonly nvidiaSmiPath: string | null;
    readonly nvcc: {
        readonly path: string;
        readonly version: string;
    } | null;
    readonly python3: {
        readonly path: string;
        readonly version: string;
    } | null;
    readonly node: string | null;
    readonly tools: Readonly<Record<string, boolean>>;
    readonly disk: {
        readonly path: string;
        readonly totalKiB: number;
        readonly availKiB: number;
    } | null;
    readonly probedAt: string;
}
