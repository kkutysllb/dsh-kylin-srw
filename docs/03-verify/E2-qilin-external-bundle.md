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
4. **desktop profile 由 Electron 应用独占管理**（DSH 侧）：
   - `dsh plugin --profile desktop …` 一律被拒（`add`/`install`/连 `--help` 都拒；首启报错文案建议的 `dsh plugin --profile desktop install` **实际跑不了**——文案与权限矛盾，勿信）。
   - 首次只手改 package.json 的结果是启动后插件标**异常**：`cannot resolve profile bundle "dsh-kylin-srw" from the dsh installation or ~/.dsh/profiles/desktop`（用户桌面端实测截图，2026-10-04）。
   - **正确手改三件套**（缺一不可，照 `dsh-skills-stock` 先例，全部先备份 `.bak-srw-*`）：
     ① `package.json` → `dependencies` 记 `"dsh-kylin-srw": "link:<abs>"`；
     ② `pnpm-lock.yaml` → `importers..dependencies` 插条目（`specifier` = 绝对 link，`version` = `link:../../../kk_Projects/dsh-kylin-srw` 相对形态）；
     ③ `node_modules/dsh-kylin-srw` → 符号链接 `../../../../kk_Projects/dsh-kylin-srw`。
   - 三件套已于 2026-10-04 18:11 补齐；**18:13 用户重启桌面端复验 ✅ 通过**（见下「DSH 通道矩阵」）。
   - `dev-install.mjs` 的 fallback 已固化为该三件套。

## DSH 通道矩阵（2026-10-04 18:12–18:13，桌面端，✅ 全部通过）

| 判据 | 结果 |
|---|---|
| 三件套手改记账后装载 | ✅ 插件正常（异常消除），面板渲染成功 |
| `client.inject` 5 个 bundle 名单 | ✅ 生效（10 个客户端服务全部注入可用） |
| RPC `/dsh-kylin-srw` 往返 | ✅ `diag.caps OK（27 行）`；`connection`/`webServer`/`reflect` 绿 |
| 主区 keyed 面板 | ✅ `panelInfo = {"activePanelId":"srw"}`（与麒麟侧一致） |
| 未注入服务形态 | ✅ 同麒麟：抛错 `cannot get property "X" without inject` |

**E2 裁定：全部主判据双通道通过，RISK-2 关闭。** 剩余待补仅：故意删名的失败形态、HMR 热换边界（低危，可并入 M1 日常）。

补充（hostHome 已修）：DSH 桌面端进程 `QILIN_HOME`/`DSH_HOME` **都不设** → 旧兜底硬编 `~/.qilin` 造成显示误导（「home ~/.qilin」出现在 DSH 端）。已改为 unknown 时不猜（home 显示「未判定」）；麒麟 compat pin 导致的通道误显示（麒麟侧显示 'dsh'）为已知限制，M1 换正向信号。

## 待补（不阻塞 M1 开工）

1. 故意删一个 `client.inject` bundle 名/服务名的失败形态（响亮 vs 静默）；
2. client 产物热换边界（500ms stat 轮询）与 host 变更需重启的实测确认；
3. ~~DSH 通道同矩阵~~ ✅ 已完成（见上「DSH 通道矩阵」）；
4. ~~`~/.dsh` 侧 DSH_HOME/QILIN_HOME 环境形态~~ ✅ 已实测：**两个 env 都不设**（hostHome unknown 分支即此形态；兜底显示误导已修）。

## RISK-2 裁定

**高 → 关闭**：麒麟 web 与 DSH 桌面端两通道对外部自建 bundle 的装载、记账（link: 自动 / 三件套手改）、服务注入全部实证通过。残余仅「缺名失败形态」「HMR 边界」两项低危观察项，并入 M1 日常。
