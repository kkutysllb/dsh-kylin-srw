/** M0 诊断视图：宿主能力表（RPC `diag.caps`）+ 客户端服务表 + panelInfo
 * 快照 + E1 探测按钮。所有探测结果进滚动日志，作为 E1/E2 记录的原始证据。
 * 每个按钮都是「期望先写好」的实验步骤（见 0201 Task 0.6），失败/缺席
 * 都是有效数据，绝不静默。
 *
 * E1 专用注入（sidebarRight/documentPreviews/uiSession/conversation）生效后，
 * 按钮发的是 QiLin 源码核对过的真实调用：
 * - `openResource(address)` / `openResourceIn(sessionId, address)`（ui-sidebar-right service.ts:210/347）
 * - `documentPreviews.register({id, extensions, title, loading})`（registry.ts:9-27）
 * - `conversation.input.for(binding.ctx).setDraft/submit`（0102 §9.3 路径 A）
 * - `uiSession.adapter.current.getSnapshot().key`（ui-session index.ts:299）
 */
import type { ClientContext } from './protocol-client.ts';
export declare function DiagView({ ctx, embedded }: {
    readonly ctx: ClientContext;
    readonly embedded?: boolean;
}): React.ReactElement;
