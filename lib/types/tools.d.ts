/** `srw_project` agent 工具（0202 Task 1.7）：根 Agent 作用域挂载的项目
 * 管理面（照 automation mountTools 形状）。
 *
 * 审批契约（dsh 0.1.7 同款，见 automation approvalDecision）：`reason` 是
 * 随审批请求入库的审计文本（不随读者语言变化），`displayReason` 是审批卡
 * 渲染的本地化文案。create/remove 需人工审批；list/open 豁免。
 */
import { type SrwService } from './service.ts';
import type { ProjectMeta } from './core/schema.ts';
export declare const SRW_TOOL_NAME = "srw_project";
/** 需要人工审批的动作（list/open 豁免）。 */
export declare const SRW_ASK_ACTIONS: ReadonlySet<string>;
/** 调用者身份（照 automation callerFrom：从 pre-execute/execute 的 exec 提取）。 */
export interface ToolCaller {
    readonly cwd?: string | undefined;
    readonly sessionId?: string | undefined;
}
export declare function callerFrom(exec: unknown): ToolCaller;
export interface ApprovalAsk {
    readonly reason: string;
    readonly displayReason: {
        readonly en: string;
        readonly zh: string;
    };
}
/** 纯函数审批判定（单测面）：非本工具 / 未挂载 / 非敏感动作 → undefined。 */
export declare function approvalDecision(exec: {
    readonly name: string;
    readonly arguments?: unknown;
}, mountedAgent: boolean): ({
    readonly kind: 'ask';
} & ApprovalAsk) | undefined;
/** 项目单行摘要（模型面向，有界）。 */
export declare function projectSummary(meta: ProjectMeta): string;
export interface SrwToolDef {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly output: {
        readonly schema: Record<string, unknown>;
        render(args: unknown, value: unknown): readonly {
            readonly type: 'text';
            readonly text: string;
        }[];
    };
    readonly timeoutMs: number;
    execute(args: unknown, exec: unknown): Promise<unknown>;
}
/** `srw_project` 单工具四动作定义。 */
export declare function srwProjectToolDef(service: SrwService): SrwToolDef;
