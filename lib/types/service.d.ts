/** SRW Host 服务（M0 骨架）：承载 patch-row 配置、能力探测与生命周期。
 *
 * M1 起按 0102 §4 的领域模块（workspace/literature/watch/reading/writer/
 * venue/materials/verify/compute）逐步长出；本类只做装配根，不装领域逻辑。
 * 服务经 `ctx.reflect.provide('srw', …)` 暴露（ADR-19）：别的插件将来可以
 * inject——不做 dsh-kylin-automation 那样的「拿不到的服务」。
 */
import { type CapRow } from './diag.ts';
import { WorkspaceStore } from './workspace/project.ts';
import { type SrwIndexGlobal } from './store.ts';
import { type LiteratureService } from './literature/service.ts';
import { type WatchManager } from './watch/binding.ts';
/** 与 package.json 同步维护；diag.caps 的 info.version 数据源。 */
export declare const SRW_VERSION = "0.0.1";
export interface SrwConfig {
    /** 科研总根；空 = 首次由面板引导选择（M1）。 */
    readonly rootDir?: string;
    /** 离线模式：停用一切外联动作。 */
    readonly offlineMode?: boolean;
}
export declare class ServiceError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface SrwInfo {
    readonly version: string;
    readonly offlineMode: boolean;
    readonly rootDir: string;
    readonly home: {
        readonly channel: string;
        readonly home: string;
    };
}
export declare class SrwService {
    /** 宿主 ctx（软探测只读使用；领域模块不得经它绕过本服务）。 */
    readonly ctx: unknown;
    readonly config: SrwConfig;
    private readonly startedAt;
    /** 项目 CRUD（目录即真相源）。 */
    readonly workspace: WorkspaceStore;
    /** storage 全局里的总根（Task 1.4 srw_index 写入；config 缺省时的回落源）。 */
    private storageRootDir;
    /** 活动项目的内存镜像（index 缺席的降级态下进程内仍然生效）。 */
    private activeProjectMem;
    /** srw_index 域 handle（storageDomain 不可达时保持 undefined，功能降级：
    * rootDir 仅来自 patch config、activeProject 不持久——见 open 的降级注释）。 */
    private index;
    private constructor();
    private literatureRef;
    /** 文献通路（M2：检索/入库/PDF/BibTeX）。惰性装配（getter 自引用安全）。 */
    get literature(): LiteratureService;
    private watchRef;
    /** 订阅抓取（M3：触发绑内置自动化任务 ctx.schedule，执行是本插件 host 代码）。 */
    get watch(): WatchManager;
    static open(ctx: unknown, rawConfig: SrwConfig): Promise<SrwService>;
    /** 挂上域 handle 并把持久 rootDir 收编进内存判定（config 仍优先）。 */
    private attachIndex;
    /** 当前科研总根（未设置 = undefined）。单源判定：config 优先，storage 全局回落。 */
    currentRoot(): string | undefined;
    /** Task 1.4：root.set 落定后的总根更新入口（进程内生效；持久化在 srw_index）。 */
    adoptRoot(rootDir: string): void;
    /** srw_index 全局快照（index 缺席时以内存判定兜底）。 */
    indexGlobal(): SrwIndexGlobal;
    /** root.set：路径自检（resolve→contains 自含 + 可写性经 root.json 落盘证明）
    * → root.json（根内配置）→ srw_index 全局（「哪个根」的持久记忆）→ 内存收编。 */
    setRoot(path: string): Promise<SrwIndexGlobal>;
    /** project.open：元数据 + activeProject 持久 + project_cache 投影。 */
    openProject(slug: string): Promise<unknown>;
    /** 当前活动项目的 stage（轻投影：只读 project_cache，不扫盘）。 */
    activeStage(): string | undefined;
    /** overview（≤200ms 轻投影，5s 轮询面）。 */
    overview(): Promise<{
        rootDir: string;
        projectCount: number;
        activeProject: string;
        activeStage?: string;
        capsOk: number;
        capsTotal: number;
        version: string;
        offlineMode: boolean;
        watchSummary?: {
            total: number;
            enabled: number;
            lastFresh?: number;
            lastError?: string;
        };
    }>;
    /** 面板建订阅时的默认绑定会话：最新根 agent 的会话（拿不到则不绑）。 */
    newestRootSessionId(): string | undefined;
    /** 轻量探活（`diag.ping` 端点）。 */
    ping(): {
        readonly pong: true;
        readonly at: string;
        readonly uptimeMs: number;
    };
    info(version: string): SrwInfo;
    /** 宿主能力表（`diag.caps` 端点；E1/E2 与 V 系列核对的数据源）。 */
    caps(): readonly CapRow[];
    /** `diag.contains`（Task 1.2 / V4 实测端点）：宿主 fs 的 resolve→contains
     * 真值测量。**这是诊断不是护栏**——越界返回 contained:false 而非抛错；
     * 正式放行必须走 assertInsideRoot（fail-closed）。 */
    diagContains(rootAbs: string, targetRel: string): Promise<{
        contained: boolean;
        detail?: string;
    }>;
    /** 宿主 schedule 服务面（E3 边界试验专用；经 ctx.get 动态取，不进 inject
     * 名单——避免缺名导致激活失败）。M3 正式接入时再按 ADR-8 定稿。 */
    private schedule;
    /** E3-A/B：创建提醒（恰一个 selector）。 */
    scheduleCreate(input: {
        readonly sessionId: string;
        readonly title: string;
        readonly prompt: string;
        readonly afterSeconds?: number;
        readonly everySeconds?: number;
    }): Promise<unknown>;
    /** E3：列出某会话的 active 任务。 */
    scheduleList(sessionId: string): Promise<unknown>;
    /** E3：删除任务。 */
    scheduleDelete(sessionId: string, id: string): Promise<unknown>;
    /** E3-C：读 schedule 存储落点（宿主 home 下 storages/schedule.json）。 */
    scheduleStoragePath(): string;
    dispose(): Promise<void>;
}
