/** Client 入口：侧边栏菜单项（`sidebar.panellist`）+ 独立主面板（`main`
 * keyed 槽）+ E1 验证用的 `settings.section` 区块。M0 面板 = 诊断视图。
 * bundle 经 window.__ModuleLoader__.load 装载（CJS 模块表契约）。
 *
 * inject 名单纪律（vibe 0.2.0 实测：缺名会激活失败）：前 10 个是同族已验证
 * 名单；后 4 个是 **E1 专用临时注入**（2026-10-04）——主区被占时右栏/预览/
 * 会话输入的真实行为必须注入才能逐项实测，E1 收口后按结论保留或撤。
 */
import type { ClientContext } from './protocol-client.ts';
export declare const name = "dsh-kylin-srw";
export declare const inject: readonly ["slots", "connection", "locale", "sessions", "uiWorkspace", "workspaces", "remote", "remote.session", "modelDirectories", "layout", "sidebarRight", "documentPreviews", "uiSession", "conversation"];
export declare function apply(ctx: ClientContext): void;
