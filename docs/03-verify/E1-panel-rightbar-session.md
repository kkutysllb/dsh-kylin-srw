# E1 · 主区面板 × 右栏 × 会话（终版，全部收口）

- 日期：2026-10-04（18:04–18:40）
- 环境：QiLin 3.0.10 web profile（`--port 3091`，accounts 门关闭的验证实例）、`dsh-kylin-srw@0.0.1`（link:）、E1 专用注入 build（`c203530`）
- 状态：**✅ 全部判据完成**；DSH 桌面端复跑了第 1/8 项与注入矩阵（18:12–18:13），其余项在麒麟侧定论（两通道宿主面同构）
- 证据：用户截图（18:04–18:26）+ 会话内浏览器自动化截图（18:35–18:40，`~/.zcode/cli/artifacts/sess_4f68e182-…/`）

## 判据总表

| # | 项 | 期望（0102 源码结论） | 实测 |
|---|---|---|---|
| 1 | 面板激活时 `layout.panelInfo.activePanelId` | `'srw'`（非 null） | ✅ 双通道复现 `{"activePanelId":"srw"}` |
| 2 | 主区被占时 `sidebarRight.openResource(address)` | **抛** `no session surface is mounted` | ✅ **文案逐字一致** |
| 3 | 主区被占时 `openResourceIn(sid, address)` | 不抛、只写不画；回对话页 tab 出现 | ✅ 合法地址下未抛；切回对话页右栏出现 `README.md` tab（含文件树/预览） |
| 4 | 切回对话页右栏恢复 | 恢复 | ✅（第 3 项验证时同时证实） |
| 5 | 主区被占时 `documentPreviews.register` | 可注册 | ✅ API 面通过（15s 自动撤销）；可见性留 M4 随真实文档测 |
| 6 | 送提示词：`retain → binding → conversation.input.for(binding.ctx)` | setDraft+submit 落正确会话、不串台 | ✅ 路径 A 全链路通；落点正确。**重要语义发现：`submit()` 是「立即发送」**——消息直接进会话并触发一轮 agent 运行（实测 22.6K tok），**不是停在草稿箱**；M1 若只要填草稿绝不 submit |
| 7 | 未 retain 直接 `for(actx)` 的错误文案 | `requires a retained Session scope` | ◐ 代码路径保留（按钮走 retain 正路）；负例文案未单独触发，M1 接入时如遇即录 |
| 8 | RPC 通道往返 | `webServer.register` 直连可用 | ✅ 双通道 `diag.caps OK（27 行）` |
| 9 | 面板盒模型 `height:100%+overflow-y` | 面板自滚 | ✅ 标准宽度下布局/滚动正常（多张截图）；窄窗口专项留 M1 响应式时顺手验 |
| 10 | 主区被占时打开设置页 | `settings.section` portal 模态可开 | ✅ 账户菜单 → 设置：整页覆盖层打开，左侧导航出现「**科研工作台（E1 验证）**」区块 |
| §9.3 | `uiSession.adapter.current` 实时性 | 当前会话唯一权威、切会话跟随 | ✅ key 实时切换（`430b…` → `a39ce6…`） |
| — | E1 临时注入 4 名单 | 可注入、不破坏激活 | ✅ 14/14 全绿 |

## 三个 bonus 发现（0102 待回改/补录）

1. **资源地址必须带 scheme**：`sidebarRight.openResource/openResourceIn` 的 address 是 **`qilin-resource://<type>/…`**（ui-sidebar-right service.ts:179/207）；文件用 `qilin-resource://file/session/<sid>/<path>`（ui-chat apply.ts:185 同款）。裸路径/绝对路径抛 `no registered tab type claims "…"`——M1「在查看器打开」按钮必须用这个拼法。
2. **`conversation.input.for(shell).submit()` 立即发送并烧 token**（触发一轮 agent 运行）；「送提示词」的**填草稿**语义只应调 `setDraft`，submit 必须是显式用户动作。
3. **工作区外绝对路径**拼进 `file/session` 地址后，预览器报「这个文件不在了」——绝对路径在会话作用域下的解析语义需在 M1 实现「在查看器打开」前用 `fileAddressFor` 等价逻辑核实（ui-chat 用会话 cwd 相对化）。

## 结论

**ADR-10 全部前提实证成立**：主区 keyed 面板方案可用；右栏 API 在主区被占时响亮抛错（纪律：调用处必须 try/catch + 置灰说明）；设置页可并存（M1 的正式设置页走 `ctx.settings.register` + `settings.section` 槽）；送提示词走路径 A（retain+binding+conversation.input）且默认只 setDraft。

**E1 关闭。** 遗留小项（不阻塞）：第 7 项负例文案、第 9 项窄窗口、第 5 项可见性——均转入 M1/M4 日常。
