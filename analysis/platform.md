# dsh-kylin-srw 平台层分析：装配 / 双通道 / RPC / Tool / Workspace / Client / 构建 / 测试

- 分析对象：`/Users/libing/kk_Projects/dsh-kylin-srw`（HEAD `d21ad8d`，版本 0.0.1）
- 分析范围：`src/index.ts`、`src/host.ts`、`src/service.ts`、`src/rpc.ts`、`src/tools.ts`、`src/store.ts`、`src/diag.ts`、`src/skills.ts`、`src/workspace/{root,project}.ts`、`src/client/*`、`src/types/dsh.d.ts`、`scripts/*`、manifest/配置、`tests/{host,tools,workspace,store,schema}.test.ts`、`docs/02-plan/0201、0202`、`docs/03-verify/*`、0102 相关章节。
- 实证命令（本次实际执行，未运行 build、未启动宿主）：
  - `npx tsc --noEmit -p tsconfig.json` → exit 0；
  - `node --import tsx --test tests/*.test.ts` → **163 pass / 0 fail**（61.7s）；
  - `node scripts/smoke-plugin.mjs` → `ALL PASS`；
  - `node scripts/smoke-plugin.mjs --negatives` → 4 条负例全红；
  - 运行时探测 `SrwService.writer.state()` → 四个 TeX 引擎 probe 全 `available:false`（与下文 P0 结论相关）。
- 工作区状态：`git status` 有 2 个未提交改动（`scripts/smoke-dual-host.mjs` 的 npm cache 隔离、`tests/host.test.ts` 的 env 清理），`analysis/`、`outputs/` 未跟踪；`lib/` 97 个产物文件在仓内跟踪。

---

## 0. 结论速览（按严重度）

1. **P0 运行期功能缺口：`WriterService` 从未注入真实进程 runner**。`src/service.ts:118-123` 构造 `WriterService` 时只传 `fs/rootDir/libraryEntry`；`src/writer/service.ts:254-258,270` 都写 `this.deps.run ?? throwNoRunner`，而真实 runner `nodeRun` 定义在 `src/writer/run.ts:8` 却**全仓无任何 import**（`grep -rn nodeRun src` 只有定义）。后果：`probeEngines` 对每个引擎都抛错并被 `src/writer/engine.ts:24-33` 的 `catch` 吞成“不可用”，编译永远 `ENGINE_MISSING`，面板永远显示“本机没有 TeX 引擎”安装引导（`src/client/workbench.tsx:1289-1291`）。测试全绿是因为 `tests/writer-service.test.ts` 注入了假 runner，**没有任何测试经过 `SrwService.writer` 的真实装配**。
2. **P1 总根双源优先级自相矛盾**：`currentRoot()` 让 patch-row `config.rootDir` 优先于 storage 全局（`src/service.ts:159-164`），但面板「更换科研总根」走 `root.set` 只更新 storage 全局与内存（`src/service.ts:179-187`）。若部署时 patch `rootDir` 非空（`src/index.ts:44-47` 允许），换根会“成功返回”，随后 `overview.rootDir` 仍是旧 config 根（`src/service.ts:248`），所有领域模块也仍用旧根。
3. **P1 换根/删项目后 `activeProject` 残留**：`root.set` 用 `{ ...indexGlobal(), rootDir }` 保留旧 `activeProject`（`src/service.ts:183`）；`project.remove` 只删目录（`src/service.ts:249-250`、`src/workspace/project.ts:106-108`），不清 storage 全局与 `project_cache`。换根后活动项目可能属于旧根，面板/论文/精读随之 `NOT_FOUND`。
4. **P1 `project.remove` 无“是否项目”验证 + `root.set` 的 containment 自检是恒真式**：`setRoot` 调 `assertInsideRoot(fs, path, path)`（`src/service.ts:181`）——root 与 target 同一个路径，`contains` 必然真，只证明 resolve 可用；真正的“这个路径能干什么是安全的”没有任何判定。`WorkspaceStore.remove` 直接 `rm(dir, {recursive:true})`，不校验 `.srw/project.json`（`src/workspace/project.ts:106-108`）。若用户把总根选到较大的可写目录（如 home），再删一个恰好匹配 `SLUG_RE` 的普通目录，会整目录递归删除。
5. **P1 RPC 请求体按 chunk 逐段 `String(chunk)` 拼接，跨 chunk 的多字节 UTF-8 会变成 U+FFFD**（`src/rpc.ts:163-167`）：`Buffer#toString('utf8')` 对截断序列产生替换符。中文标题/摘要的 JSON 请求体一旦在 64KiB 附近被切分就会 JSON 解析失败（表现为 `body is not JSON`）。未设置 `req.setEncoding('utf8')`、也未用 `Buffer.concat`。
6. **P1 审批策略与架构文档/同族插件不一致**：0102 §8.2 明写 `srw_literature`/`srw_paper` 写操作需审批、`srw_reading` 启动耗 token 需审批（`docs/01-tech/0102-技术架构.md:453-457`）；实现里 `srw_read`、`srw_paper` 全动作豁免（`src/tools.ts:454-459,604-607`），`srw_literature.bibtex` 会写 `paper/refs.bib` 却也豁免（`src/tools.ts:439-443`、`src/literature/service.ts:366-370`），`srw_watch.resume` 可重建周期任务（扩大无人值守面）仍豁免（`src/tools.ts:339-352`）。对照同族 automation：`automation_run_now`/`automation_update` 都在 `MUTATING_TOOLS` 里要求审批（`../dsh-kylin-automation/src/tools.ts:20-25`、`src/index.ts:44-52`）。
7. **P1 0102 的“7 视图”在当前代码里不是 7 个视图**，而是一个 1418 行的单滚动面板 + 8 张卡（`src/client/workbench.tsx:934-1418`），无视图路由/子导航；选题/素材/实验/投稿四视图缺失（对照 `0102:496-508`）。
8. **P1 中英双语只落在侧边栏一个词**：`locale.register(NS, {zh:{nav}, en:{nav}})`（`src/client/index.tsx:45-51`），工作台/设置页全部硬编码中文（如 `src/client/index.tsx:86,140-149`、`src/client/workbench.tsx:936-1416`），与 0102 的横切要求“中英双语界面”不符（`0102:48`）。
9. **P2 已确认的 UI 缺陷**：`srw-list` / `srw-item` / `.srw-badge.bad` 在 `styles.ts` 中不存在（仅有 `.srw-dot.bad`，`src/client/styles.ts:58-61`），但被工作台大量使用（`workbench.tsx:1168-1170,1230-1232,1337-1342,1362-1367,1379-1381`）→ 列表无样式、撤稿/错误徽章不变红。
10. **P2 诊断面原样进生产面板**：E1 探测按钮与 `contains` 实测全在正式面板折叠卡里（`src/client/workbench.tsx:1408-1415`、`src/client/view.tsx:357-375`），且内置了开发者机器绝对路径 `/Users/libing/kk_Projects/dsh-kylin-srw/README.md`（`src/client/view.tsx:137`），已被打进 `lib/client.js`（bundle 内可搜到该字符串）。
11. **P2 版本号三处漂移、README 状态过期**：`SRW_VERSION='0.0.1'`（`src/service.ts:19`）、`package.json:3`、UA `dsh-kylin-srw/0.0.1`（`src/literature/http.ts:27`）各自硬编码，smoke 不断言一致；README 仍写“M2 完成”（`README.md:14`）而 M5 已交付。
12. **P2 大量“已实现但未接线”的模块**：`src/reading/budget.ts`、`src/reading/recommend.ts`、`src/reading/formula.ts` 无任何生产 import（只有测试），对应 0201 的预算门/G2 同意门/公式策略（`0201:341-343`）；`writeBinary` 仅测试使用（`src/host.ts:50-69`、`tests/host.test.ts:146-166`）；`WorkspaceStore.moveSlug` 无 RPC/tool 暴露（`src/workspace/project.ts:119-133`）。

---

## 1. 插件装配全过程

### 1.1 入口与 fiber

- 宿主入口：`export const name = 'dsh-kylin-srw'`（`src/index.ts:21`）、`export const inject = [...]`（`src/index.ts:30-41`）、`export async function apply(ctx, rawConfig)`（`src/index.ts:53`）。
- apply 的**全部副作用**包在 `await ctx.effect(async () => {...}, 'dsh-kylin-srw: host')`（`src/index.ts:54`）里；effect 工厂返回的 async disposer 即卸载路径（`src/index.ts:139-149`）。与 automation 同构（`../dsh-kylin-automation/src/index.ts:121-194`）。
- 配置面只有 `rootDir` / `offlineMode` 两个字段（`src/index.ts:44-47`），由 `SrwService.open` 防御式钳制（`src/service.ts:127-131`）；patch 行给出默认空值（`cordis.patch.yml:3-10`）。

