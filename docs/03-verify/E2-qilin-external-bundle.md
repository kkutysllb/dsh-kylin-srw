# E2 · 麒麟通道装载外部自建 bundle（阶段结论）

- 日期：2026-10-04
- 环境：QiLin 3.0.10 源码仓（`~/kk_Projects/QiLin`）、web profile、`--port 3091`、本机 macOS
- 插件：`dsh-kylin-srw@0.0.1`（`link:` 本地安装，产物由 `pnpm build` 产出）
- 状态：**主判据已定论（装载成功，RISK-2 大幅降级）**；HMR/缺名/DSH 侧矩阵待补
- 验证人：用户本人（截图证据）+ 会话内核对

## 结论速览

| 判据 | 结果 |
|---|---|
| 外部自建 client bundle 能否挂载 | ✅ **能**。`window.__ModuleLoader__.load` 协议被麒麟 web 通道接受，面板成功渲染（见 E1 截图） |
| `link:` 是否自动记账 | ✅ **自动**。`~/.qilin/profiles/web/package.json` 的 `dependencies` 记 `link:` 路径，且 `qilin.profile.bundles` 出现 `dsh-kylin-srw`，`node_modules/dsh-kylin-srw` 建符号链接——0201 Task 0.5 的「手改兜底」担忧解除 |
| `client.inject` 服务名名单是否生效 | ✅ vibe 同款 10 服务名全部注入成功：`slots / connection / locale / sessions / uiWorkspace / workspaces / remote / remote.session / modelDirectories / layout`（诊断面板客户端服务面 10/10 绿） |
| 宿主启动是否拒绝/报错 | ✅ 无。插件出现在 loader 依赖图（首次启动因端口占用级联等待 `connection, webServer`，换端口后无任何失败行） |

## 新宿主事实（0102 待回改）

1. **未注入的服务访问 = 直接抛错**，不是静默 `undefined`：
   `Error: cannot get property "X" without inject`（host 侧与 client 侧同语义）。
   - 后果 A：`collectCaps` / 客户端 `safeGet` 的 try/catch 是**必要**的（已验证生效，缺席项如实显示）。
   - 后果 B：**inject 名单就是硬边界**——M1 起每个领域模块要用的服务必须显式进名单（storageDomain/workspaceRegistry/fs/llm/schedule/agents/settings/…），这份清单与 0102 §5.3 兼容矩阵一致。
   - 后果 C：0102 §5.1「client.inject 写错名字在 QiLin 侧是静默忽略」需要区分两个层面：**bundle 名单**（package.json `client.inject`，静默忽略）与**服务名名单**（`src/client/index.ts` 的 `export const inject`，缺名=激活失败（vibe 0.2.0 实测），注入后访问未注入项=抛错）。
2. **麒麟启动器把 `DSH_HOME` 钉到 QiLin home**（`packages/boot/app-boot/src/index.ts:263`，`DSH_HOME_COMPAT_NAME = 'DSH_HOME'`，dsh-compat 兼容层）：
   - 实测表现：诊断面板显示「通道 **dsh** · home /Users/libing/.qilin」——`hostHome()` 的 env 判定在麒麟进程里被误导。
   - 回改方向（ADR-20）：env 存在性不能区分通道（麒麟进程恒有 `DSH_HOME`）；需正向信号（如 `QILIN_HOME` 显式存在才判 qilin，否则显示 unknown）或改用宿主身份服务。M0 仅影响诊断显示（真实存储 home 由 `storageDomain` 决定），M1 修。
3. **CLI/通道勘误**（0201 Task 0.5 待回改）：
   - `p0vibe` 是 **headless** profile（`qilin --profile p0vibe` 回答单任务即退出），**web 端用 `web` profile**（`qilin web`）。
   - `--port`/`--no-open` 是 web **应用**参数，需放 `--` 之后：`qilin web --no-open --port 3091` 可用，但混用 launcher 参数时写 `qilin --profile web --patch <yml> -- --no-open --port 3091`。
   - `--patch` 是 **launcher** 参数（`--patch <yml>` 叠加 patch 层），web 应用自身不认。
   - 验证实例关闭账号门的 overlay：`- id: accounts / config: { enabled: false }`（与 `apps/cli/tests/web-auth.e2e.ts` 的做法一致）；打印 URL 的 `token` 只做**设备信任交换**（303 + 设备 cookie），账号门开着时仍需登录。
4. **desktop profile 由 Electron 应用独占管理**（DSH 侧）：`dsh plugin --profile desktop add …` 被拒 `profile "desktop" is managed exclusively by the Electron application` → 手改 `~/.dsh/profiles/desktop/package.json` 记 `link:` 依赖（已备份 `.bak-srw-*`；该 profile 本有 `dsh-skills-stock` 的 link 先例）。**待用户完全重启桌面端验证装载**。

## 待补（不阻塞 M1 开工）

1. 故意删一个 `client.inject` bundle 名/服务名的失败形态（响亮 vs 静默）；
2. client 产物热换边界（500ms stat 轮询）与 host 变更需重启的实测确认；
3. DSH 通道同矩阵（桌面端重启后跑同一诊断面板截图归档）；
4. `~/.dsh` 侧 DSH_HOME/QILIN_HOME 环境形态（为 hostHome 修复取证）。

## RISK-2 裁定建议

**高 → 低**：麒麟通道对外部自建 bundle 的装载、`link:` 记账、服务注入全部实证通过。残余风险只剩「DSH 通道桌面端」与「缺名失败形态」两项低危确认。
