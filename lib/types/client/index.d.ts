/** Client 入口：侧边栏菜单项（`sidebar.panellist`）+ 独立主面板（`main`
 * keyed 槽）+ 设置区块（`settings.section`，M1 转正式）。M1 面板 = 工作台
 * 视图（项目头/列表/流水线/诊断折叠），诊断视图保留为折叠卡。
 * bundle 经 window.__ModuleLoader__.load 装载（CJS 模块表契约）。
 *
 * inject 名单纪律（vibe 0.2.0 实测：缺名会激活失败）：前 10 个是同族已验证
 * 名单；后 4 个是 E1 收口后**保留**的注入（右栏/预览/会话输入/uiSession
 * —— M2+ 文献预览与会话联动都要用，行为已在 E1 逐项实测）。
 */
import type { ClientContext } from './protocol-client.ts';
export declare const name = "dsh-kylin-srw";
export declare const inject: readonly ["slots", "connection", "locale", "sessions", "uiWorkspace", "workspaces", "remote", "remote.session", "modelDirectories", "layout", "sidebarRight", "documentPreviews", "uiSession", "conversation"];
export declare function apply(ctx: ClientContext): void;