### 1.2 `SrwService.open`：服务根与索引

- `SrwService.open` 先建 `WorkspaceStore(() => service.currentRoot())`，形成闭包单源（`src/service.ts:132-135`）。
- `storageDomain` 存在时 `openSrwIndex` 打开 `srw_index` 域；失败只 warn 并降级（`src/service.ts:136-147`，降级路径有测试 `tests/store.test.ts:86-106`）。域 spec 是纯数据 + zod schema，version 恒 1，`project_cache` 小写表名（`src/store.ts:38-50`），模块加载即执行宿主 defineDomain 的复刻校验（`src/store.ts:52-69`）。
- `attachIndex` 把持久 `rootDir` 收编进内存（`src/service.ts:152-156`），但 config 仍优先（见 §5.1）。
- 服务暴露：`reflect.provide('srw', service)`（`src/index.ts:58-59`，ADR-19）；返回的 disposer 未显式保存，依赖 fiber 自动回收（同族注释 `../dsh-kylin-vibe/src/index.ts:225` 亦如此）。`reflect` 是可选链，若宿主没有 reflect 会**静默跳过**且无日志——ADR-19 失效时不可观测，建议降级为 warn。
- 领域模块全部惰性 getter（`literature` `src/service.ts:79-82`、`watch` 84-89、`reading` 91-111、`writer` 113-125），装配根保持很薄。

### 1.3 能力通告与技能注册

- 公告：`systemPrompt.section({ name: 'plugin:dsh-kylin-srw', order: 207, text: ANNOUNCEMENT })`（`src/index.ts:66-73`）。`systemPrompt` 已在 inject 名单内，但仍做 try/catch 降级（失败 warn，不阻断激活）。
- `ANNOUNCEMENT` 实测 644 字符（`src/index.ts:50`），与 0102 的“一段，≤512 字”上限（`0102:109`）不一致；内容同时描述 5 个工具与 4 个技能，随迭代继续膨胀的风险高。
- 技能：插件根用 `new URL('.', import.meta.url).pathname` 生成候选，再尝试 `/lib/`、`/src/` 剥离，找 `skills/manifest.json`（`src/index.ts:78-88`）。**用 `.pathname` 而非 `fileURLToPath`**：安装路径含空格/非 ASCII（或 Windows）时 `%20`/反斜杠会导致找不到 manifest，只 warn 后跳过技能。
- `registerBundledSkills` 读 manifest→逐技能读 SKILL.md→剥 YAML frontmatter→`skills.register({source:'runtime', content, resourceBase})`（`src/skills.ts:31-63`）。清单 4 个技能（`skills/manifest.json`），单测校验文件存在与注册参数（`tests/tools.test.ts:92-119`）。
- 风险：`registerBundledSkills` 的 JSON.parse/readFile 抛错在 apply 内**没有 try/catch**（`src/index.ts:90`）→ skills 打包损坏会整体阻断插件激活；且此时 service/storage index 已打开、没有 finally 清理。

### 1.4 根 Agent 工具挂载

- `mountTools(agent)`：要求 `agent.id`、`agent.ctx` 存在（`src/index.ts:97-103`），且 `ctx.agents.roots()` 含该 id（`src/index.ts:104-106`）；用 `agentTools: Map<agentId, disposer>` 去重（`src/index.ts:62,107`）。
- 注册点：`agentCtx.effect(() => [五个 toolDef].map(def => agentCtx.tools?.register(def)), 'dsh-kylin-srw: project tool')`（`src/index.ts:109-116`）——工具随 agent fiber 回收，插件 disposer 再兜底一次（双重 dispose 依赖 disposer 幂等）。
- 五个工具一次挂齐：`srw_project/srw_literature/srw_watch/srw_read/srw_paper`（`src/index.ts:110`）；但文件头注释仍写“M1 owns ... the agent-scoped `srw_project` tool”（`src/index.ts:1-13`）——注释与实现漂移。
- 生命周期：启动时遍历现有 `agents.roots()`，并监听 `agent/created` / `agent/disposed`（`src/index.ts:119-126`）。与 automation 的差异：automation 还要求 `session.id` 存在并排除自己的 run session 前缀（`../dsh-kylin-automation/src/index.ts:145-150`）；SRW 无排除逻辑（也没有自己的无人值守 session）。
- `mountTools` 里 `agents.roots()` 判定用 `agent.id`；审批钩子判定用 `caller.sessionId`（见 1.5）。QiLin 侧 agent/session id 是同一 id（`QiLin/packages/core/agent/src/index.ts:581-593`，注释 “the shared agent/session id”），因此该映射成立；这是**隐式契约**，没有注释或测试固化。

### 1.5 `tools/pre-execute` 审批钩子

- 写法：先 `await next()` 拿下游决策；仅当 `downstream.kind === 'allow'` 时才可能升级为 `ask`（`src/index.ts:128-135`）。语义正确：不覆盖其他策略的 deny/cancel/ask，只在“本来会放行”时补一道人工门。
- `mounted` 判定：`caller.sessionId !== undefined && agentTools.has(caller.sessionId)`（`src/index.ts:132`）；`callerFrom` 从 `exec.agent.session.{id,header.cwd}` 提取（`src/tools.ts:28-34`）。`exec.agent` 在宿主工具运行时是可选的（`QiLin/packages/core/tools/src/index.ts:330-333`），缺失时 mounted=false → 不问，但工具本身也只挂在 agent 作用域，正常路径不会命中。
- 决策表：`ASK_TABLE` 只覆盖 3 个工具（`src/tools.ts:104-108`）；纯函数 `approvalDecision` 先看 mounted，再查工具→action（`src/tools.ts:111-120`）。`reason` 固定英文审计文本、`displayReason` 双语（`src/tools.ts:41-56,66-81,86-101`），语言无关性好。
- 与 automation 的差异：automation 在 `needsHumanApproval` 里检查 `exec.signal.aborted`（`../dsh-kylin-automation/src/index.ts:56-60`），SRW 未检查——已取消的调用理论上仍可能弹审批卡（窗口极小）。

### 1.6 RPC 注册与卸载顺序

- `registerSrwRpc(ctx, service)` 在 apply 末尾（`src/index.ts:138`）；内部 `ctx.effect(() => webServer.register({kind:'prefix', path:'/dsh-kylin-srw', handler}), 'dsh-kylin-srw: rpc channel')`（`src/rpc.ts:100-115`）。
- 卸载顺序：手动工具 disposers（反向）→ `owned` 反向（公告、技能、agent 监听）→ `await removeRpc()` → `await service.dispose()`（`src/index.ts:139-149`）。`service.dispose` 只 `close()` storage 域（`src/service.ts:364-369`），领域 getter 无需关闭。
- 潜在双重释放：RPC 注册本身已作为**内层 effect**登记到同一 fiber（`src/rpc.ts:110-111`），外层 disposer 又显式 `await removeRpc()`（`src/index.ts:147`）——真实 Cordis 下 fiber 卸载会同时触发两者。`webServer.register` 的 disposer 是否幂等未验证（`tests/host.test.ts:200-227` 只调用一次）。工具 disposer 同理（agent fiber + 插件兜底）。建议在 disposer 里加 once 保护或确认宿主 disposer 幂等。

---

## 2. 双通道契约

### 2.1 manifest：单包双键

- `dsh` 与 `qilin` 两键**逐字相同**：`bundle.patch` 单个 string、`client.platform='web'`、5 个 client bundle inject（`package.json:26-55`）。smoke 断言 `dual-keys-identical`、`patch-is-string`、`platform-web`（`scripts/smoke-plugin.mjs:56-68`），负例 ② 证明数组形态会被抓红（`scripts/smoke-plugin.mjs:186-191`）。
- `files` 白名单：`lib`、`cordis.patch.yml`、`README.md`、`LICENSE`、`skills`（`package.json:16-22`）；`skills` 是运行时必需（`src/index.ts:86`），已包含。
- `exports`：`.` 同时给 `types` 与 `default`（`package.json:8-15`）；`./client` 只有 string，**没有 types 条件**，而声明产物 `lib/types/client/index.d.ts` 确实存在——TS 使用者从 `dsh-kylin-srw/client` 导入拿不到类型。0201 计划中的 `./cordis.patch.yml` export（`0201:101`）未实现（当前靠 `files` 里的实体文件）。
- `dependencies` 只有第三方 `pdfjs-dist/pdfkit/zod`（`package.json:67-71`），无引擎包；`peerDependencies` 全部 `*`（`package.json:72-89`）。smoke 断言 `peer-all-star`、`deps-no-engine`（`scripts/smoke-plugin.mjs:82-90`）。
- `main` + `type: module` + `engines node>=22.19`（`package.json:6-7,23-25`）。

### 2.2 零 `@deepseek-ai/*` 运行时导入

