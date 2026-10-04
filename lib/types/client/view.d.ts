/** M0 诊断视图：宿主能力表（RPC `diag.caps`）+ 客户端服务表 + panelInfo
 * 快照 + E1 探测按钮。所有探测结果进滚动日志，作为 E1/E2 记录的原始证据。
 * 每个按钮都是「期望先写好」的实验步骤（见 0201 Task 0.6），失败/缺席
 * 都是有效数据，绝不静默。
 */
import type { ClientContext } from './protocol-client.ts';
export declare function DiagView({ ctx }: {
    readonly ctx: ClientContext;
}): React.ReactElement;
