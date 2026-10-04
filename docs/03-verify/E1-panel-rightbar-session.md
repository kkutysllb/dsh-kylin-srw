# E1 · 主区面板 × 右栏 × 会话（阶段记录）

- 日期：2026-10-04
- 环境：QiLin 3.0.10 web profile（`--port 3091`，accounts 门关闭的验证实例）、`dsh-kylin-srw@0.0.1`（link:）
- 状态：**第 1、8 项已定论（面板激活与 RPC 通路）**；右栏三项与设置页待用户点按钮补录
- 证据：用户本人操作截图（2026-10-04 18:04–18:05）

## 已定论

| # | 项（0201 Task 0.6 Step 2 编号） | 期望（0102 源码结论） | 实测 |
|---|---|---|---|
| 1 | 面板激活时 `layout.panelInfo.activePanelId` | `'srw'`（非 null） | ✅ `{"activePanelId":"srw"}`（两次点按一致） |
| 8 | RPC 通道往返（宿主服务可达性） | `webServer.register` 直连路径可用 | ✅ `diag.caps OK（27 行）`，`connection`/`webServer`/`reflect` 绿 |
| — | 客户端 10 服务注入 | vibe 同款名单有效 | ✅ 10/10 可用（`slots/connection/locale/sessions/uiWorkspace/workspaces/remote/remote.session/modelDirectories/layout`） |
| — | 未注入服务的访问形态 | （源码未明说） | ✅ 实测**抛错** `cannot get property "X" without inject` → 详录 [E2](E2-qilin-external-bundle.md) 新事实 1 |

**判定**：0102 ADR-10 的前提成立——主区 keyed 面板激活后 `activePanelId !== null`，按源码推论此时右栏绑定会解绑（`show(undefined)`）。主区方案可用，面板盒模型、样式、滚动在实机上表现正常（截图）。

## 待实测（面板按钮即载体，逐条点完即收口）

| # | 操作 | 期望 |
|---|---|---|
| 2 | 点「试开文档查看器」 | 抛 `sidebarRight: no session surface is mounted`（响亮失败）——当前显示「未注入」是因 inject 名单未含 `sidebarRight`，**E1 收口时需临时把 `sidebarRight` 加进 `src/client/index.ts` inject 名单复测** |
| 3 | 点「试延迟打开」（填 sessionId） | 不抛但只写不画；回对话页 tab 出现 |
| 4 | 主栏切回对话，右栏是否恢复 | 恢复 |
| 5 | `documentPreviews.register` 后回对话页可见 | 同上 |
| 6 | 「送草稿到会话」（填 sessionId） | setDraft+submit 落正确会话；两条路径（retain+binding / retainAgentScope+scope）哪条可用 |
| 7 | 未 retain 直接 `for(actx)` 的错误文案 | `requires a retained Session scope` |
| 9 | 盒模型：窄窗口下 `height:100% + overflow-y` 是否自滚 | 自滚（截图初判正常，待窄窗口确认） |
| 10 | `settings.section` 主区被占时能否打开（portal 模态） | 能 |

## 已发现的产品侧待办（不阻塞，回 M1/M0 收口处理）

1. **hostHome 通道误判**：诊断面板显示「通道 dsh · home ~/.qilin」——麒麟启动器恒设 `DSH_HOME`（E2 新事实 2）→ ADR-20 回改：`hostHome()` 改正向信号判定（仅 `QILIN_HOME` 显式存在判 qilin，否则 unknown），M1 修。
2. 「送草稿跳过：需要 sessionId 与 sessions 服务」是**正常守卫**（无会话时 `sessions.list.current` 为空）；补录第 6 项时先在引擎里开一个会话再填 id。
3. M0 诊断面板后续扩展：把「E1 待实测三项」需要的服务（`sidebarRight`/`documentPreviews`/`settings`）以**临时分支**注入（验证专用 build 或开关），避免为验证污染正式 inject 名单——E1 收口时定做法。

## 归档

- 截图（4 张）：会话内 `~/.zcode/cli/image-cache/sess_4f68e182-…/image-*.png`（2026-10-04）；要点已摘录进本文件表内。
- 相关：[E2-qilin-external-bundle.md](E2-qilin-external-bundle.md)（装载、记账、注入名单、CLI 勘误）。