- 源码只有一个引擎导入且是 `import type { Context } from '@deepseek-ai/cordis'`（`src/index.ts:15`）；`grep` 确认没有非 type 导入。
- 构建把 `@deepseek-ai/*`、`cordis` 设为 external（`scripts/build.mjs:56-64`）；smoke 用正则断言产物无 `from/import()/require('@deepseek-ai/...')`（`scripts/smoke-plugin.mjs:101-111`），负例 ① 验证会红。当前 `lib/index.js` grep 通过。
- 引擎能力全部经 inject 服务名 + 可选反射读（`reflectService` `src/service.ts:49-57`；`schedule()` 两级读法 `src/service.ts:310-330`）。这是 E3 教训的落地：未 inject 的服务属性访问会抛 `cannot get property "X" without inject`（`docs/03-verify/E2-qilin-external-bundle.md:20-24`、`E3-schedule-semantics.md:11-13`）。
- 代价：所有宿主类型靠 `src/types/dsh.d.ts` 的 ambient 声明（`src/types/dsh.d.ts:15-89`），与宿主真实形状靠注释维护；`effect` 的返回类型写成 `T` 而非 disposer（`src/types/dsh.d.ts:40`），`webServer.register` 返回值固定 `() => void`（`src/types/dsh.d.ts:26-32`），与 `rpc.ts` 里“可能 async”的假设（`src/rpc.ts:111-114`）不完全一致。

### 2.3 Host `inject` 名单：编排存在性契约

- 名单 10 个：`connection/webServer/storageDomain/workspaceRegistry/settings/fs/agents/tools/skills/systemPrompt`（`src/index.ts:30-41`）。
- 纪律来源：web profile 无 `schedule` 时 inject 会让插件**永久 pending**，`ctx.get` 同被拦（`E3:11-13`、`0201:510`）；因此不可保证存在的服务（llm/agentDefaultModel/schedule/reflect/commands…）不进名单，改用软探测 + 反射（`src/service.ts:49-57,310-330`；`src/diag.ts:15-43`）。
- **两名未消费**：`settings` 与 `workspaceRegistry` 在 `src/` 中除 inject 名单、diag 探测、类型声明外**没有任何访问**（`grep -rn "settings\|workspaceRegistry" src` 结果仅 `src/index.ts:34`、`src/diag.ts:22`、`src/types/dsh.d.ts`）。0202 原计划用 `workspaceRegistry` 做 S1 核对（`0202:58-79`），实际改用 client 侧 `workspaces.list` 快照（`workbench.tsx:316-324`）；settings 命名空间按 B 路线放弃（`0202:155-158`、`src/workspace/root.ts:1-4`）。二者为“零收益的 pending 风险”，应撤出名单或补真实用途。
- `systemPrompt` 在名单内却仍软探测（`src/index.ts:66-73`）：防御性冗余，不算错误，但掩盖了“inject 契约被破坏”的信号。

### 2.4 Client 面：两层 inject 别混

- **bundle 名单**（package.json `client.inject`，5 个 `@deepseek-ai/dsh-client-*`/api 包，`package.json:30-38`）与 **服务名名单**（`src/client/index.tsx:18-34`，14 个）是两回事；E2 已区分（`E2:24`）且两通道实测 14/14（`E1:23`）。
- 14 名 = 10 个已验证（`slots/connection/locale/sessions/uiWorkspace/workspaces/remote/remote.session/modelDirectories/layout`）+ 4 个 E1 服务（`sidebarRight/documentPreviews/uiSession/conversation`，`src/client/index.tsx:29-33`）。
- 实际消费面：`remote`、`remote.session`、`modelDirectories` **只在 inject 名单和诊断 `CLIENT_PATHS` 里出现**，无任何 `ctx.remote` 访问（`grep` 确认）；`sidebarRight`、`documentPreviews` 只在 `DiagView` 的 E1 探测里用（`src/client/view.tsx:132-194`）。为调试能力保留的 inject 会扩大“缺名=激活失败”的面（E2 对 vibe 的实测结论），E1 自己也把“保留或撤”留作待办（`docs/03-verify/E1:33`）。

### 2.5 产物结构

- Host：`lib/index.js` ESM、4.2MB（pdfjs + pdfkit + noble 等被打进 bundle），export `{apply, inject, name}`（文件尾 `export { apply2 as apply, inject, name }`）。
- Client：`lib/client.js` CJS + banner/footer 包装 `window.__ModuleLoader__.load({id:'dsh-kylin-srw', factory})`（`scripts/build.mjs:79-87`），sourcemap 随包；`require` 目标实测只有 `react`、`react/jsx-runtime`，在 9 词白名单内（`scripts/smoke-plugin.mjs:117-131`）。
- 声明：`lib/types/**`，`lib/types/index.d.ts` 是 `types` 导出目标（`lib/types/index.d.ts`）。
- 运行时附件：`lib/pdf.worker.mjs`（pdfjs Node fallback）、`lib/pdfkit-standard-fonts/*.cjs`（pdfkit `#standard-fonts` 的 imports 映射目标，`package.json:118-120`；构建复制于 `scripts/build.mjs:97-104`）。两者都只有**静态存在性**保障，没有运行时测试（见 §7、§8）。

---

## 3. RPC 层

### 3.1 通道、信封与传输

- 通道名 `/dsh-kylin-srw`（`src/rpc.ts:16`），`kind:'prefix'` 路由（`src/rpc.ts:105-109`）。
- 采用裸 `webServer.register` + `connection.requestRejection`，而非 `connection.rpc.handle`：注释把“直连”定为当前已验证主路（`src/rpc.ts:1-11`），与 0102 ADR-14 的“handle 首选”相反，E1/E2/0201 附三 #8 已把口径改为“直连为已验证主路”（`0201:515`）。
- 鉴权栅栏：`ctx.connection?.requestRejection(req)`，非 undefined 直接按 401/403 返回（`src/rpc.ts:128-133`）。注意 `connection` 在 host `inject` 内，正常必存在；接口类型却把它设为可选（`src/rpc.ts:88-97`），测试 fake 可省——若真缺席则**没有任何栅栏**。
- 方法只允许 POST（`src/rpc.ts:134-138`）；`content-type` 必须 `application/json`（415，`src/rpc.ts:147-151`）；body 上限 4MiB（声明长度 413、实际累计 400，`src/rpc.ts:18-19,152-173`）。
- 请求信封：`{type:'client-request', rpcId, method, payload}`；`method` 必须等于 URL 端点（`src/rpc.ts:174-197`）。响应信封：`{type:'server-response', rpcId, result}`，`result` 为 `{ok:true,value}` 或 `{ok:false,error:{code,message,details:{}}}`（`src/rpc.ts:21-35,199`）。`details` 必须是 object 的约束来自 vendored client 的解析器（`src/rpc.ts:29-32` 注释；测试固化于 `tests/host.test.ts:188-198`）。

### 3.2 校验：没有 zod，只有手写最小校验

- zod 只用于 storage 域 spec（`src/store.ts:14,24-36`）；RPC 层全部手写：`record/reqString/optString/optNumber`（`src/rpc.ts:45-78`），字符串上限 5000，数字要求安全整数 ≥1。
- 逐端点校验强度不一：
  - 严格：`diag.contains`（`src/rpc.ts:218-221`）、`project.*`（`src/rpc.ts:232-250`）、`literature.import` 数组 1..100 + 元素 object（`src/rpc.ts:260-273`）、`reading.glossary` 只收 string 值（`src/rpc.ts:375-387`）、`paper.outline.save` 白名单字段（`src/rpc.ts:416-428`）、`paper.refsAppend` 只收 string（`src/rpc.ts:435-440`）。
  - 宽松/下沉到服务层：`watch.create` 把 `project/source/query` 原样传给 `validateWatchInput`（`src/rpc.ts:315-328`、`src/watch/model.ts:66-86` 是唯一 choke point）；`reading.translate` 过滤 keys、force 只认 true（`src/rpc.ts:352-360`）；`paper.compile` 等只需 project。
  - 类型谎言：`literature.bibtex` 只检查 `Array.isArray(keys)`，随后 `keys as readonly string[]` 强转（`src/rpc.ts:281-289`），数字元素会流进库查找。
- 无 schema 版本协商、无 `rpcId` 去重/幂等键；所有端点“立即执行”，没有 job 模型（与 ADR-13 冲突，见 3.5）。

### 3.3 端点清单（共 47 个 case，`src/rpc.ts:211-450`）

