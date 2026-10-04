/** 工作台视图（0102 §9.2 视图 1 的 M1 子集）：项目头（总根选择 + 引擎
 * 工作区口径核对）+ 项目列表（新建/打开）+ 阶段流水线（只读）+ 诊断折叠卡。
 * 轮询只打 `overview`（5s，页面隐藏时暂停）；项目数据经 `root.get`。
 */
import type { ClientContext } from './protocol-client.ts';
export declare function WorkbenchView({ ctx }: {
    readonly ctx: ClientContext;
}): React.ReactElement;
