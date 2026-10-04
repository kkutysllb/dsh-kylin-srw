/** `srw_project` agent 工具（0202 Task 1.7）：根 Agent 作用域挂载的项目
 * 管理面（照 automation mountTools 形状）。
 *
 * 审批契约（dsh 0.1.7 同款，见 automation approvalDecision）：`reason` 是
 * 随审批请求入库的审计文本（不随读者语言变化），`displayReason` 是审批卡
 * 渲染的本地化文案。create/remove 需人工审批；list/open 豁免。
 */
import { type SrwService } from './service.ts';
import type { ProjectMeta } from './core/schema.ts';
import type { LitCandidate } from './literature/types.ts';
export declare const SRW_TOOL_NAME = "srw_project";
export declare const SRW_LIT_TOOL_NAME = "srw_literature";
/** 需要人工审批的动作（list/open/lib/search/bibtex 豁免）。 */
export declare const SRW_ASK_ACTIONS: ReadonlySet<string>;
export declare const SRW_LIT_ASK_ACTIONS: ReadonlySet<string>;
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
/** 纯函数审批判定（单测面）：非本插件工具 / 未挂载 / 非敏感动作 → undefined。 */
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
/** search 动作的输出投影（纯函数，无损 JSON 单测面）。
 * 无损 JSON 纪律：宿主对工具结果校验 lossless 往返——可选字段显式写
 * `key: undefined` 会被 JSON.stringify 丢键、值因此非无损（2026-10-04
 * 桌面端实测踩中：arXiv 源从不设 oaUrl → search 100% 失败）。可选字段
 * 一律条件展开。 */
export declare function searchOutputFor(items: readonly LitCandidate[]): {
    readonly count: number;
    readonly hint: string;
    readonly items: readonly unknown[];
};
/** `srw_literature` 四动作工具定义（search/lib 豁免；import/pdf 需 ask）。 */
export declare function srwLiteratureToolDef(service: SrwService): SrwToolDef;