| 组 | 端点 | 位置 |
|---|---|---|
| diag | `ping` / `caps` / `echo` / `contains` | `rpc.ts:212-221` |
| root | `get` / `set` | `rpc.ts:222-231` |
| project | `create` / `list` / `open` / `rename` / `remove` | `rpc.ts:232-250` |
| literature | `search` / `import` / `fetchPdf` / `lib` / `bibtex` | `rpc.ts:251-289` |
| overview | `overview`（5s 轮询面） | `rpc.ts:290-291` |
| schedule（E3 遗留实验端点） | `diag.schedule.create/list/delete/storage` | `rpc.ts:292-311` |
| watch | `list/create/remove/pause/resume/run` | `rpc.ts:312-346` |
| reading | `extract/translate/status/verify/content/export/glossary` | `rpc.ts:347-387` |
| paper/venue | `paper.state`、`venue.list/apply`、`paper.scaffold`、`outline.get/save/confirm`、`paper.compile/citeAudit/refsAppend`、`snapshot.list/restore`、`paper.compliance` | `rpc.ts:388-448` |
| 缺省 | `fail('not-found')` | `rpc.ts:449-450` |

- 未见端点：0102 §8.1 规划的 `reading.prepare/start/progress/cancel`、`paper.log`、`materials.*`、`compute.*`、`experiments.*`（`0102:425-446`）——M6/M7 未实现，属于范围差而非缺陷。

### 3.4 “panel/session 切换”与调用者身份

- **RPC 层没有 session/panel 概念**：47 个端点里只有 `diag.schedule.*` 与 `watch.create/resume` 显式接受 `sessionId`（`rpc.ts:296-308,319-341`）。面板/会话切换完全在 client 侧（`layout.selectPanel`），Host 只有一个全局 `activeProject` + 全局 root（`src/service.ts:159-169,190-205`）。
- `selectPanel` 语义已核对 QiLin 源码：`selectPanel(panelId: MainPanelId | null)`，传 null 合法（`QiLin/packages/client/ui-layout/src/client/service.ts:36,72-77`）。工作台在“转给 Agent/翻译/大纲”前先 `selectPanel(null)` 交还会话主区，再等 400ms（`src/client/workbench.tsx:523-527,575-584`）——这是绕开 `main` keyed 槽占主区导致会话控制器不活跃的正确做法（E1:17 的 submit 即时发送语义）。
- **多会话共享活动项目**：两个会话里的根 agent 共用同一个 `activeProject`，后 open 者覆盖前者；`project.remove` 不清除它（§5.5）。面板创建订阅时若不传会话，绑定“最新根 agent 的会话”（`src/service.ts:261-271`、`rpc.ts:318-322`）——这是隐式的全局选择，不是调用者身份。
- **无调用者身份/授权**：RPC 只有 Host/Origin/浏览器 cookie 栅栏（`src/rpc.ts:127-133`），没有用户/会话身份，也不做 project 级 ACL。`diag.schedule.create` 可向**任意 sessionId** 投递任意 `prompt`（`rpc.ts:292-303`、`service.ts:333-345`），`diag.schedule.storage` 泄露宿主 home 路径（`service.ts:360-362`）。这些是 E3 保留的诊断面，生产版应 gate 掉。

### 3.5 RPC 缺陷

1. **UTF-8 chunk 拼接 bug**（`src/rpc.ts:163-167`）：见 §0-5。
2. **取消只覆盖入口**：`AbortController` 在 res close 时 abort（`rpc.ts:159-160`），但 `handleSrwRpc` 只在开头 `signal.throwIfAborted()`（`rpc.ts:210`），领域服务完全不接收 signal。长操作（compile/translate/extract）无法中断。
3. **无 job/轮询**：`paper.compile`（tool timeout 600s，`src/tools.ts:593`）、`reading.translate` 同步跑在 HTTP 请求里，和 ADR-13“长任务一律 job + 轮询”冲突（`0102:733`）。浏览器/连接层的请求超时会直接打断（且没有补偿）。
4. **状态码语义不一致**：未知端点返回 HTTP 404 + JSON（`rpc.ts:143-145`），而“端点已知但 method 不匹配”“信封非法”返回 HTTP 200 + `ok:false`（`rpc.ts:181-197`）；body 非法 JSON 又是 400（`rpc.ts:175-179`）。
5. **错误码不封闭**：`toErrorResult` 透传 `ServiceError.code`（`rpc.ts:37-41`），实际 code 集合包含 `INVALID/UPSTREAM/STALE/OFFLINE/CORRUPT/CONFLICT/UNRESOLVED/RETRACTED/GATE/NOT_FOUND/NO_ROOT/NO_PROVIDER/ENGINE_MISSING`（`grep ServiceError`），还有小写 `aborted/internal/not-found/invalid`（`rpc.ts:38-40,450`）。0102 把 code 定义为稳定枚举（`0102:447`），当前不是。
6. **鉴权抛错无兜底**：`requestRejection` 在 try/catch 之外调用（`rpc.ts:127-133` vs try 起点 161）；它若抛错，`void serveRpcRequest(...)`（`rpc.ts:108`）产生未处理 rejection，且客户端收不到响应。
7. **`registerSrwRpc` 双重释放**（见 §1.6）。

---

## 4. Tool 层

### 4.1 五个工具与其 schema

| 工具 | action 数 | timeout | 位置 | 备注 |
|---|---|---|---|---|
| `srw_project` | 4（list/create/open/remove） | 15s | `src/tools.ts:151-221` | 参数 action/slug/title/field（`159-168`）；输出统一 JSON 文本 render（`129-131,169`） |
| `srw_literature` | 5（search/import/pdf/bibtex/lib） | 120s | `src/tools.ts:378-452` | import items 来自 search 原样；search 投影做截断 + 可选字段条件展开（`229-247`） |
| `srw_watch` | 6（list/create/remove/pause/resume/run） | 120s | `src/tools.ts:279-376` | run 幂等；create 绑 caller.sessionId（`311-332`） |
| `srw_paper` | 15（state…compliance） | 600s | `src/tools.ts:461-602` | G1 门由 `WriterService.sectionWrite` 硬校验（`src/writer/service.ts:240-249`、`src/writer/outline.ts:120-124`） |
| `srw_read` | 5（status/extract/translate/notes/export） | 300s | `src/tools.ts:613-711` | 分批翻译协议写进描述；status 待译清单上限 600（`611,631-634`） |

- 输出形状：`output.schema` 统一泛化 `{type:'object'}`（`src/tools.ts:169,301,401,592,701`），实际靠 `jsonRender` 文本化；宿主对工具结果做 lossless JSON 校验，`searchOutputFor` 已按“可选字段条件展开”修复（`src/tools.ts:224-247`），并有回归测试（`tests/tools.test.ts:134-199`）。
- 参数 schema 只是 JSON Schema 描述，`execute` 内再手写校验；没有运行时 schema 编译/校验（同 RPC 手写风格）。

### 4.2 审批矩阵（ask vs allow）

- `srw_project`：create/remove ask；list/open allow（`src/tools.ts:19,41-56`）。
- `srw_literature`：import/pdf ask；search/lib/bibtex allow（`src/tools.ts:20,64-82`）。
- `srw_watch`：create/remove ask；list/run/pause/resume allow（`src/tools.ts:84-101,277-279`）。
- `srw_read`、`srw_paper`：全部 allow（`src/tools.ts:454-459,604-607` 的设计注释：授权来自会话显式意图 / 工具只做 IO + 门）。
- 判定纯函数 `approvalDecision` 返回 `{kind:'ask', reason, displayReason}` 或 undefined（`src/tools.ts:111-120`），单测覆盖动作矩阵与“未挂载不问/陌生工具不问/action 缺失不问”（`tests/tools.test.ts:20-34,244-255,308-312`）。

### 4.3 `callerFrom` 与挂载判定

- `callerFrom` 只取 `agent.session.id` 与 `agent.session.header.cwd`（`src/tools.ts:22-34`），照抄 automation（`../dsh-kylin-automation/src/tools.ts:33-39`）。
- **`cwd` 是死字段**：`grep` 显示 `src/tools.ts` 之外没有任何 `.cwd` 消费（`src/tools.ts:32` 是唯一生产读取）。`srw_watch.create/resume` 只消费 `sessionId`（`src/tools.ts:313-319,340-343`）。若未来用 cwd 做 workspace 校验，当前无任何保障。
- `mounted` 用 sessionId 映射 `agentTools`（key 为 agent.id）；QiLin 的 agent/session id 共享（见 1.4），当前成立但无测试；若宿主把两者拆开，审批门会**静默失效**（mounted=false → 不问）。建议加一条装配级单测或改为保存 agent 对象比较。

### 4.4 绕过 / 滥用风险

