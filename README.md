# dsh-kylin-srw

**科研工作台插件（Scientific Research Workbench）** —— 面向 **DeepSeek Harness（dsh）** 与 **麒麟（QiLin）** 双通道的单包插件。

目标能力（用户需求原文口径）：

- 可配置**科研总根目录**，在子路径下开展多个研究项目；
- 利用引擎**自动化任务定期抓取**相关论文；
- **全流程**论文撰写/修改，按发表刊物**分级**完成不同深度的论文；
- 论文**精读**，含**双语逐段对照**；
- 论文用到的**插图、公式、伪代码、数据**按需生成，且**实事求是**（可溯源）；
- 连接**具备 GPU 的远程服务器**，按论文实验设计完成实验。

当前状态（2026-10-19，main 已推送 origin；本轮主体提交 166a07b，8513272 为其 amend 前身；CI 修复跟进 167f1ce/7772425）：

- **论文线**：M0–M5 已交付；M5 接线修复并真引擎验收（tectonic 出 PDF、引用解析、越界 GATE、快照回滚）。
- **M6 素材证明链 core**：五类确定性生成器、verify 复算（mismatch 阻断）、insert G-M1、数字宏与裸数字审计、编译前 ARTIFACT_DRIFT。
- **M7 实验与算力 MVP**：单主机 SSH ①③ 级（ControlMaster 复用/直连）、7 态生命周期、日志偏移续读、指标/产物归集、registry/claims/gaps；真机 RTX 4090 E2E 通过。
- **M9-lite 专利**：公开时序门（safe/grace/risk/blocked）+ 技术交底书 skeleton；先申请后公开，投稿前必查。
- **查论文 P0**：身份迁移、Unpaywall/OA 全文、检索计划与离线重放、DOI 校验与撤稿门、批量精读断点续跑。
- 质量门：typecheck 0；**272 测试全绿**（含真引擎 writer-real 与真机 compute-real；无外部依赖时自动 skip）；smoke ALL PASS；CI 已接线（ubuntu+fonts-noto-cjk，首跑三红已修，实录见 docs/05-handoff/01-进度记录.md §1.8）。
- 未做：M8 投稿返修、UI 面板、专利完整版（检索/权利要求/形式检查/导出）、查论文 P1（引文网络/筛选/综述）。
- 版本 0.0.1（未 tag）；已推送 origin/main（后续 M8 计划已立 docs/02-plan/0207-M8-投稿与返修.md）；发布步骤见 docs/05-handoff/02-交接记录.md §7。

## 文档索引

| 文档 | 内容 |
|---|---|
| [0101 同类插件与竞品调研](docs/01-tech/0101-同类插件与竞品调研.md) | 13,217 条插件目录实测扫面；头号对手 `dsh-mimir` 深度拆解；相邻插件地图（可复用 vs 需超越）；双语精读/素材真实性/GPU 编排的机制借鉴；宿主能力盘点；本机可行性实测；差异化定位与 10 项拍板口径。**文末含勘误表**（§5 有 4 处由 0102 复核修订） |
| [0102 技术架构](docs/01-tech/0102-技术架构.md) | 需求→能力→验收追溯矩阵；双通道契约（双键回落语义 / 零运行时导入 / 9 个可 require 模块）；领域模型与磁盘布局（**文件是真相源**）；**三把尖刀机制**（段落锚定双语精读产物 / 素材证明链 / 刊物分级 schema + D1–D3 深度档）；7 视图 UI 与**右栏硬约束**；两条调度车道（`ctx.schedule` 只投递，派发用 `agents.create`）；远程 GPU 三级复用链；安全红线；**20 条 ADR**；风险与 Phase 0；宿主能力面速查 |
| [0201 实施计划](docs/02-plan/0201-实施计划.md) | 执行约定；M0–M8 里程碑（目标/任务/文件/验收/DoD/粗估）；M0 的 bite-sized 详细任务；`pnpm` 质量门与验证矩阵；7 个端到端验收场景；发布与分发链；风险登记；工时总表（75–114 人日）；**附二：宿主事实核对对计划的逐条影响**；**附三：M0 实测回改（8 条）** |
| [0202 M1 详细计划](docs/02-plan/0202-M1-工作区与项目.md) | Task 1.0–1.7 bite-sized（注入面验证矩阵 / root.json + settings.section 转正 / workspace 模块 / srw_index v1 / R2 端点 / 工作台视图 / srw_project 工具）；M1 验收 7 断言；settings.register 走 V15 后置的决策记录 |
| [0203 M2 详细计划](docs/02-plan/0203-M2-文献通路.md) | RateGate / 三源适配 / 去重 / library.json / PDF+SSRF / BibTeX / 撤稿 / 文献视图+工具；**已完成**，文末「M2 实施实录」含 9 条真网/实测勘误（含 lossless 工具输出、元数据自愈、跨源身份折叠） |
| [0204 M3 计划](docs/02-plan/0204-M3-定期抓取.md) | 订阅抓取（触发绑宿主内置「自动化任务」ctx.schedule，执行=host 确定性代码）/ .srw/watch.json / srw_watch 工具 / 撤稿类型区分（corrigendum≠retraction）；**已完成**，文末「M3 实施实录」含 Cordis 围栏等 4 条勘误 |
| [0205 M4 计划](docs/02-plan/0205-M4-精读.md) | 精读（R6 尖刀）：pdfjs 抽取/双栏识别/source_map 稳定块 ID/翻译链（llm.stream+并发闸）/哈希缓存+术语表/paper.md+校验门/精读视图；**已完成**，文末「M4 实施实录」含活体验收（vaswani 真 PDF 端到端全绿）、按日期归档 PDF（readings/<date>/）、**译注版改造**（版面杂讯/图内碎片/参考文献分类、全文导读+每节速览/精读备注、译注版 PDF 结构）与 3 条勘误 |
| [0206 M5 计划](docs/02-plan/0206-M5-论文线.md) | 论文线与刊物分级（R4/R5）：TeX 引擎探测（全缺不炸）/venue schema+注册表（confidence+sources 强制）/深度档 D1-D3 三落点/机读合规 checks/骨架生成/编译+日志解析（79 列折行回接）/大纲 G1 确认门/引用审计+一键补 BibTeX/快照回滚（哈希防线）/srw_paper 工具/论文视图/技能 paper-drafting·venue-fit；**已完成**（真引擎活体待装 tectonic 后补验） |
| [0207 M8 计划](docs/02-plan/0207-M8-投稿与返修.md) | 投稿与返修：快照标签+Myers diff（零依赖）/审稿意见→响应信（RESPONSE_UNBACKED 证据门）/cover letter·highlights·declarations/format.check 激活 venue 四死字段/submission.pack D1–D3 落点；任务 8.1–8.8 bite-sized + **落地前代码事实核对**（srw_paper 15 动作/paper.* 11 case/死字段零消费者实测） |
| [05-handoff 进度记录](docs/05-handoff/01-进度记录.md) | 2026-10-18–19 批次日志、质量门演进、真验收记录、事件复盘、明确未做清单 |
| [05-handoff 交接记录](docs/05-handoff/02-交接记录.md) | 上手/环境事实/验证命令/代码地图/数据契约/已知缺口/风险红线/提交与发布指引 |

