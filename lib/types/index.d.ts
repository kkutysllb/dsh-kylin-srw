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
/** M0 注入面：RPC 通道两件套。领域模块进场后按需扩名单——**每个名字都必须
 * 是「目标宿主编排保证存在」的服务**：E3 实测 inject 一个 profile 未挂载的
 * 服务（schedule in web profile）会让插件永久 pending（面板不出现）；
 * ctx.get 同样被栅栏拦。M3 接入 schedule 时必须带能力探测降级。 */
export declare const inject: readonly ["connection", "webServer"];
/** Plugin configuration (patch-row `config` values are read defensively). */
export interface Config {
    readonly rootDir?: string;
    readonly offlineMode?: boolean;
}
/** Mount the SRW host service and its RPC channel. */
export declare function apply(ctx: Context, rawConfig: Config): Promise<void>;