1. **写操作不审批**：`srw_paper` 的 `scaffold/section.write/refs.append/snapshot.restore` 都会写项目文件（`src/writer/service.ts:76-89,240-249`）；`srw_literature.bibtex` 写 `paper/refs.bib`（`src/literature/service.ts:366-370`）；`srw_read.export` 写 `readings/<date>/*.pdf`（`src/reading/service.ts:458-462`）。这些与 0102 §8.2 的“写需审批”直接冲突（`0102:453-457`）。
2. **扩大无人值守面不审批**：`srw_watch.resume` 会删除旧 schedule 任务再重建（`src/watch/binding.ts:147-171`），可换绑任意 sessionId（`src/tools.ts:339-343`）；`srw_watch.run` 免审批直接联网抓取（`src/tools.ts:353-364`）。对照 automation 把 `run_now`/`update` 纳入必须审批（`../dsh-kylin-automation/src/tools.ts:20-25`）。
3. **token/进程副作用免审批**：`srw_read.translate/notes` 烧宿主默认模型 token（`src/tools.ts:649-670`、`src/reading/service.ts` 翻译链）；`srw_paper.compile` 起本机进程（`src/writer/service.ts:261-271`）。0102 对 `srw_reading` 的“启动（耗 token）需审批”未实现（`0102:456`）。
4. **审批只覆盖 agent 工具面**：面板 RPC（`project.remove`、`literature.import`、`paper.snapshot.restore` 等）完全不过审批（`src/rpc.ts:232-450`）。这是“面板=用户本人”的信任模型；但 RPC 只有浏览器栅栏、无二次确认服务端校验，面板的两步删除确认是纯 UI（`src/client/workbench.tsx:414-435`），直接构造 RPC 请求即可绕过。
5. **ask 只在 downstream allow 时补**（`src/index.ts:129-134`）：若上层策略把调用判成 ask（别的插件的文案），SRW 的专用 reason/displayReason 不会呈现；若上层判 deny，SRW 不覆盖（正确）。这是 waterfall 语义下的合理行为，但意味着审批文案可能“被别人接管”。

---

## 5. Service / Store / Workspace

### 5.1 `root.json`、settings 面与总根

- `.srw/root.json` 是根内配置，字段 `schemaVersion/defaultLangPair/allowIllustrative/offlineMode/politeMailto`（`src/workspace/root.ts:9-23`）；读失败/坏字段逐项回落默认（`root.ts:30-48`，测试 `tests/schema.test.ts:56-72`）；写走 `mkdir + tmp→rename` 原子替换（`root.ts:51-63`，测试 `schema.test.ts:74-95`）。
- settings 命名空间**没有注册**：B 路线决策见 `0202:155-158`，设置页走 client `settings.section` 槽 + `root.set`（`src/client/index.tsx:78-156`）。Host `settings` inject 名保留但未使用（§2.3）。
- **只有 `politeMailto` 被真实消费**（`src/literature/service.ts:371-376`，Crossref/DOI/撤稿三处使用 `166-167,201-202,286-287,305-306`）。`defaultLangPair`、`allowIllustrative`、`offlineMode` **无任何读取方**：`grep readRootConfig` 仅 import 与 literature 的 mailto。离线模式实际只来自 patch-row config（`src/service.ts:130,255,281`；`src/literature/service.ts:383`；`src/watch/binding.ts:212`），而错误文案却写“可在面板关闭离线模式”（`src/literature/service.ts:186`、`watch/binding.ts:176`）——面板里**没有这个开关**，只有只读显示（`workbench.tsx:940`）。这是“配置文件承诺了不存在的功能”。
- 总根判定：`currentRoot()` config 优先、storage 回落（`src/service.ts:159-164`）；`setRoot` 的 contains 自检恒真（`src/service.ts:181`，见 §0-4）；`writeRootConfig(path,{})` 顺带证明可写（`root.ts:51-63`）。`info()` 却只回 `config.rootDir`（`src/service.ts:278-285`），与 `root.get` 的 `currentRoot()` 不一致——storage 恢复的根在 `diag.caps.info` 里显示为空。
- `indexGlobal()` 在 index 缺席时回退内存（`src/service.ts:171-175`）；但注释说“rootDir 仅来自 patch config”（`src/service.ts:64-65`）已过时：`setRoot` 在降级态也会 `adoptRoot`（`src/service.ts:185-186`）。

### 5.2 `project.json`：schema、迁移、原子性

- 形状：`schemaVersion:1`、`slug`（`^[a-z0-9][a-z0-9-]{0,63}$`）、`title`（≤200）、`stage`（6 值）、`createdAt/updatedAt` ISO（`src/core/schema.ts:5-42`）；可选手写 `field/targetVenue/depthTier`（`schema.ts:13-14`）。
- 零依赖手写校验器，返回错误清单而非抛错（`schema.ts:1-3,22-42`），被 `WorkspaceStore.list` 的“坏文件跳过”与 `open` 的“INVALID”共用（`src/workspace/project.ts:52-54,100-102`）。
- **无迁移机制**：`schemaVersion` 只接受 1（`schema.ts:26`），与 0102 §6.3“version 恒 1、只加可选字段”一致（`0102:253-264`）。
- **非原子写**：`create/rename/moveSlug` 直接 `writeFile`（`src/workspace/project.ts:81,114,131`），没有 tmp→rename；进程崩溃可能留下半截 JSON（list 会跳过，但活动项目会 NOT_FOUND）。与 root/library/watch/reading json 的原子纪律不一致（`root.ts:55-58`、`src/literature/library.ts:118-121`、`src/watch/store.ts:67-70`、`src/reading/service.ts:83-90`）。
- **create 的 CONFLICT 是 TOCTOU**：先 `stat` 判不存在（`project.ts:62-67`），再 `mkdir(recursive)`（`project.ts:78-80`）——`mkdir` 对已存在目录不报错，两个并发 create 可同时通过检查并互相覆盖 `project.json`。
- `remove` 不做任何“这是项目”的校验（`project.ts:106-108`）；`list` 只把“目录名合法 + project.json 合法”当项目（`project.ts:44-57`），二者集合不一致，是 §0-4 的数据安全根源。
- `moveSlug` 已实现且测试覆盖（`project.ts:119-133`、`tests/workspace.test.ts:47-50`），但无 RPC/tool 暴露（grep 无引用）。

### 5.3 containment / 路径安全

- 唯一护栏 `assertInsideRoot`：`fs.resolve(root)` + `fs.resolve(target,{cwd:root})` → `fs.contains(rootTarget,targetTarget) === true`，任一能力缺失即抛 `PathSafetyError`（fail-closed）；最后用 `fs.processPath` 还原宿主可打开路径（`src/host.ts:86-101`）。负例覆盖 `../`、绝对注入、`~` 展开、真实符号链接（`tests/security.test.ts:41-102`）。
- 真实消费点：literature library（`src/literature/library.ts:66`）、PDF 落盘（`src/literature/pdf.ts:135`）、watch store（`src/watch/store.ts:18`）、reading（`src/reading/service.ts:68-70`，extract 的 `pdfPath` 也先 guard，`:230-232`）、writer（`src/writer/service.ts:73-75`）。项目 CRUD 不经过 contains，只靠 `SLUG_RE`（`project.ts:36-41`）——对合法 slug 的越界无能为力，但 root 本身是用户选的，风险集中在 root 选择过宽。
- `processPath` 缺席时回退 `resolve(rootAbs, targetRel)`（`src/host.ts:99-100`），对绝对 targetRel 仍返回绝对路径；注释已声明仅作显示/落点参考。

### 5.4 文件即真相源、锁与原子写

- 真相源：项目=目录扫描（`project.ts:44-57`）；`library.json`（`library.ts:1-5`）；`watch.json`（`watch/model.ts:1-3,51-53`）；`reading/<key>/*`（`src/reading/service.ts:1-3`）；`paper/` + `.srw/{venue,outline}.json`（`src/writer/service.ts:1-7`）。storage 只存 `rootDir/activeProject` + `project_cache`（`src/store.ts:5-9`），与 ADR-3 一致（`0102:723`）。
- 乐观并发：library 与 watch 都以“重新读盘 revision 比对 → STALE”实现（`library.ts:99-123`、`watch/store.ts:48-70`）；但这是 check-then-write，**没有文件锁**，两个进程仍可能同时通过检查后各自 `revision+1` 覆盖（last-writer-wins）。0102 §6.3 承诺“写前比对 mtime 与内容哈希”（`0102:264`），实现里既没有 mtime 也没有哈希。真正的 `withFileLock` 只用于 RateGate 账本（`src/literature/file-lock.ts:67`、`src/literature/rate-gate.ts`）。
- `project_cache` 只在 `openProject` 写入（`src/service.ts:189-205`）；`activeStage()` 只读 cache（`src/service.ts:207-213`）→ 新建未打开、rename 后、换根后都可能读到旧 stage/缺失 stage。`overview` 的 `activeStage` 因此不是权威。
- `overview()` 每 5s 被面板轮询（`workbench.tsx:288-314`），每次都做 `workspace.list()`（逐项目读 project.json）+ `watch.list()`（读 watch.json）+ `collectCaps()`（28 条软探测，`src/diag.ts:15-43`）（`src/service.ts:216-258`）。注释“≤200ms 轻投影”在项目数大时（RISK-13 声称已关闭）没有缓存兜底。

