/** Client 入口：侧边栏菜单项（`sidebar.panellist`）+ 独立主面板（`main`
 * keyed 槽）。M0 面板 = 诊断视图：能力探测表 + panelInfo 快照 + E1 探测
 * 按钮（Task 0.4/0.6 的载体）。bundle 经 window.__ModuleLoader__.load
 * 装载（CJS 模块表契约）。
 *
 * inject 名单纪律（vibe 0.2.0 实测：缺名会激活失败）：M0 只放同族已验证
 * 的 10 个服务名；sidebarRight/documentPreviews/settings 等候选面**不进**
 * 名单，诊断面软探测并如实报告「未注入」——E1 结论后才扩名单。
 */
import type { ClientContext } from './protocol-client.ts';
export declare const name = "dsh-kylin-srw";
export declare const inject: readonly ["slots", "connection", "locale", "sessions", "uiWorkspace", "workspaces", "remote", "remote.session", "modelDirectories", "layout"];
export declare function apply(ctx: ClientContext): void;
