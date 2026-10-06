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
export declare const SRW_WATCH_TOOL_NAME = "srw_watch";
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
/** 订阅单行摘要（模型面向，有界；可选字段条件展开守无损）。 */
export declare function watchSummaryFor(sub: {
    id: string;
    project: string;
    source: string;
    query: string;
    everySeconds: number;
    enabled: boolean;
    boundSessionId?: string;
    scheduleId?: string;
    lastRunAt?: string;
    lastResult?: {
        at: string;
        kind: string;
        fresh?: number;
        error?: string;
    };
}): Record<string, unknown>;
/** `srw_watch` 工具：订阅抓取管理。list/run/pause/resume 豁免（run 的授权
 * 发生在 create 审批时——时钟唤醒轮必须免问）；create/remove ask。 */
export declare function srwWatchToolDef(service: SrwService): SrwToolDef;
export declare function srwLiteratureToolDef(service: SrwService): SrwToolDef;
/** `srw_paper` 工具：论文线执行面（M5）。全部动作豁免审批——写的是项目域内
 * paper/ 与 .srw/{venue,outline}.json；大纲/正文内容由会话里的 Agent 自己
 * 起草（agent 车道：工具只做 IO + 门），G1 确认门在服务层硬编码——未确认
 * 的大纲 section.write 直接拒绝。编译是本机进程（TeX 引擎全缺时报
 * ENGINE_MISSING + 安装引导，不算工具失败）。 */
export declare const SRW_PAPER_TOOL_NAME = "srw_paper";
export declare function srwPaperToolDef(service: SrwService): SrwToolDef;
/** `srw_read` 工具：精读执行面（0205 附记 / 引擎车道）。全部动作豁免——
 * 写的是项目域内派生产物（reading/ 与 readings/），授权来自会话里的显式
 * 意图（面板「翻译」按钮的提示词或用户直接指令）；翻译烧宿主默认模型
 * token，工具描述把分批协议写成硬纪律（每批 ≤40 块 + 逐批汇报）。 */
export declare const SRW_READ_TOOL_NAME = "srw_read";
export declare function srwReadToolDef(service: SrwService): SrwToolDef;