---

## 6. Client UI

### 6.1 结构与入口

- `src/client/index.tsx`：安装样式（`42-43`）→ locale 字典（`45-51`）→ `slots.inject('sidebar.panellist')` 内**原子注册**侧栏项 + `main` keyed 面板（`55-76`，ADR-10 要求原子注册，否则点击抛 `main panel "…" is not registered`）→ `settings.section` 设置块（`81-156`）→ 图标组件（`160-168`）。
- `WorkbenchView`（`workbench.tsx:178-1418`）是唯一主面板：8 张卡（总根/项目/文献/精读/订阅/论文/流水线/诊断）+ 40 个 `useState`（grep 计数），无视图路由、无子导航、无状态持久化。0102 的 7 视图（`0102:496-508`）只落地成“工作台 + 领域卡片”。
- 诊断视图 `DiagView` 独立文件（`view.tsx`），默认折叠在最后一卡（`workbench.tsx:1408-1415`）；它包含 E1 全套探测按钮（`view.tsx:357-375`），是调试面而非产品 UI。

### 6.2 右栏硬约束与 `selectPanel`

- 代码**不使用** `ctx.sidebarRight` 做任何正常业务（只有 DiagView 的 E1 探测 `view.tsx:132-168`）；这符合 0102 的结论：`main` keyed 面板占主区时右栏解绑，`openResource` 抛 `no session surface is mounted`，`openResourceIn` 只写不画（`0102:473-495`、`E1:12-14`）。
- 与对话协同：`sendToCurrentAgent` 先 `layout.selectPanel(null)` 交还主区，再等 400ms，依次尝试路径 A（`sessions.retain → await ready → sessions.binding → conversation.input.for(binding.ctx).setDraft+submit`）与路径 B（`retainAgentScope → scope → scope.conversation.input.for(scope)`），每步 4s 超时；全断则剪贴板（`workbench.tsx:528-595`）。`selectPanel` 不在 `protocol-client.ts` 的 `LayoutService` 类型里（只有 `panelInfo`，`protocol-client.ts:33-37`），是通过 `as unknown as` 强转调用的（`workbench.tsx:577-578`）——类型面滞后。
- 会话 id 主源选 `uiSession.adapter.current.getSnapshot().key`，回退 `sessions.list.getSnapshot().current`（`workbench.tsx:534-544`）。后者在宿主上恒 undefined（`0102:510` 的警告），当前仅作 fallback，可接受。
- E1 已证明 `submit()` 是“立即发送并烧 token”（`E1:17`），工作台正是要这个语义；但副作用是**面板被切走、组件卸载**，`alive.current` 在 cleanup 置 false（`workbench.tsx:218-224`），之后 `setNotice(...)` 被跳过（如 `workbench.tsx:617-622`）→ 用户看不到“已发起/已复制”的提示（回到面板后状态也已清空）。这是“面板状态不持久”的结构性体验缺陷。

### 6.3 状态管理与 protocol client

- protocol-client 是纯类型面（`protocol-client.ts:1-5` 说明“无宿主模块导入”）：`SlotsService/LocaleService/ConnectionService/LayoutService/SessionsService/SidebarRightService/DocumentPreviewsService/UiSessionService/ConversationService/UiWorkspaceService/WorkspacesService` + `ClientContext`（`104-121`）。服务全部可选，访问前判空，呼应 E2“未注入访问抛错”。
- RPC 客户端**三份重复实现**：`workbench.tsx:138-149`、`view.tsx:64-75`、`index.tsx:95-101`（设置页）；通道常量也有 3 份（`rpc.ts:16`、`view.tsx:29`、`workbench.tsx:12`）+ 2 处硬编码（`index.tsx:98,129`）。任何信封/通道变更都要改 5 处。
- 状态管理是组件内 `useState` + 手写 `alive` ref + 轮询；没有 store、没有请求去重/取消。`overview` 5s 轮询 + `visibilitychange` 暂停（`workbench.tsx:288-314`）符合 0102 §9.2 面板纪律。

### 6.4 i18n / theme / CSS

- i18n：只注册 `nav`（`index.tsx:48`）；设置页标题硬编码（`index.tsx:86,140`）；工作台全部中文；`STAGE_LABELS` 中文常量（`workbench.tsx:16-23`）。0102 横切要求“中英双语界面”（`0102:48`）未落地。
- theme：样式全部走 `--dsw-alias-*` 令牌 + 字面量 fallback（`styles.ts:20-40`），符合 0102 §9.4“原生观感”纪律（`0102:525-537`）；`height:100%;min-height:0;overflow-y:auto` 也符合 `main` 槽必须自带滚动（`styles.ts:32-36`）。
- **CSS 缺类**：`.srw-list`、`.srw-item` 未定义；`.srw-badge.bad` 未定义（styles.ts 只有 `.srw-dot.bad`，`58-61`）→ 撤稿徽章、校验灯、TeX 错误徽章不变红（使用点 `workbench.tsx:1079,1178,1342,1367`）。这是可直接复现的样式 bug。
- 其他可移植性/诚实性问题：
  - DiagView 硬编码开发者绝对路径（`view.tsx:137`），随 bundle 发布；
  - 剪贴板兜底在 `navigator.clipboard.writeText` 抛错时仍返回 `'clipboard'`（`workbench.tsx:586-593`），UI 仍提示“已复制”（`workbench.tsx:620-621`）；
  - `paperKeyOfLite`（`workbench.tsx:162-165`）复制了 host 的 `PAPER_KEY_RE` 语义（`src/reading/service.ts:27`），两边独立演进；客户端生成 key 与已有 reading 目录不一致时会“重新抽取到新目录”；
  - 设置页与工作台各有一份选根逻辑（`index.tsx:106-137` vs `workbench.tsx:347-376`），都带 8s 超时与不同文案，已开始漂移。

### 6.5 构建打包（client）

- esbuild `format:'cjs'`、`platform:'browser'`、`target:'es2022'`、`external:['react','react-dom','react/jsx-runtime']`、`define NODE_ENV=production`（`scripts/build.mjs:66-88`）；banner/footer 包 `window.__ModuleLoader__.load`，footer `return module.exports`（`build.mjs:79-87`）。
- 产物实测 `require("react")`、`require("react/jsx-runtime")` 两个目标，均在浏览器静态模块表 9 词内（smoke 断言 `client-require-allowlist`，`smoke-plugin.mjs:117-131`；负例 ④）。
- 跨层打包：client 直接 import 了 `../reading/paragraphs.ts` 与 `../reading/render.ts`（`workbench.tsx:9-10`）——二者纯函数且只 import type，当前安全；但这是“client→host 领域层”的反向依赖，render 以后一旦引入 node 依赖就会在构建期或运行期炸。
- sourcemap 随包（`build.mjs:74`；smoke 断言 `sourceMappingURL`，`smoke-plugin.mjs:136-139`），`lib/client.js.map` 180KB 会进 tarball。
- host bundle 的 pdfjs worker 复制与 pdfkit 字体复制（`build.mjs:97-104`）是**只有静态存在性验证**的运行时 shim（见 §7/§8）。

---

## 7. 构建 / 发布 / 质量门

### 7.1 scripts

- `build`：`rm -rf lib` → 用 `ts.createProgram` 只出声明到 `lib/types`（`build.mjs:17-53`）→ host ESM bundle（`56-64`）→ client CJS bundle（`67-88`）→ 去行尾空白（`92-95`）→ 复制 `pdf.worker.mjs`（`99`）→ 复制 pdfkit standard-fonts（`104`）。
  - 声明编译的 compilerOptions 是**手抄一份**（`build.mjs:22-41`），与 `tsconfig.json` 分离（少了 `noFallthroughCasesInSwitch/forceConsistentCasingInFileNames`，`tsconfig.json:11-12`）——两份配置漂移风险。
- `typecheck` = `tsc --noEmit -p tsconfig.json`（含 tests，`tsconfig.json:20`）。
- `test` = `node --import tsx --test tests/*.test.ts`（`package.json:58`）。
- `check` = typecheck && test && build && smoke（`package.json:65`）；**不含** `smoke:dual`、不含 `test:security` 单列（security 已被 test glob 覆盖，`tests/security.test.ts:2-4` 注释说明）。
- `dev:install`：默认 `--qilin-profile p0vibe`、`--dsh-profile desktop`（`dev-install.mjs:27-29`）。**与 E2/0201 附三勘误冲突**：`p0vibe` 是 headless profile，web 端是 `web` profile（`E2:28-31`、`0201:508`）。脚本默认装进 headless profile，然后打印“启动 web 端”的命令，语义错位。DSH 桌面端走“手改三件套”（package.json/lockfile/node_modules symlink）兜底（`dev-install.mjs:87-128`），与 E2:33-41 的实测一致。
- `smoke:dual`：build → `npm pack`（`--cache` 指到临时目录避免写家目录，`smoke-dual-host.mjs:60-64`）→ tarball 内容断言 → 复用 smoke 断言核心 → 可选 Stage 2 安装（`--install`），否则打印 UNVERIFIED（`103-122`）。

