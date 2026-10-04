# E1 · 主区面板 × 右栏 × 会话（阶段记录）

- 日期：2026-10-04
- 环境：QiLin 3.0.10 web profile（`--port 3091`，accounts 门关闭的验证实例）、`dsh-kylin-srw@0.0.1`（link:）
- 状态：**第 1、8 项已定论（面板激活与 RPC 通路）**；右栏三项与设置页待用户点按钮补录
- 证据：用户本人操作截图（2026-10-04 18:04–18:05）

## 已定论

| # | 项（0201 Task 0.6 Step 2 编号） | 期望（0102 源码结论） | 实测 |
|---|---|---|---|
| 1 | 面板激活时 `layout.panelInfo.activePanelId` | `'srw'`（非 null） | ✅ **双通道复现**：麒麟 web 18:05 + DSH 桌面端 18:13 均 `{"activePanelId":"srw"}` |
| 2 | 主区被占时 `sidebarRight.openResource(address)` | **抛** `no session surface is mounted` | ✅ **18:26 文案逐字一致**：`Error: sidebarRight: no session surface is mounted`（E1 专用注入版实测） |
| 5 | 主区被占时 `documentPreviews.register` | 可注册（容器只在右栏，可见性另测） | ✅ **API 面通过**（注册成功 + 15s 自动撤销；可见性需真实文档，留 M1 与 PDF 精读一起测） |
| 8 | RPC 通道往返（宿主服务可达性） | `webServer.register` 直连路径可用 | ✅ 双通道 `diag.caps OK（27 行）`，`connection`/`webServer`/`reflect` 绿 |
| — | 客户端注入名单 | 已验证 10 + E1 临时 4 | ✅ **14/14 注入成功、激活无失败**（`sidebarRight`/`documentPreviews`/`uiSession`/`conversation` 四名全部可注入） |
| — | 未注入服务的访问形态 | （源码未明说） | ✅ 双通道一致：**抛错** `cannot get property "X" without inject` → 详录 [E2](E2-qilin-external-bundle.md) 新事实 1 |

**判定**：0102 §9.1 容器决策（ADR-10）的两个关键前提全部实证——主区 keyed 面板可用，右栏写路径在主区被占时**响亮抛错**（不是静默）。产品的落地纪律随之定稿：**右栏相关 API 调用必须 try/catch + 面板置灰说明**，绝不裸调。

## 待实测（三项，都需要一次用户操作）

| # | 操作 | 期望 |
|---|---|---|
| 3 | 填 sessionId → 「试延迟打开」→ 切回对话页 | `openResourceIn` 不抛；tab 在对话页出现 |
| 6/7 | 开会话 → 填 sessionId → 「送草稿到会话」 | 路径 A（retain+binding+conversation.input.for）落草稿到正确会话、不串台 |
| 10 | 面板占主区时从外壳打开设置页 | 能打开且看到「科研工作台（E1 验证）」区块（portal 模态） |
| §9.3 | 「uiSession 探测」→ 切会话 → 再按 | key 实时跟随 |

## 已发现的产品侧待办（不阻塞，回 M1/M0 收口处理）

1. **hostHome 通道误判**：诊断面板显示「通道 dsh · home ~/.qilin」——麒麟启动器恒设 `DSH_HOME`（E2 新事实 2）→ ADR-20 回改：`hostHome()` 改正向信号判定（仅 `QILIN_HOME` 显式存在判 qilin，否则 unknown），M1 修。
2. 「送草稿跳过：需要 sessionId 与 sessions 服务」是**正常守卫**（无会话时 `sessions.list.current` 为空）；补录第 6 项时先在引擎里开一个会话再填 id。
3. M0 诊断面板后续扩展：把「E1 待实测三项」需要的服务（`sidebarRight`/`documentPreviews`/`settings`）以**临时分支**注入（验证专用 build 或开关），避免为验证污染正式 inject 名单——E1 收口时定做法。

## 归档

- 截图（4 张）：会话内 `~/.zcode/cli/image-cache/sess_4f68e182-…/image-*.png`（2026-10-04）；要点已摘录进本文件表内。
- 相关：[E2-qilin-external-bundle.md](E2-qilin-external-bundle.md)（装载、记账、注入名单、CLI 勘误）。
