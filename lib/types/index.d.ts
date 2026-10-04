/** Cordis Host plugin for the dual-channel Scientific Research Workbench
 * (科研工作台, M0 skeleton).
 *
 * Owns (M0): patch-row config, capability probe service, the Web RPC channel
 * `/dsh-kylin-srw`. M1+ grows the domain modules (workspace/literature/watch/
 * reading/writer/venue/materials/verify/compute) per 0102 §4.
 *
 * Deployment note (KCoder packaged harness): no `@deepseek-ai/*` runtime
 * imports — services arrive via the `inject` names, config arrives as the
 * plain patch-row object, and the service factory clamps it.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-kylin-srw";
/** M1 注入面（Task 1.0 验证矩阵定稿）：RPC 通道两件套 + 存储四件套。
 * **每个名字都必须是「目标宿主编排保证存在」的服务**：E3 实测 inject 一个
 * profile 未挂载的服务（schedule in web profile）会让插件永久 pending
 * （面板不出现）；ctx.get 同样被栅栏拦。M3 接入 schedule 时必须带能力
 * 探测降级，且 schedule 名本身不进本名单。 */
export declare const inject: readonly ["connection", "webServer", "storageDomain", "workspaceRegistry", "settings", "fs"];
/** Plugin configuration (patch-row `config` values are read defensively). */
export interface Config {
    readonly rootDir?: string;
    readonly offlineMode?: boolean;
}
/** Mount the SRW host service and its RPC channel. */
export declare function apply(ctx: Context, rawConfig: Config): Promise<void>;