### 7.2 smoke-plugin 断言质量

- 覆盖：manifest 名称/版本/type、双键逐字一致、patch 单 string、platform、client.inject 非空、exports、files 存在性、peer 全 `*`、deps 无引擎包、patch 行 id/name、host 无引擎运行时导入、client 自注册/无裸 export/react require/id/双槽、client require 白名单、types 存在、sourcemap、产物尺寸下限（`smoke-plugin.mjs:52-152`）。
- 负例自检 4 条（host 真实引擎 import、patch 数组、peer range、client 清单外 require），实测全红（`smoke-plugin.mjs:186-211`）。
- 弱点：
  1. 未断言 `inject` 是纯字符串数组（0201 Task 0.3 明确要求，`0201:181`）；
  2. `host-inject-names` 只检查 bundle 里出现 `connection/webServer` 字符串（`smoke-plugin.mjs:109-110`），不能证明导出的是数组；
  3. 未断言 `SRW_VERSION` 与 package version 一致（§0-11）；
  4. 未断言 `skills/manifest.json`、`lib/pdf.worker.mjs`、`lib/pdfkit-standard-fonts/*.cjs` 在 tarball 内——三者都是运行时必需；
  5. 无 “client inject 名单 vs src/client/index.ts 名单” 交叉校验。

### 7.3 发布面缺口

- `smoke-dual-host` Stage 1c 注释说对 tarball 的 manifest 做断言，实际读的是**仓库根**的 `package.json/cordis.patch.yml/lib/*`（`smoke-dual-host.mjs:92-97`）；`npm pack` 的 `files`/版本改写（如果有）不会被校验。
- tarball 必需文件只断言 `package.json/lib/index.js/lib/client.js/lib/types/index.d.ts/cordis.patch.yml/README/LICENSE`（`smoke-dual-host.mjs:76-89`），未断言 `package/skills/**`、`package/lib/pdf.worker.mjs`、fonts、`client.js.map`。
- 无 CI 配置（无 `.github/`）；0201 说“产物随仓提交、CI 断言产物与源一致”（`0201:20`）只完成前半：`lib/` 97 个文件确实在仓内（`git ls-files lib | wc -l` = 97），但**没有自动校验**，只能靠 `pnpm check` 本地跑。
- `outputs/` 未被 `.gitignore` 覆盖（`.gitignore` 只有 `.survey/node_modules/*.log/.DS_Store/tmp`），当前是未跟踪噪声。
- `package.json` 的 `files` 未含 `package.json`（npm 自动包含，无碍）；`exports` 缺 `./cordis.patch.yml`（0201 计划里有，`0201:101`）与 `./client` 的 types。

---

## 8. 测试覆盖评估

### 8.1 实测结果

- 全量：163 tests / 32 files，163 pass / 0 fail（61.7s）。
- 指定文件：`host.test.ts` 7 pass；`tools.test.ts` 10 pass；`workspace.test.ts` 2 pass；`store.test.ts` 3 pass；`schema.test.ts` 5 pass。
- `typecheck` 0 诊断；`smoke` ALL PASS；`smoke --negatives` 4/4 red。

### 8.2 这些测试证明了什么

- **host.test.ts**：`collectCaps` 的“缺席/父缺席/getter 抛错”三态与 Proxy 敌意对象（`21-42`）；`hostHome` 三通道 env 优先级与 unknown 不猜（`44-54`，含本次未提交的 env 清理修复）；`diagContains` 的 contained/越界/能力缺失/resolve 异常（`56-83`）；RPC 直调 `root.set→root.get→project 五端点→overview→入参校验错误码`（`85-144`）；`writeBinary` 两分支与 tmp 无残留（`146-166`）；信封失败分支必须有 object `details`（`185-198`）；`registerSrwRpc` 缺 webServer 抛 NO_PROVIDER 且可注销（`200-227`）。
- **tools.test.ts**：审批纯函数矩阵（`20-34`）；`callerFrom`（`36-39`）；`srw_project` 四动作 + 错误码 CONFLICT/INVALID + render 文本（`61-90`）；技能清单/frontmatter/注册参数（`92-119`）；lossless JSON 回归（`121-199`）；`srw_watch` 审批矩阵 + 假 schedule 的 create/list/run 幂等/pause/resume/remove 双删（`201-305`）；`srw_read` status→分批 translate→remaining→notes→export 全链（`314-398`，含真 fixture PDF）。
- **workspace.test.ts**：create→list→open→rename→moveSlug→remove 往返、子目录骨架、CONFLICT（`24-56`）；坏 slug/title、非项目目录/坏 project.json/badstage 跳过、无 root 拒绝、remove 不存在 ENOENT（`58-78`）。
- **store.test.ts**：spec 形状/UNIT_NAME_RE/global 初始值/null 拒绝/ProjectCacheEntry（`13-27`）；setRoot 的 contains 自检 + root.json 落盘 + storage 全局 + openProject 缓存投影 + 二次 dispose 安全（`29-84`）；storageDomain 打开失败降级（`86-106`）。
- **schema.test.ts**：ProjectMeta 合法/坏 slug/stage/时间/title 上限；SLUG_RE；root.json 缺文件/坏 JSON/坏字段钳制；writeRootConfig 合并/原子/roundtrip/无 tmp 残留（`9-95`）。

### 8.3 覆盖缺口（按风险）

1. **`src/index.ts` 零测试**：`grep -rln "src/index.ts" tests` 为空。装配顺序、`reflect.provide`、公告、技能注册、5 工具挂载、agent/created/disposed、审批钩子接线、卸载顺序全部只靠 docs 与人工验收。
2. **HTTP 传输层零测试**：`serveRpcRequest` 未导出、无测试；401/403 栅栏、405、415、413/400 body 上限、endpoint 正则、method≠endpoint、UTF-8 chunk 拼接 bug（§0-5）都没有用例。
3. **`SrwService.writer` 真实装配零测试**：所有 writer 测试都注入假 `run`（`tests/writer-service.test.ts` 等），因此 P0 的“nodeRun 未接线”没有被任何测试发现。
4. **client 零测试**：没有 DOM/组件/协议客户端测试；`workbench.tsx` 的 40 个状态、RPC 信封解包、`sendToCurrentAgent` 两条路径、i18n 全部无回归。
5. **构建产物运行时零测试**：pdfjs worker 路径、pdfkit `#standard-fonts` imports 映射、`lib/index.js` 在真实宿主中的 PDF 抽取/PDF 导出，均未在 tarball/bundle 上跑过；测试都直接 import `src/`。
6. **策略/安全面缺口**：`root.set` 的 config 优先级（§5.1）、`project.remove` 无项目校验（§0-4）、`activeProject` 残留、审批策略“run/resume/写操作豁免”都无用例；`test:security` 只覆盖 `assertInsideRoot` 本身。
7. **多进程/并发**：library/watch STALE 的 TOCTOU、`create` 的 TOCTOU 无并发测试；RateGate 有跨进程锁测试（`tests/rate-gate.test.ts`），但其余存储没有。

---

## 9. 设计亮点 / 风险 / 技术债 / 不一致清单

### 9.1 设计亮点

1. **装配层极小且单点**：domain getter 惰性（`service.ts:79-125`），宿主差异集中在 `host.ts`（ADR-20），RPC/tool 只是薄适配，新增领域不改装配根。
2. **双通道契约是“可执行断言”而非文档**：smoke 的 40+ 断言 + 4 条负例 + tarball 断言，把“双键一致/零运行时导入/peer 全 */9 词白名单”变成机器门（`scripts/smoke-plugin.mjs`）。
3. **fail-closed 路径护栏**：`assertInsideRoot` 能力缺失即抛、resolve→contains 目标对象语义、processPath 还原，配套 `test:security` 的符号链接/`~`/绝对注入负例（`host.ts:86-101`、`tests/security.test.ts`）。
4. **文件即真相源 + 降级不阻断**：项目/库/订阅/精读/论文都在项目目录内，storage 只做索引缓存；`srw_index` 打不开时插件仍可用（`service.ts:136-147`、`tests/store.test.ts:86-106`）。
5. **审批“reason 审计文本 + displayReason 双语”分离**（`tools.ts:41-56`），且 ask 只在 downstream allow 时补（`index.ts:128-134`），不破坏别的策略。
6. **工具结果 lossless 纪律**有回归门（`tools.ts:224-247`、`tests/tools.test.ts:121-199`），把宿主“undefined 丢键”这类隐蔽契约变成测试。
7. **诊断面板 = 宿主能力真值表**（`diag.ts:15-59`），E1–E4 的证据可复现；`diag.contains` 明确“诊断不是护栏”（`service.ts:292-294`）。
8. **G1 门在服务层硬编码**（`writer/outline.ts:120-124` + `writer/service.ts:240-249`），不依赖 UI 自觉；tool 描述也写清“未确认不得写正文”（`tools.ts:561-570`）。

