/** Cordis Host plugin for the dual-channel Scientific Research Workbench
 * (科研工作台, M1).
 *
 * Owns (M1): patch-row config, capability probe service, the Web RPC channel
 * `/dsh-kylin-srw`, the srw_index storage domain, project CRUD (workspace
 * domain), the agent-scoped `srw_project` tool with ask-approval, and the
 * bundled `research-idea` runtime skill. M2+ grows the domain modules
 * (literature/watch/reading/writer/venue/materials/verify/compute) per 0102 §4.
 *
 * Deployment note (KCoder packaged harness): no `@deepseek-ai/*` runtime
 * imports — services arrive via the `inject` names, config arrives as the
 * plain patch-row object, and the service factory clamps it.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-kylin-srw";
/** M1 注入面（Task 1.0 验证矩阵定稿 + Task 1.7 四件）：存储四件套、RPC
 * 两件套、工具/技能/系统提示/根 Agent 注册表。**每个名字都必须是「目标宿主
 * 编排保证存在」的服务**：E3 实测 inject 一个 profile 未挂载的服务
 * （schedule in web profile）会让插件永久 pending；ctx.get 同样被栅栏拦。
 * Task 1.7 四名的静态证据：base 层 agent/tools/skill + web-app 层
 * system-prompt（桌面 profile 同构 base+web-app）；M3 接入 schedule 时
 * 必须带能力探测降级，且 schedule 名本身不进本名单。 */
export declare const inject: readonly ["connection", "webServer", "storageDomain", "workspaceRegistry", "settings", "fs", "agents", "tools", "skills", "systemPrompt"];
/** Plugin configuration (patch-row `config` values are read defensively). */
export interface Config {
    readonly rootDir?: string;
    readonly offlineMode?: boolean;
}
/** Mount the SRW host service, its RPC channel, the agent tool, and skills. */
export declare function apply(ctx: Context, rawConfig: Config): Promise<void>;