## 定位（一句话）

> 不做第二个 Mimir。做**双通道的、可溯源的**科研工作台：**读**（逐段双语精读，产物可 diff 可校验）+ **写**（按刊物分级的论文生产线）+ **证**（每个图/表/数字/公式都能指回真实产物），算力复用引擎能力与你已有的两台 GPU 主机。

## 调研要点

- dsh 插件生态 ✅ 实测 **13,217** 个可装包；科研相关工作台**只有 `dsh-mimir` 一个**（542★，33 天 27 版），其余为单点插件。
- `dsh-mimir@0.21.0` ✅ **只有 `dsh` 键、无 `qilin` 键** → 麒麟通道不挂载其界面；**双通道是结构性空档**。
- 差异化的两把尖刀：**段落锚定 + 可溯源的双语精读产物**；**素材/实验数字的真实性证明链**（伪代码生成 ✅ 0 竞品，公式验证门 ◐ 业界普遍未做）。
- 宿主已提供：工作区注册表、原生目录选择器、UI 插槽、`ctx.settings`、`ctx.storageDomain`、`ctx.schedule`、`ctx.llm` + 当前模型选择、`ctx.web` + 代理、`ctx.ssh` 家族。

## 架构复核后的四条关键修正（0102 相对 0101 的实质推进）

| # | 上一轮的判断 | 复核后的结论（均有一手证据） |
|---|---|---|
| 1 | 「用 `ctx.schedule` 做定期任务派发」 | ❌ 它**只把消息投递进既有会话**（`sessionId` 必填、投递时恢复该会话的 agent），**不能新建根 agent**，且不补发 → 确定性抓取走自建时钟，派发用 `ctx.agents.withoutInitiator(agents.create)` + `followup` |
| 2 | 「复用引擎 `ctx.ssh` 连你的 GPU 主机」 | ⚠️ `ctx.ssh` 是**单主机 + 单租约 + 部署拥有配置**的通道，**不是主机注册表**；多主机事实标准在 `dsh-ssh-remote` 的 `hosts.json`，而它**不暴露 ctx 服务** → 改为三级链：ControlMaster 复用 → `ctx.tools.execute('ssh_run')` → 直连；**永不解密它的凭据** |
| 3 | 「`resolveWorkspacePath` 作安全拼接」 | ❌ 它**没有 containment 校验**，不能当护栏 → 改为 `ctx.fs.contains`（canonical containment）+ SSRF 三步 + `ctx.credentials` |
| 4 | 「宿主有主机侧 PDF 抽取/限速器」 | ❌ 都没有：PDF 只有浏览器侧 `pdfjs-dist`，限速/重试/并发/`llm.complete` 宿主全缺 → 自带 `pdfjs-dist`（legacy Node build，取坐标做分栏与 bbox 锚定）、自建 `RateGate`（跨进程用 `withFileLock`）与并发闸 |