### 9.2 风险 / 技术债（编号供 Lead 汇总）

| ID | 级别 | 结论 | 证据 |
|---|---|---|---|
| R-01 | P0 | TeX runner 未接线，编译功能生产不可用；engine 探测永远全 false | `src/service.ts:118-123`、`src/writer/service.ts:254-258,270,408`、`src/writer/run.ts:8`（无引用） |
| R-02 | P1 | patch `rootDir` 非空时“换根”无效（config 优先） | `src/service.ts:159-164,179-187,248` |
| R-03 | P1 | 换根/删项目不清 `activeProject`/`project_cache` | `src/service.ts:183,198-203,249-250`、`src/workspace/project.ts:106-108` |
| R-04 | P1 | `root.set` containment 恒真 + `remove` 不校验 project.json → 过宽根下误删普通目录 | `src/service.ts:181`、`src/workspace/project.ts:106-108` |
| R-05 | P1 | RPC body 逐 chunk `String()`，多字节 UTF-8 截断 | `src/rpc.ts:163-167` |
| R-06 | P1 | 审批策略与 0102 §8.2/automation 不一致：写操作、run/resume 豁免 | `src/tools.ts:439-459,339-364,604-607`、`0102:453-457`、`../dsh-kylin-automation/src/tools.ts:20-25` |
| R-07 | P1 | 7 视图未落地，单文件 1418 行；i18n 仅 nav | `src/client/workbench.tsx:934-1418`、`src/client/index.tsx:45-51`、`0102:48,496-508` |
| R-08 | P1 | 长任务无 job/轮询、无取消；compile/translate 同步占 HTTP | `src/rpc.ts:198,210`、`0102:733`（ADR-13） |
| R-09 | P2 | 装配/传输/真实 writer 装配/client 零测试；bundle 运行时 shim 未验证 | §8.3 |
| R-10 | P2 | `project.json` 非原子写 + create TOCTOU | `src/workspace/project.ts:62-81,114,131` |
| R-11 | P2 | library/watch STALE 是 check-then-write，无锁、无 mtime/哈希 | `src/literature/library.ts:99-123`、`src/watch/store.ts:48-70`、`0102:264` |
| R-12 | P2 | `writeBinary` 死代码；PDF/文本出口直接 `writeFile`，DSH fs 适配未生效 | `src/host.ts:50-69`、`src/reading/service.ts:99,462`、`src/writer/snapshot.ts:61,115` |
| R-13 | P2 | `settings`/`workspaceRegistry` 未消费仍进 inject；client 的 remote/modelDirectories 未消费 | `src/index.ts:30-41`、`src/client/index.tsx:18-34`、`src/diag.ts:22` |
| R-14 | P2 | root.json 的 `offlineMode/defaultLangPair/allowIllustrative` 无消费；面板无离线开关但错误文案让用户去面板关 | `src/workspace/root.ts:9-23`、`src/literature/service.ts:186`、`src/watch/binding.ts:176`、`workbench.tsx:940` |
| R-15 | P2 | 诊断面（E1 按钮/硬编码绝对路径/diag.schedule 任意会话投递）进生产 | `src/client/view.tsx:137,357-375`、`src/rpc.ts:292-311` |
| R-16 | P2 | CSS 缺类导致徽章/列表无样式 | `src/client/styles.ts:58-61`、`workbench.tsx:1079,1168-1170,1342` |
| R-17 | P3 | 版本号/README/注释/字段命名多处漂移 | `src/service.ts:19`、`package.json:3`、`README.md:14`、`src/index.ts:1-13`、`src/service.ts:64-65` |
| R-18 | P3 | 死代码/未接线能力：budget/recommend/formula、moveSlug、`SRW_*` 未用名 | `src/reading/budget.ts`、`recommend.ts`、`formula.ts`、`project.ts:119-133` |
| R-19 | P3 | 技能路径用 `.pathname`；技能注册失败会阻断激活且泄漏已打开 index | `src/index.ts:78-90` |
| R-20 | P3 | 构建声明 options 手抄 tsconfig；dev-install 默认 p0vibe 与 E2 勘误冲突；smoke:dual 用仓库 manifest 而非 tarball | `scripts/build.mjs:22-41`、`scripts/dev-install.mjs:27-29`、`scripts/smoke-dual-host.mjs:92-97` |

### 9.3 代码 vs 文档的具体不一致（可直接开 issue）

1. 0102 §8.2“写需审批” vs `srw_read`/`srw_paper` 全豁免、`srw_literature.bibtex` 写文件不审批（`0102:453-457` vs `tools.ts:439-459,604-607`）。
2. 0102 §8.2 工具名 `srw_reading` vs 实现 `srw_read`；`ctx.skills.registerProvider`（`0102:466`）vs 实现 `ctx.skills.register`（`skills.ts:12-21,45`）。
3. 0102 §9.2 7 视图 vs 单面板 8 卡；0102 §9.1“右栏硬约束”已实证但产品仍保留 E1 右栏探测代码。
4. 0102 §6.2 磁盘布局 `literature/readings/<citekey>/` + `literature/notes/` vs 实现 `<project>/reading/<paperKey>/`（`src/reading/service.ts:3,67`）与 `<project>/readings/<date>/`（`:458`）；`project.ts:11-19` 创建 `literature/readings` 但实际不用，`reading/readings` 目录靠惰性 mkdir。
5. 0102 §6.3“写前比对 mtime 与内容哈希” vs 实现只比 revision（`library.ts:99-123`、`watch/store.ts:48-70`）。
6. 0102 §3“公告 ≤512 字” vs 实际 644 字符（`index.ts:50`、`0102:109`）。
7. 0201 Task 0.3 要求 smoke 断言 `inject` 纯字符串数组 vs 未实现（`smoke-plugin.mjs:107-110`）。
8. 0201 附三“web profile”/E2“p0vibe 是 headless” vs `dev-install.mjs` 默认 `p0vibe`。
9. 0202 Task 1.0 的 `workspaceRegistry` 用途 vs 实际改用 client workspaces 快照（`0202:58-79` vs `workbench.tsx:316-324`）。
10. README“M2 完成”（`README.md:14`）vs M5 已交付（HEAD commit `d21ad8d`）。
11. `src/index.ts` 头注释“M1 owns … the agent-scoped srw_project tool”（`index.ts:5-7`）vs 实际挂 5 个工具（`index.ts:110`）。
12. `src/service.ts:64-65` 注释“activeProject 不持久 / rootDir 仅来自 patch config” vs `setRoot` 的 `adoptRoot` 与 `indexGlobal` 的 `activeProjectMem`（`service.ts:167-175,185-186`）。

### 9.4 建议的修复顺序（TL;DR）

1. 接上 `nodeRun`（或把 RunPort 作为 `SrwService` 构造参数注入），并为 `SrwService.writer` 加一条“真实装配”测试；同时把面板的“无引擎”提示改为基于 probe 结果而非默认失败。
2. 修 `root.set` 语义：明确“config 只作初始值”，setRoot 后应以 storage 为权威（或写回 config/提示需改 patch）；同时清 `activeProject` 与 `project_cache` 的失效条目。
3. 给 `project.remove` 加 `.srw/project.json` 校验；`root.set` 增加“不允许文件系统根/不允许 home 等过宽目录”的显式守卫（至少拒绝 `parse(path).root === path`）。
4. RPC body 改 `Buffer.concat` 或 `req.setEncoding('utf8')`，补 transport 单测（401/405/415/413/UTF-8/endpoint）。
5. 审批矩阵与 0102 对齐（或明确把 0102 改成“IO 工具豁免、门在服务层”），至少把 `watch.resume`、`literature.bibtex`、`paper.snapshot.restore`、`read.translate` 纳入 ask 评估。
6. 补 `srw-list/srw-item/.srw-badge.bad` 样式；移除/隔离 DiagView 与硬编码路径；i18n 至少覆盖面板标题/按钮/设置页。
7. 把 smoke:dual 的契约断言改为对 tarball 内 manifest/产物执行，并把 `skills/**`、`pdf.worker.mjs`、fonts 纳入必需文件断言；补 `SRW_VERSION` 与 package.json 一致性断言。
8. 明确“版本/产物”发布纪律：`pnpm check` 增加 `smoke:dual`（或 CI），并修 `dev-install` 默认 profile。
