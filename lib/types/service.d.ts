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
    dispose(): Promise<void>;
}
