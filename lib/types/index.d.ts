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
/** M0 最小注入面：RPC 通道两件套。领域模块进场后按需扩名单（storageDomain/
 * workspaceRegistry/llm/schedule/agents/…）；扩名单前先过 E1/E2 冒烟。 */
export declare const inject: readonly ["connection", "webServer"];
/** Plugin configuration (patch-row `config` values are read defensively). */
export interface Config {
    readonly rootDir?: string;
    readonly offlineMode?: boolean;
}
/** Mount the SRW host service and its RPC channel. */
export declare function apply(ctx: Context, rawConfig: Config): Promise<void>;
