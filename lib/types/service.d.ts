/** SRW Host 服务（M0 骨架）：承载 patch-row 配置、能力探测与生命周期。
 *
 * M1 起按 0102 §4 的领域模块（workspace/literature/watch/reading/writer/
 * venue/materials/verify/compute）逐步长出；本类只做装配根，不装领域逻辑。
 * 服务经 `ctx.reflect.provide('srw', …)` 暴露（ADR-19）：别的插件将来可以
 * inject——不做 dsh-kylin-automation 那样的「拿不到的服务」。
 */
import { type CapRow } from './diag.ts';
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
    private constructor();
    static open(ctx: unknown, rawConfig: SrwConfig): Promise<SrwService>;
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
