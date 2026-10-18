/** ComputeService（M7 实验与算力 MVP，analysis/goals/04 §4–§8）：唯一编排入口。
 * 单主机、无 UI、无多机调度；三级链实现 ① ControlMaster 复用与 ③ 直连
 * （② tool 通道留接口注释不实现）。provider 可注入（测试全用 fake，绝不真连）。
 *
 * 纪律落地：hosts.json 只读；地址/用户名/端口绝不落盘（run.json 只存
 * hostRef+label，remote.runDir 是波浪号形式，展开用的 $HOME 只在内存）；
 * 每个输出面过 redactJson；7 态生命周期 unknown 绝不假成功；日志偏移续读 +
 * 上限显式失败；取消 kill -TERM -<pid> → 宽限 → -KILL，不可达 → interrupted；
 * spec 门复用 venue/depth D 档；错误码 INVALID/NOT_FOUND/NO_PROVIDER/GATE。
 * 永不读取宿主凭据（本目录 0 命中，tests 断言）。 */
import { type SrwFsLike } from '../host.ts';
import type { ComputeProvider } from './provider.ts';
import { type ExperimentSpec } from './spec.ts';
import { type EnvSnapshot } from './types.ts';
export interface ComputeDeps {
    /** 宿主 fs（路径护栏；缺席 fail-closed，照 patent/materials 模式）。 */
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: () => string | undefined;
    /** provider 注入点：缺省真实 SshProvider（①cm/③direct）；测试注入 fake。 */
    readonly provider?: ComputeProvider;
    /** home 候选 env（缺省 process.env；测试注入隔离）。 */
    readonly env?: Record<string, string | undefined>;
    readonly offline?: () => boolean;
    readonly now?: () => string;
    readonly staleThreshold?: number;
    readonly killGraceMs?: number;
    readonly cancelStepMs?: number;
    /** probe 超时（默认 15s）。 */
    readonly probeTimeoutMs?: number;
}
export interface SubmitInput {
    readonly expId: string;
    readonly spec?: unknown;
    readonly files?: readonly unknown[];
    readonly hostRef?: string;
    readonly seed?: number;
    readonly confirm?: boolean;
    /** 显式接受 D 档缺口（D_TIER_GAP ack；spec.revisions 留痕）。 */
    readonly ack?: boolean;
    readonly runId?: string;
}
export interface HostRowView {
    readonly ref: string;
    readonly label: string;
    readonly auth: 'key' | 'password';
    readonly transport: 'cm' | 'direct' | null;
    readonly usable: boolean;
    readonly reachable: boolean;
    readonly latencyMs: number | null;
    readonly detail: string;
    readonly env?: {
        readonly os: string;
        readonly kernel: string;
        readonly arch: string;
        readonly cpuCount: number | null;
        readonly memTotalMiB: number | null;
        readonly gpuCount: number;
        readonly gpus: readonly EnvSnapshot['gpus'][number][];
        readonly nvcc: EnvSnapshot['nvcc'];
        readonly python3: EnvSnapshot['python3'];
        readonly node: string | null;
        readonly tools: Readonly<Record<string, boolean>>;
        readonly disk: EnvSnapshot['disk'];
    };
}
export declare class ComputeService {
    private readonly deps;
    private readonly provider;
    private readonly registry;
    private readonly claims;
    /** ref → HostTarget（含地址/私钥路径；内存 only，绝不落盘）。 */
    private readonly book;
    /** ref → 远端 $HOME（内存 only；run.json 只存波浪号路径）。 */
    private readonly homes;
    constructor(deps: ComputeDeps);
    private nowIso;
    private requireRoot;
    private projectDir;
    private expDir;
    private runDir;
    private guard;
    private assertProjectExists;
    private readJsonAt;
    /** 落盘统一走 redactJson（防脏数据进盘——纪律兜底）。 */
    private writeJsonAt;
    private specPath;
    loadSpec(project: string, expId: string): Promise<ExperimentSpec>;
    private saveSpec;
    private runJsonPath;
    private loadRun;
    private saveRun;
    private listRunIds;
    private targetFor;
    private discoverResolved;
    /** ① 复用/③ 直连的远端 $HOME（内存 only；波浪号展开用）。 */
    private remoteHome;
    private expandRunDirAbs;
    /** hosts：盘点主机（probe + 可选 env 盘点）。输出已脱敏（无 IP/user@/port）。 */
    hosts(project: string, options?: {
        env?: boolean;
    }): Promise<{
        homes: number;
        count: number;
        hosts: HostRowView[];
    }>;
    /** submit：spec 门（confirm/ack）→ 主机/环境 → GPU 选卡 → 上传脚本 →
     * setsid 派发 → run.json（数据只增不删）。 */
    submit(project: string, input: SubmitInput): Promise<Record<string, unknown>>;
    /** status：轮询 + reconcile（7 态；unknown 绝不假成功）。 */
    status(project: string, expId: string, runId?: string): Promise<Record<string, unknown>>;
    /** 单 run reconcile：探测 → 分类 → 写回（含 endedAt/lastError/staleCount）。 */
    private reconcileRun;
    /** 进程重启后 book 清空：从 hosts.json 重建通道（找不到 → undefined）。 */
    private rebuildTarget;
    /** run 视图（模型/面板面向，有界脱敏）。 */
    private runView;
    /** logs：偏移续读 + 本地镜像 + 上限显式失败（LOG_CAP_EXCEEDED → run failed）。 */
    logs(project: string, expId: string, runId: string): Promise<Record<string, unknown>>;
    /** collect：metrics/artifacts 回传 + sha256 对账，写 run.outputs。 */
    collect(project: string, expId: string, runId: string): Promise<Record<string, unknown>>;
    /** cancel：kill -TERM -<pid> → 宽限 → -KILL；不可达 → interrupted（可重试）。 */
    cancel(project: string, expId: string, runId: string, reason?: string): Promise<Record<string, unknown>>;
    /** env.setup：MVP 占位（显式 INVALID，绝不半吊子自动装环境）。 */
    envSetup(): Promise<never>;
    /** claims.check：注册/更新 claim（可选）→ 从 metrics.json 重算 → 三态。 */
    claimsCheck(project: string, input: {
        expId?: string;
        claim?: unknown;
        id?: string;
    }): Promise<Record<string, unknown>>;
    /** 读某 run 的本地 metrics.json（含 run.json 记录的 sha256；缺/坏 → file:null）。 */
    private loadRunMetrics;
    /** gaps.list：缺口生成 + queue 排序（P0=阻断 claim > P1=D 档 > P2=成本/显著性）。 */
    gapsList(project: string, expId: string): Promise<Record<string, unknown>>;
    /** dataset.register：数据集注册（upsert 同 id+version）。 */
    datasetRegister(project: string, dataset: unknown): Promise<Record<string, unknown>>;
}
