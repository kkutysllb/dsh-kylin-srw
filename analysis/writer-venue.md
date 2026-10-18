# dsh-kylin-srw 论文线（writer/venue）深度分析

> 范围：`src/writer/*.ts`（9 文件 1057 行）、`src/venue/*.ts`（4 文件 404 行）、`src/skills.ts` + `skills/`、
> `tests/writer-*.test.ts` + `tests/venue-depth.test.ts`、`docs/02-plan/0206-M5-论文线.md`（全文）、
> `docs/01-tech/0102-技术架构.md` §7.2/§7.3/§8/§9.2/§13。只读分析；唯一产物本文件。
>
> 运行时事实（实测）：`tectonic/latexmk/xelatex/pdflatex/lualatex` 本机**全部 MISSING**；
> `npm run typecheck` 通过；M5 测试 **21/21 通过**（writer-core 11、writer-service 3、venue-depth 7）。
> 未验证处明确标注；不推测。

## 0. 结论摘要

1. **结构正确**：writer 编排 + venue 纯数据/纯函数，依赖方向 `writer → venue → core` 单向（0206:18）；
   LLM 生成全走 agent 车道，插件内零私有 LLM 调用（`service.ts:6-8`）。
2. **P0 · 生产装配缺 `RunPort`**：`src/service.ts:118-122` 构造 `WriterService` 只传 `fs/rootDir/libraryEntry`，
   **没传 `run`**；`nodeRun`（`run.ts:8`）从未被 src 代码 import。→ 探测撞上 `throwNoRunner`
   （`service.ts:256,408-410`）→ 永远「四引擎全缺」→ `compile` 恒 `ENGINE_MISSING`，
   **装好 tectonic 也不会生效**。`lib/index.js` 里 `child_process` 出现 0 次，发布产物无进程执行能力。
3. **P0 · `main.tex` 的 `\input` 与 outline 脱钩**：骨架写死的输入清单（`scaffold.ts:70`）之后永不重写，
   而 `outline.save` 另按 agent 标题分配文件（`service.ts:182-207`）。标题与 `sectionOrder` 不完全同名时，
   正文写进**不被编译**的文件、编译进空占位节——编译「成功」但静默丢节（实测复现 §7.2-F3）。
4. **P1 · `build/` 落点与真实 TeX 不符**：命令无 `-output-directory`（`engine.ts:37-47`），cwd 是 `paper/`
   （`service.ts:270`），真实引擎把 PDF 写在 `paper/`；代码只认 `paper/build/main.pdf`
   （`service.ts:272,396`；`snapshot.ts:37`）→ `pdfWritten` 恒 false、快照永不含 PDF、面板恒「无产物」。
   测试假引擎直接写 `build/main.pdf`（`writer-service.test.ts:54-56`），恰好掩盖了这一点。
5. **P1 · 快照回滚绕过路径护栏**：`snapshot.ts:95-129` 用 `node:fs` 按 manifest 路径键读写，无包含性校验；
   篡改 manifest 即可越界写（已实测写到 `paper/..`）。与 `service.ts:5` 的护栏宣称矛盾。
6. **G1 是状态机门，不是审批门**：门只硬编码在 `sectionWrite`（`service.ts:243`）；`outline.confirm` 是
   agent 可自由调用的 action，`srw_paper` 全部动作豁免审批（`tools.ts:104-108` 的 `ASK_TABLE` 无此工具）。
   「用户点头」靠 SKILL 纪律（`paper-drafting/SKILL.md:15`）+ 面板按钮，不是宿主 approval。
7. **venue 诚实性三件套是亮点**：`unverified + sources 强制`（`types.ts:54-64`）、`unverified → 全 warn`
   （`compliance.ts:53`）、`pass: undefined`（事实缺失≠不通过，`compliance.ts:34-38`）。
8. **i18n 缺口**：声明只认英文 label（`service.ts:367`、`compliance.ts:115-122`），`cn-journal` 的 D3
   声明项结构性永远「缺」（`registry.ts:85`）；`\appendix` 同理。
9. **测试「假引擎很全、真引擎为零、对外接口为零」**：79 列回接/括号栈/l.N/哈希回滚全走过，但
   `srw_paper` 工具与 `paper.*` RPC 无一测试（§6）。
10. **文档-代码漂移 8 处**（§7.4），其中「12 端点 vs 实 13」「`outline.generate` vs `outline.prompt`」属描述偏差；
    「project.json 增补 venueId/depthTier」属未实现。

## 1. 模块地图与职责

| 文件 | 行 | 职责 | 导出 API / 类型 |
|---|---|---|---|
| `src/writer/service.ts` | 415 | 论文线编排：venue 实例、骨架、G1、节写、编译+快照、引用审计、refs 追加、合规、状态 | `WriterService`（16 公开方法）、`VenueInstance`、`PaperState`、`WriterDeps` |
| `src/writer/outline.ts` | 139 | 大纲一级真相源 + G1 状态机 + 分档提示词（纯函数，I/O 在服务层） | `Outline`、`OutlineSection`、`OutlineStatus`、`emptyOutline`、`parseOutline`、`serializeOutline`、`confirmOutline`、`draftOutline`、`assertConfirmed`、`outlinePrompt` |
| `src/writer/scaffold.ts` | 100 | 按 venue schema 渲染 `main.tex` + `sections/*.tex` + `refs.bib` 占位 | `ScaffoldPlan`、`renderScaffold` |
| `src/writer/compile.ts` | 69 | 命令装配 → spawn → 多轮重跑 → 日志解析 | `CompileOutcome`、`compilePaper`、`fallbackError` |
| `src/writer/texlog.ts` | 98 | 日志 → 结构化错误：79 列折行回接、括号文件栈、`l.<n>` | `TeXError`、`ParsedTeXLog`、`refold`、`parseTeXLog` |
| `src/writer/cite-audit.ts` | 46 | `\cite`/`\nocite` vs refs.bib 差集（纯函数） | `CiteAudit`、`extractCiteKeys`、`auditCites` |
| `src/writer/snapshot.ts` | 130 | 编译成功留档（sha256）+ 回滚校验 + 陈旧节清理 | `SnapshotManifest`、`SnapshotInfo`、`createSnapshot`、`listSnapshots`、`restoreSnapshot` |
| `src/writer/engine.ts` | 48 | 4 引擎逐个 `--version`（3s）+ 命令装配 + `RunPort` 契约 | `TeXEngine`、`ENGINE_ORDER`、`RunPort`、`EngineProbeResult`、`probeEngines`、`compileCommand` |
| `src/writer/run.ts` | 22 | 真实 runner（`execFile` + timeout + 32MB buffer） | `nodeRun`（**无人引用**） |
| `src/venue/types.ts` | 104 | venue schema + 手写校验（宿主无 zod/ajv） | `VenueSchema`、`VenueSource`、`DepthTier`、`StatementKind`、`ReferenceStyle`、`validateVenue` |
| `src/venue/registry.ts` | 107 | 4 个种子刊物（IEEE/ACM/LNCS/中文），惰性校验+缓存 | `listVenues`、`getVenue` |
| `src/venue/depth.ts` | 71 | D1/D2/D3 阈值表 + 实验检查清单 | `DepthProfile`、`DEPTH_PROFILES`、`experimentsChecklist` |
| `src/venue/compliance.ts` | 122 | 档位+刊物 → 机读 `checks[]` | `ComplianceLevel`、`ComplianceFacts`、`ComplianceCheck`、`runCompliance`、`STATEMENT_LABELS` |
| `src/skills.ts` | 63 | manifest → SKILL.md → `ctx.skills.register` | `SrwSkillsService`、`stripFrontmatter`、`registerBundledSkills` |
| `skills/manifest.json` | 28 | 4 技能清单 | — |
| `skills/{research-idea,literature-triage,paper-drafting,venue-fit}/SKILL.md` | 25/27/33/26 | 技能正文（frontmatter + 工作流 + 红线） | — |

**装配与依赖**（`src/service.ts:113-125`）：`tools.ts srwPaperToolDef` / `rpc.ts paper.*|venue.*` → `SrwService.writer`
→ `WriterService`（deps: `fs / rootDir / libraryEntry`）；`writer/*` 只被 service 调用；
跨域复用仅 `literature/bibtex`（`extractCitekeys` / `toBibtex`）；venue 层不依赖 writer。
磁盘域（`service.ts:64-98`）：`<root>/<project>/paper/{main.tex,refs.bib,sections/,build/,snapshots/}` +
`.srw/{venue.json,outline.json}`，**全部显式带 project**。

## 2. 端到端流水线

**入口**：agent 车道 `srw_paper`（`tools.ts:459-599`，15 action，只做参数整形+错误信封）；
面板车道 RPC `paper.*/venue.*`（`rpc.ts:388-448`），客户端消费见 `workbench.tsx:760-900,1286-1380`。
两车道写同一份磁盘（ADR-3 文件即真相源），无第二套状态。

**2.1 venue**：`venueApply`（`service.ts:106-119`）校验 id（`NOT_FOUND`）→ 落 `.srw/venue.json`
`{schemaVersion:1,venueId,tier: tier??venue.depthTier,appliedAt}`；tier 可被调用方覆盖（`tools.ts:473`）。
`venueOf`（`service.ts:121-139`）宽容解析，坏数据/非法 tier → `undefined`（视作未应用，见 F9）。

**2.2 depth 三落点**（`depth.ts:26-71`）：① 阈值表供 compliance；② `outlinePrompt` 把
`sectionOrder` 最少节数、Related Work 要求、页数区间写进提示词（`outline.ts:127-139`）；
③ `experimentsChecklist` 供 M7（**当前只有测试调用**）。档位实际来源是 `.srw/venue.json.tier`，
不是 `project.json.depthTier`（`core/schema.ts:14` 有字段但 writer 不读；`compliance.ts:47` 注释称取 project.json → 漂移 D8）。

**2.3 scaffold**（`service.ts:145-165`）：前置必须已 apply（`INVALID`）且 `main.tex` 不存在
（**拒绝覆盖写作现场**，`:150-153`）。`renderScaffold`（`scaffold.ts:39-92`）：documentclass/classOptions；
宏包单链 algorithm/algorithmic/booktabs/tikz/pgfplots（`:47-55`，ADR-12 的 M5 部分）；`lang=zh` 走 `ctexart`；
`\input{sections/<nn>-<slug>}`（**:70 冻结点**）；`\bibliographystyle{bibStyle}` + `\bibliography{refs}`（`:72-73`）；
每节占位 + `refs.bib` 注释行（`:78-86`）。同时落草稿大纲 `emptyOutline(sectionOrder)`（`service.ts:162-163`）——
`emptyOutline` **不分配 `file`**（`outline.ts:34-47`），F5 的直接成因。

**2.4 outline/G1**：`outlineGet`=读+严格 `parseOutline`（坏数据 `INVALID`，`outline.ts:50-87`）。
`outlineSave`（`service.ts:177-209`）：整体置 draft、**revision 保持**；id=`s${i+1}`；同名标题沿用旧 `file`，
否则 `sections/<nn>-<slug>`（`:182-192,412-415`）；新文件写 `\section` 占位，已有文件不动（`:201-207`）。
`outlineConfirm`（`outline.ts:95-106`）：已确认且节全 confirmed → 幂等；否则 confirmed + `confirmedAt` +
**revision+1** + 节全 confirmed。`outlinePromptFor`（`service.ts:221-237`）只出提示词，topic 取
`.srw/project.json.title`（坏 JSON 回落 slug，`:230`）。`draftOutline`（`outline.ts:109-117`）**全仓无调用**（X5）。

**2.5 sectionWrite**（`service.ts:240-250`）：大纲存在（`NOT_FOUND`）→ `assertConfirmed`（`GATE`）→
节存在（`NOT_FOUND`）→ 必须已绑定 `file`（`INVALID`，`:246`）→ guard 写盘，返回 `{file,bytes}`；
工具层另拒空 `tex`（`tools.ts:511-512`）。

**2.6 compile**（`service.ts:261-279`）：`engineOf()` 首探后**永久缓存**（`:254-259`）→ 无引擎
`ENGINE_MISSING`（含 brew 引导，`:264`）→ 无 `main.tex` `NOT_FOUND` → `compilePaper({engine,entry:'main.tex',
run,cwd:paper/})` → 无论成败写 `build/main.log`（`:271`）→ 查 `build/main.pdf`（`:272,281-284`）→
**仅成功**留快照（`:274-277`）。`compilePaper`（`compile.ts:24-62`）：`maxReruns=2`；成功 `log=stdout+stderr`，
失败 `log=error.message`（`run.ts:14-17` 已拼 `exit N+stdout+stderr`）；含
`/Rerun to get|Label\(s\) may have changed/` 才重跑（`:19-22,50-51`）；单轮 300s（`:42`）。

**2.7 日志解析**（`texlog.ts:49-97`）：**79 列回接**（`:31-43`）——被消费的**原始段**恰好 79 列才继续拼下一行，
判据是原始段长不是合并结果长（0206:95-99 记录了首版踩坑）；**括号栈**（`:45,58-65`）——`FILE_OPEN_RE` 抓
`(...tex|bib|sty|cls|...)` 入栈，行首/空格后裸 `)` 出栈且**每行最多弹 2 层**（防嵌套 sty 清空栈）；
**错误块**（`:66-95`）——`/^!/` 起块，`code` 归一为冒号前或无冒号首句，`l.<n>` 只在**后 6 行**找，
文件优先 `path:line:` 形态否则栈顶，`message` 截 500；Warning 归集 `(LaTeX|Package|Class|pdfTeX).*Warning`
或 `Overfull \hbox`（`:93-95`）。解析不出 file/line 就留空，不编造（`:47-48`）。

**2.8 citeAudit**（`service.ts:311-316`）：`texFiles`（`main.tex`+`sections/*.tex`，`:296-309`）+ `refs.bib`
（缺失按空）→ `auditCites`（`cite-audit.ts:34-46`）求 `missing`（编译出 `?`）/`unused`/`nociteAll`。
`extractCiteKeys` 支持 `\cite{a,b}`、`\cite[p.5]{a}`、`\nocite{c}`、`\nocite{*}`，键去重（`:8-24`）；
**只认 `\cite/\nocite`**，不认 `\citep/\citet/\autocite`（§7.3）。

**2.9 refsAppend**（`service.ts:319-347`）：`refs.bib` 必须存在（`NOT_FOUND`）→ `extractCitekeys` 去重
（`skippedExisting`）→ 经 `deps.libraryEntry`（装配为 `literature.entry`，`src/service.ts:121`）取条目，
取不到记 `missing` → `toBibtex`（`literature/bibtex.ts:52-68`）渲染后整体追加。不覆盖已有条目；
**无** G-M3 引用门（DOI/撤稿校验，0102:375，属 M6/verify 域）。

**2.10 snapshot/rollback**（`snapshot.ts`）：`createSnapshot` 收集 `main.tex/refs.bib/sections/*.tex/build/main.pdf`
（存在才带）→ `id`=ISO 时间戳换 `: .` 为 `-`（`:47`）→ manifest 记每文件 sha256+engine+compileMs →
`paper/snapshots/<id>/`（`:42-66`）。`restoreSnapshot` 逐文件回读哈希比对，不一致 `CORRUPT`（`:95-129`），
随后**删除快照外的 `sections/*.tex`** 并用 `-` 前缀报告（`:119-128`）。`listSnapshots` 坏 manifest 跳过、id 倒序（`:75-92`）。

**2.11 compliance**（`service.ts:351-371`）：venue 必须已 apply → 从磁盘收 facts：`pages` 从 `build/main.log`
正则 `/Output written on [^(]*\((\d+) pages?/`（`:360`）、`sections` 抓 `\section*?{...}`、图/表数环境、
`referenceCount`=bib key 数、`statementsPresent` 找英文 label、`hasAppendix`=`\appendix` →
`runCompliance({venue,tier:instance.tier,facts})`（`compliance.ts:45-113`）。

**时序**（关键点已标缺陷）：
```
venue.apply → .srw/venue.json
scaffold → main.tex（冻结 \input 清单 ←F3）+ sections 占位 + outline.json(draft, 无 file ←F5)
outline.prompt → agent 拟稿 → outline.save（重分配 sections 名，可能与 \input 不一致 ←F3）
outline.confirm（G1: revision+1）→ section.write（唯一 G1 校验点）→ compile
compile → probe ←F1 → spawn(cwd=paper) → build/main.log；PDF 在 paper/ 而非 build/ ←F2
        └ 成功 → snapshot（无 PDF）→ cite.audit → refs.append → compliance（unverified 全 warn）
```
端到端实测（假引擎注入的服务实例，同 `writer-service.test.ts:72-145`）：apply→scaffold→G1 拒→save→confirm→
写节→编译失败带行号→修复→成功留快照→改坏→restore 复原，**全通过**；`ENGINE_MISSING` 路径按设计返回引导。
唯一真机环节（真引擎→真 PDF→真日志）本机无引擎，**未验证**。

## 3. 关键不变量与门禁

### 3.1 G1 状态机（`outline.ts:95-124`；门在 `service.ts:243`）
| 事件 | status | revision | sections[].status | 备注 |
|---|---|---|---|---|
| `scaffold` | draft | 0 | draft | 节来自 sectionOrder；**无 file** |
| `outlineSave` | draft | 保持 | draft | 改了就作废旧确认；file 按标题复用/新分配 |
| `outlineConfirm`（首次） | confirmed | **+1** | confirmed | 落 `confirmedAt` |
| `outlineConfirm`（幂等） | confirmed | 不变 | confirmed | 已确认且节全 confirmed |
| `outlineSave`（确认后再改） | draft | 保持 | draft | 需重新 confirm 才再 +1 |

- **被拦的写只有 `sectionWrite`**（`GATE`）。`outlineSave`/`refsAppend`/骨架期占位写/`compile` 均不受 G1 限制。
- **不是审批门**：`outline.confirm` 是普通 action，`srw_paper` 不进 `ASK_TABLE`（`tools.ts:104-108`）
  → agent 可自行确认；用户确认只靠 SKILL 纪律（`paper-drafting/SKILL.md:15,31`）与面板按钮
  （`workbench.tsx:1316`）。准确表述：**G1 = 状态机 + 纪律，不是宿主审批门**。
- **不覆盖文件系统**：agent 若经宿主文件工具直写 `paper/sections/*.tex`，服务层无从阻止——
  门只在 `srw_paper` API 粒度成立。

### 3.2 snapshot 哈希防线与回滚规则
只在编译成功后留档（`service.ts:274`，失败不留：`writer-service.test.ts:122`）；manifest 逐文件 sha256
（`snapshot.ts:53`）；restore 先比哈希再写盘，坏/缺档 `CORRUPT`（`:97-108`）；回滚删除快照外节文件
（`:119-128`）→ 是「集合对齐」不是「增量覆盖」。**不覆盖** `.srw/outline.json`、`venue.json`、`figs/`
→ 可能状态撕裂（F10）。

### 3.3 venue schema（`types.ts:44-104`）
手写校验（宿主无 zod/ajv，`:43`）：必填字段；`sources` 非空且每项 `url+checkedAt`（`:54-62`）；
`confidence/columns/depthTier/bibTool/lang` 枚举守卫；`pageLimit/abstractWords/figureDpi` 可选。
4 个种子**全部 `unverified`**（`registry.ts:9-93`），惰性校验（`:95-103`），坏数据首次访问即抛。

### 3.4 深度阈值表（`depth.ts:26-57`，对齐 0102:407-415）
| 维度 | D1 | D2 | D3 |
|---|---|---|---|
| 篇幅 | 4–6 | 8–10 | 12–20 |
| 节数 | ≥4（可略 Related Work） | ≥6（必须） | ≥7（必须，可附录） |
| 实验 | 1 数据集/2 基线/1 种子 | 2/4/1+消融 | 3/6/3+消融+显著性+成本 |
| 图 / 表 | 2–3 / 1 | 5–8 / 3–5 | 8–15 / 5–10 |
| 文献 | 20–30 | 40–60 | 60–120 |
| 声明 | 无 | data/code/limitations | +COI/ethics/authorContributions |
| 复现 | 脚本 | +种子/环境 | +容器/硬件/统计脚本 |

### 3.5 compliance 语义（`compliance.ts:34-38,45-113`）
每条 `{id,level,pass,actual,expected,where}`；**`pass=undefined`=事实缺失，不算不过**（`pages` 未编译，`:56-63`）；
`level` 仅 `error|warn`，`errorWhenFail = confidence==='verified'`（`:53`）。注意 `check()` 对**通过项也返回
`level:'warn'`**（`:37`）→ `level` 不能当严重度读，客户端须结合 `pass`（面板已如此，`workbench.tsx:1367`）。
顺序固定：篇幅→必备章节→Related Work(D2/D3)→声明→图→表→文献→附录（`:44,56-110`）；
声明集优先 venue，空则回落档位（`:74-76`）；附录项只在「不允许且有」时出现（`:108-110`）。

### 3.6 引擎探测与降级（`engine.ts:20-47`）
序 `tectonic→latexmk→xelatex→pdflatex`（`:9`），逐个 `--version`（3s），返回首个可用+全表；**全缺不抛**。
命令：tectonic `main.tex`；latexmk `-pdf -interaction=nonstopmode -halt-on-error`；
xelatex/pdflatex `-interaction=nonstopmode`（`:37-47`）。重跑 ≤2（`compile.ts:33,50-51`）。
降级：`ENGINE_MISSING` + 安装引导；面板据 `state.engine.engine===undefined` 出提示
（`workbench.tsx:1289-1290`）——**但受 F1 影响该判断生产恒为「无引擎」**。

### 3.7 其他不变量
slug `^[a-z0-9][a-z0-9-]{0,63}$`（`core/schema.ts:19`，入口校验 `service.ts:65`）；
所有服务内读写先 `guard`→`assertInsideRoot`（`service.ts:73-90`，canonical 包含，能力缺失 fail-closed，
host.ts:85-105）——**snapshot 模块例外**（F4）；`main.tex` 存在即拒重新骨架（`:150-153`）；
`outline.save` 不覆盖已有节文件（`:204`）；引擎探测缓存无 TTL，`resetEngineCache` 仅测试（`:403-405`）。

## 4. 失败模式与降级

| 失败 | 触发点 | 现行为 | 评价 |
|---|---|---|---|
| 无 TeX 引擎 | `service.ts:262-265` | `ENGINE_MISSING` + brew 引导；state 全表 false | 语义对，但 F1 使其恒真 |
| 无 `RunPort`（生产） | `service.ts:256,408-410` | 探测逐个 catch → 全 unavailable | **F1：装配缺失伪装成引擎缺失** |
| 编译失败 | `compile.ts:45-49` | ok=false，log=error.message，errors[] 解析；日志仍落盘 | 合理；`fallbackError` 无生产调用 |
| 日志畸形/空 | `texlog.ts:49-97` | errors 可能为空（无兜底） | 面板会「编译失败但 0 错误」 |
| 79 列误接 | `texlog.ts:31-43` | 恰好 79 列的非折行并入下一行 | **F6：可吞掉下一条 `!`（已复现）** |
| `l.N` 距首行 >6 行 | `texlog.ts:75-85` | 行号留空或错误归到后一条 `!` | `File not found` 丢行号（已复现 F7） |
| 引用缺失 | `cite-audit.ts:43` | 列 `missing` 不阻断；refsAppend 无条目记 `missing` | 符合「不编造」 |
| 快照损坏/不存在 | `snapshot.ts:97-108` | `CORRUPT` / `NOT_FOUND`，拒绝恢复 | 正确（不静默恢复脏数据） |
| 回滚与大纲不一致 | `snapshot.ts:24-40` | 只恢复 tex/bib/pdf，`.srw/*` 不动 | 潜在撕裂（F10） |
| `venue.json` 坏 | `service.ts:121-139` | 当「未应用」→ 报「先应用刊物」 | 掩盖损坏（F9） |
| `outline.json` 坏 | `outline.ts:50-87` | `INVALID`，无备份/修复路径 | 诚实但不可恢复 |
| 路径越界 | `host.ts:92-104` | `PathSafetyError`（非 ServiceError）→ RPC/tool `internal` | 错误码 taxonomy 失真（X3） |
| 根未设置/slug 非法 | `service.ts:60,65` | `NO_ROOT` / `INVALID` | 正确 |

## 5. 技能层

**注册**（`src/skills.ts` + `index.ts:75-92`）：激活时从 `import.meta.url` 推 `pluginRoot`
（`lib/`、`src/`、包根三候选，取存在 `skills/manifest.json` 者，`index.ts:80-88`）→
读 manifest → 逐个读 `SKILL.md` → `stripFrontmatter`（剥 `---` 围栏，`skills.ts:31-36`）→
`ctx.skills.register({name,description,whenToUse?,source:'runtime',content,resourceBase:{kind:'directory',path:dir}})`
→ 返回组合 disposer（逐个 try/catch，`skills.ts:54-62`）。`skills` 服务缺席则跳过注册（`index.ts:77`），
不影响其余功能；manifest 坏 JSON 无 catch → 激活期抛错（小健壮性问题）。

| 技能 | 目标 | 用到的工具 | 与门/纪律的关系 |
|---|---|---|---|
| `research-idea` | 模糊想法 → 可评审选题卡（问题/假设/证据/缺口/实验草图/风险） | `srw_project`（成形后登记）；文献工具「若有」 | 无硬门；一次只追问最关键一项；置信度显式标注 |
| `literature-triage` | 线索 → arXiv/OpenAlex/Crossref 检索 → 筛选 → 入库 | `srw_literature` search/import | 入库前确认；不虚构 DOI；审批被拒不重试 |
| `paper-drafting` | 按 D1/D2/D3 起草大纲与正文 | `srw_paper` state/outline.prompt/outline.save/outline.confirm/section.write/compile/cite.audit/refs.append/compliance | **G1 纪律**（SKILL.md:15,31）；无来源写 `[TODO: 待实验数据]`（:18）；编译最多自修 3 轮（:33） |
| `venue-fit` | 现状盘点 → 刊物事实 → 合规核查 → 整改路径 | `srw_paper` state/compliance、`venue.list` | 三组汇报（阻断/建议/缺失）；`unverified` 必须声明「未核定」；不许说「不通过就投不了」 |

交互要点：技能**不直接调服务**，只规定「用哪个 tool + 顺序 + 红线」；强制力在服务层（G1）与工具层（参数校验）。
技能里的 action 名与实现一致（`outline.prompt/compliance/cite.audit/refs.append` 均存在，`tools.ts:576`），
仅 `paper-drafting/SKILL.md:14` 把 `venue.list` 写成裸 action（实际 `srw_paper {action:'venue.list'}`），表述问题。
缺口：0102:466 规划的 8 技能中 `close-reading/materials-proof/experiment-design/repro-audit` 未落地（分期，不算缺陷）。

## 6. 测试覆盖评估

### 6.1 已证（21 用例）
79 列回接（`writer-core.test.ts:18-22`）；括号栈+`l.N`（`:24-45`，含「更远 `l.88` 不覆盖就近值」）；
`path:line:` 优先（`:47-56`）；Warning 归集（`:58-66`）；compile 单轮/重跑封顶 2（`:68-93`）；
非零退出+`fallbackError`+空日志不编造（`:95-113`）；scaffold 渲染与字符转义、中英分叉（`:115-128`）；
cite-audit 多 key/可选参/`\nocite{*}`（`:130-146`）；snapshot 留档→篡改→回滚/`CORRUPT`/陈旧节删除（`:148-180`）；
G1 未确认拒/revision+1/幂等/坏数据（`:182-211`）；分档提示词（`:213-219`）；venue schema（`venue-depth.test.ts:11-31`）；
depth 单调+实验清单（`:33-48`）；compliance 换档矩阵+unverified/verified+`pass=undefined`（`:50-95`）；
引擎命中序/全缺不炸/命令装配（`:104-121`）；全链集成（`writer-service.test.ts:72-145`）；
无引擎+分档（`:147-169`）；compliance 盘上事实（`:171-189`）。

### 6.2 未证（风险面）
1. **真引擎**：本机四缺（0206:108-111，本次复核仍缺）；真 PDF/真折行/真 aux 多轮未验。
   假引擎直接写 `build/main.pdf`（`writer-service.test.ts:54-56`）→ 掩盖 F2。
2. **`srw_paper` 工具**：`tests/tools.test.ts:11` 的 import 无 `srwPaperToolDef`；15 action 的参数整形/信封/hint 零覆盖。
3. **`paper.*` / `venue.*` RPC**：`handleSrwRpc` 测试只覆盖 root/project/overview/diag（`host.test.ts:85-186`），13 端点无一条被测。
4. **G1 UI 可达路径**：scaffold 后「确认大纲」可点（`workbench.tsx:1316`）→ 实测走到 `section.write` 报 `INVALID`（F5），无测试守护。
5. **快照路径护栏**：`security.test.ts:41-99` 覆盖 `assertInsideRoot` 本身，但无 `restoreSnapshot` 路径键测试（F4 因此逃逸）。
6. **解析边界**：F6/F7 形态不在 fixture。
7. **i18n 合规**：无中文刊物 compliance 端到端用例（F8 类问题无法暴露）。
8. **`escapeLatex` 反斜杠**：只测 `&`/`%`（`writer-core.test.ts:122`），未测 `\`、`_`、`{}`（F11）。
9. 死/半死代码：`draftOutline`（连测试都手搓等价重写，`:207-210`）、`fallbackError`、`experimentsChecklist`、
   `pdfProduced`（`compile.ts:57` 直接=ok，语义误导）、`resetEngineCache`。
10. `pnpm check` 含 build+smoke，本次按要求未跑（只 typecheck + 定向测试）。

## 7. 设计亮点、缺陷与技术债

### 7.1 亮点
① `RunPort` 注入（`engine.ts:11-13`）让无引擎机器全链可测——思路对，只是装配漏了；
② 引擎全缺是数据不是异常（`engine.ts:2-3,28-31`），UI 据此出引导（0102:681 降级矩阵）；
③ 79 列回接把活体教训固化进注释+单测（0206:95-99）；
④ venue 诚实性三件套（unverified+sources / 全 warn / pass=undefined）是最难被抄走的产品判断；
⑤ G1 在服务层硬编码（`service.ts:243`），agent 无视 SKILL 也写不进正文；
⑥ 快照「集合对齐+哈希防线」（`snapshot.ts:95-128`），坏档 CORRUPT 不静默；
⑦ 保护写作现场（拒覆盖 main.tex、不覆盖已有节文件）；
⑧ 文件即真相源（ADR-3），面板与 agent 无两套状态。

### 7.2 已证实缺陷（附证据/复现）

**F1（P0）`RunPort` 未装配 → 生产不可编译**
`src/service.ts:113-125` 构造参数无 `run`；`nodeRun` 全仓无 import（仅 `run.ts:8` 定义 + `lib/types` 声明）；
`lib/index.js` 中 `child_process` 出现 0 次。复现：生产形状实例（不传 run）在 PATH 放假 `tectonic` 时
`state().engine.engine === undefined`；同实例显式传 `run: nodeRun` 时 `=== 'tectonic'`。
后果：`compile` 恒 `ENGINE_MISSING`、面板恒「无引擎」、`state` 引擎体检失效。
修复：`service.ts` 传 `run: nodeRun`；`WriterDeps.run` 缺失时应显式报错而非静默降级。

**F2（P1）`build/` 落点与真实引擎不符**
`compileCommand` 无输出目录参数（`engine.ts:37-47`），cwd=`paper/`（`service.ts:270`），却读
`paper/build/main.pdf`（`service.ts:272,396`；`snapshot.ts:37`）。后果：`pdfWritten` 恒 false、快照无 PDF
（0206:35 要求含 `build/*.pdf`）、面板「无产物」；而 `compliance` 的 pages 反而能用（日志由 `service.ts:271`
写入 `build/main.log`）——更证明是路径假设错位。修复：tectonic `--outdir build`、其余 `-output-directory=build`。

**F3（P0/P1）`\input` 清单与 outline 文件分配脱钩，可静默丢节**
`scaffold.ts:70` 写死 `\input{sections/<nn>-<slug(sectionOrder)>}`；`service.ts:182-207` 按 agent 标题另分配；
两者无同步（`grep '\\input' src/` 仅 scaffold）。复现：IEEE+D2 骨架后 `outline.save` 用
`["Introduction","Methods","Ablation Study","Conclusion"]` → 文件 `01-introduction/02-methods/03-ablation-study/04-conclusion`，
而 `main.tex` 仍 `01-introduction/02-related-work/03-method/04-experiments/05-results/06-discussion/07-conclusion`；
写 `02-methods`、`03-ablation-study` 后编译只含旧空占位，**新正文不进 PDF 且编译成功**。
D3 追加节、改名节、中文节名都会踩；`compliance` 的章节统计来自磁盘全文（`service.ts:356-369`）→ 假阳性。
修复：以 outline 为唯一权威重写 `\input` 序列（save/confirm 时），或 main.tex 只 `\input{sections/all}`
并由服务生成聚合文件；编译前自检「outline.file 集合 ⊆ 编译输入集合」。

**F4（P1）`restoreSnapshot` 绕过护栏，可越界写**
`snapshot.ts:102-117` 直接按 manifest 键 `join` 读写，无包含性/白名单校验；`service.ts:290-292` 未 guard。
复现：改 manifest 为 `{"files":{"../escape.txt":"<sha256>"}}` 并放同内容 → `restore` 写到 `paper/..` 成功。
后果：`service.ts:5` 的护栏承诺在快照面不成立；有项目写权限的 agent 可把 restore 当任意写原语。
修复：逐路径 `assertInsideRoot(paperDir,path)` + 拒绝绝对路径/`..`/非白名单。

**F5（P2）scaffold → confirm 死路（UI 可达）**
`emptyOutline` 不分配 file（`outline.ts:34-47`），`outlineConfirm` 不校验绑定（`:95-106`），面板确认键在
`status==='draft'` 即可点（`workbench.tsx:1316`）。复现：apply→scaffold→confirm 成功（revision=1），
`section.write('s1',…)` 抛 `INVALID 节 s1 未绑定文件`；`writer-service.test.ts:176` 正是这种状态。
修复：confirm 前置校验每节有 file，或 scaffold 直接绑定骨架文件，或面板在全部绑定前禁用确认。

**F6（P2）79 列回接可吞错误首行**
`refold` 先于错误识别（`texlog.ts:50`），只按「上一段 79 列」判续行（`:31-43`）；若 79 列行后紧跟 `! ...`，
被并成一行，`/^!/`（`:66`）失配。复现：`[79 列路径行, "! Undefined control sequence.", "l.42 …"]` →
`errors === []`（错误凭空消失）。修复：下一行以 `!` 开头则不并，或先按 `!` 切块再回接。

**F7（P2）`l.N` 6 行窗口对 `File ... not found` 偏短**
`texlog.ts:75` 只看后 6 行；真实形态（空白、`Type X…`、`or enter new name…`、`Enter file name:` 之后才 `l.5`）
→ 首错丢行号，`l.5` 错挂到 `! Emergency stop.`（已复现）。修复：窗口扩到「下一个 `!` 前或 20 行」，
同块 `l.N` 归块首错误。

**F8（P2）声明 i18n 缺口**
`statementsPresent` 只扫英文 label（`service.ts:367`，`STATEMENT_LABELS` 单语 `compliance.ts:115-122`）；
`hasAppendix` 只认 `\appendix`（`:368`）；`cn-journal` 的 `mandatoryStatements=[]`（`registry.ts:85`）→ 走 D3
六项英文声明（`compliance.ts:74-76`）→ 中文刊 D3 声明项**结构性永远「缺」**（warn 但误导整改）。
修复：label 加中文别名（数据可得性/代码可用性/局限性/利益冲突/伦理/作者贡献）+ 附录别名。

**F9（P3）坏 `venue.json` 被静默当作「未应用」**
`service.ts:121-139` 的 `catch{return undefined}` 与非法 tier 同路径 → 后续报「先应用刊物」，损坏不可见。
修复：区分「不存在」与「解析失败」。

**F10（P3）快照不含 `.srw/*.json`，回滚可能状态撕裂**
`snapshot.ts:24-40` 只收集 tex/bib/pdf。场景：确认后新增节→编译留档→改大纲删节→回滚 → 文件回来但 outline
没有该节（或反之）。修复：把 `outline.json` 纳入快照，或还原后校验并提示不一致。

**F11（P3）`escapeLatex` 反斜杠处理错误**
`scaffold.ts:94-100` 先把 `\` 换成 `\textbackslash{}`，再转义 `{}` → 输出 `\textbackslash\{\}`。
复现：`A \LaTeX{} study` → `\title{A \textbackslash\{\}LaTeX\{\} …}`（多打印一对字面花括号）。
修复：先转义 `&%$#_{}` 与 `~^`，最后替换 `\`（或用占位符）。

**X 潜在（未触发但结构上存在）**
- X1 `bibTool==='biber'` 时同时输出 biblatex 与 `\bibliographystyle/\bibliography`（`scaffold.ts:61,72-73`）
  → 一旦有 biber 种子即编译失败（当前 4 种子均 bibtex）。
- X2 `cite-audit` 不认 `\citep/\citet/\autocite`（`cite-audit.ts:11`），而 `ReferenceStyle` 已含 `apa/authoryear`
  （`types.ts:7`）→ 换引用样式后 missing 检测失真。
- X3 `toBibtex` 输出 `venue = {...}`（`literature/bibtex.ts:62`），BibTeX 标准字段是 `journal`/`booktitle`
  → refs.append 的会议条目在 IEEE/ACM 样式下书目信息可能缺项（经 `service.ts:339` 进入论文线）。
- X4 `PathSafetyError` 不是 `ServiceError`（`host.ts:76-81`）→ 越界在 RPC/工具层变 `internal`（`rpc.ts:37-41`、`tools.ts:145-148`），丢失「安全拒绝」语义。
- X5 `compile` 同步阻塞：300s×3 轮（`compile.ts:42,33`），与 0102:447「长任务立即返回 jobId+轮询」不符。
- X6 `engineCache` 无 TTL（`service.ts:254-259`），装引擎后须重载插件。
- X7 venue 的 `pageLimit/columns/figureDpi/referenceStyle` 四字段无消费者（下表）。

### 7.3 schema 字段消费（实测 grep）
| 字段 | 消费者 | 现状 |
|---|---|---|
| `documentClass/classOptions/bibStyle/sectionOrder/lang/abstractWords` | `scaffold.ts:56-67` | 已用 |
| `mandatorySections/mandatoryStatements/confidence` | `compliance.ts:53,65,74` | 已用 |
| `depthTier` | `service.ts:114` | 已用（apply 可覆盖） |
| `sources/checkedAt` | 校验+UI 展示 | 已用（未自动核对） |
| `pageLimit` | 无 | **未用**（页数只看 `profile.pages`，`compliance.ts:56-63`） |
| `columns/figureDpi/referenceStyle` | 无 | **未用**（纯元数据） |
| `project.json.targetVenue/depthTier`（`core/schema.ts:13-14`） | 无（writer 只读 title，`service.ts:224-231`） | **未用**，与 0206:25 主张不符 |

### 7.4 文档-代码漂移
| # | 文档 | 代码事实 |
|---|---|---|
| D1 | 0206:87「RPC 12 端点」 | `rpc.ts:388-448` 实为 **13**（含 `paper.outline.get`） |
| D2 | 0206:60 `outline.generate` | 实为 `outline.prompt`（`tools.ts:486-489,576`） |
| D3 | 0206:25「`project.json` 增补 venueId/depthTier」 | 只写 `.srw/venue.json`（`service.ts:117`） |
| D4 | 0206:44 错误含 `context` | `TeXError` 无该字段（`texlog.ts:16-22`） |
| D5 | 0206:48 `src/venue/data/*.json` | 目录空，数据内嵌 TS（`registry.ts:5-6` 自述） |
| D6 | 0102:457「`srw_paper` 写需审批」 | 全部豁免（`tools.ts:454,104-108`；0206:62 已改，0102 未同步） |
| D7 | 0102:438「`paper.state` 含 mtime」 | `PaperState` 无 mtime（`service.ts:35-42`） |
| D8 | `compliance.ts:47`「tier 取 project.json」 | 实取 `venue.json.tier`（`service.ts:370`） |

### 7.5 修复优先级
1. **P0** 装配 `run: nodeRun`；`WriterDeps.run` 缺失改为显式报错。
2. **P0** `\input` 由 outline 驱动（save/confirm 重写或聚合文件）+ 编译前置自检 + 单测。
3. **P1** 引擎输出目录统一到 `build/`；假引擎改为按真实落点写 `paper/main.pdf` 防回归（现有测试反向固化了错误假设）。
4. **P1** `restoreSnapshot` 接 `assertInsideRoot` + 白名单。
5. **P2** `outlineConfirm` 校验 file 绑定；面板同步禁用确认键。
6. **P2** texlog：合并前判 `!` 前缀；`l.N` 窗口扩到块边界。
7. **P2** 声明/附录 label 加中文别名；`cn-journal` 显式 `mandatoryStatements`。
8. **P2** 补 `paper.*` RPC + `srw_paper` 工具测试（当前对外接口零覆盖）。
9. **P3** 死代码清理或接线；`PathSafetyError → ServiceError('FORBIDDEN')`。
10. **P3** 为 `pageLimit`（venue 上限与档位区间取交）、`columns`、`figureDpi` 找消费者或从 schema 删除。

## 8. 对外接口

### 8.1 `srw_paper`（`tools.ts:459-599`）
`SRW_PAPER_TOOL_NAME='srw_paper'`（`:459`）；**15 action**（`:576`）：`state`/`venue.list`/`venue.apply`/
`scaffold`/`outline.get`/`outline.prompt`/`outline.save`/`outline.confirm`/`section.write`/`compile`/
`cite.audit`/`refs.append`/`snapshot.list`/`snapshot.restore`/`compliance`。
参数（`:571-592`）：`action`(必填)、`project`、`venueId`、`tier`、`title`、`authors`、
`sections[{title,intent,targetWords}]`、`sectionId`、`tex`、`keys[]`、`id`。
输出：`{ok:true,value}` / `{ok:false,error:{code,message}}`（`:594-599,145-148`）；每 action 带 `hint`；
`compile` 返回 `{ok,engine,reran,pdfWritten,errors,warnings≤20,snapshot?}`；`timeoutMs=600_000`（`:593`）。
审批：**全豁免**（`ASK_TABLE` 无此工具，`:104-108`）；挂载＝root agent（`index.ts:109-116`），随 agent 卸载回收。

### 8.2 RPC（`src/rpc.ts`）
通道 `/dsh-kylin-srw`（`:16`），`webServer.register({kind:'prefix'})`（`:100-115`）；`POST`+`application/json`，
body ≤4 MiB（`:19,147-173`）；非 POST 405、非 JSON 415、非法 endpoint 404；`endpoint===method` 否则 200+`invalid`（`:190-197`）；
鉴权沿用 `connection.requestRejection`（`:128-133`）。
**信封**：请求 `{type:'client-request', rpcId, method, payload}`；响应 `{type:'server-response', rpcId, result}`；
`result = {ok:true,value} | {ok:false,error:{code,message,details:{}}}`（`:21-35`）。`details` 必须存在，
否则 vendored 客户端抛 "invalid server-response failure"（`:29-35` 注释，2026-10-04 实测踩中）。
**论文线 13 端点**（`:388-448`）：`paper.state`、`venue.list`、`venue.apply`、`paper.scaffold`、
`paper.outline.get/save/confirm`、`paper.compile`、`paper.citeAudit`、`paper.refsAppend`、
`paper.snapshot.list/restore`、`paper.compliance`；全部显式 `project`，参数经 `reqString/record` 校验（`:52-58`）。
错误映射（`:37-41`）：`ServiceError.code` 原样透传（`INVALID/NOT_FOUND/GATE/ENGINE_MISSING/NO_ROOT/NO_PROVIDER/CORRUPT`），
其它异常（含 `PathSafetyError`）→ `internal`，abort → `aborted`。

### 8.3 服务方法消费者
`venueList/venueApply`：`tools.ts:470,474`、`rpc.ts:392,396`、面板 `:773,794`；`scaffold`：`:481`/`:406`/`:799`；
`outlineGet/Save/Confirm`：`:485,502,506`/`:414,420,430`/`:802`；`outlinePromptFor`：仅 `tools.ts:487`；
`sectionWrite`：仅 `tools.ts:513`（面板不自写，走会话提示词 `:868-890`）；`compile`：`:517`/`:432`/`:805`；
`citeAudit/refsAppend`：`:532,537`/`:434,439`/`:811,835`；`snapshotList/Restore`：`:540,543`/`:442,445`/`:895`；
`compliance`：`:547`/`:448`/`:815`；`state`：`:468`/`:390`/`:764`；`literature.entry` 经 `src/service.ts:121`
作为 `libraryEntry`；`resetEngineCache` **无生产消费者**。

---

## 附录 · 实证命令（可复现）

```bash
for e in tectonic xelatex pdflatex latexmk lualatex; do command -v $e || echo "$e MISSING"; done   # 全 MISSING
node --import tsx --test tests/writer-core.test.ts tests/venue-depth.test.ts   # 18 pass
node --import tsx --test tests/writer-service.test.ts                          # 3 pass
npm run typecheck                                                              # exit 0
# F1：生产形状（无 run）PATH 放假 tectonic → engine=undefined；传 run:nodeRun → engine=tectonic
# F3：scaffold 后 outline.save 换标题 → main.tex \input 仍旧名，新节文件不在输入清单
# F4：manifest files 键改 "../escape.txt" → restore 写到 paper/.. 成功
# F6：79 列行 + "! Undefined control sequence." → errors=[]；F7：File not found 首错丢行号
# F11：title 含反斜杠 → "\textbackslash\{\}"；发布产物：grep -c child_process lib/index.js → 0
```

## 一句话总结

M5 的**领域模型与不变量设计是成熟的**（venue 诚实性、G1 状态机、快照哈希、79 列回接），但**接线层有两处硬伤**
（`RunPort` 未装配、`main.tex` 与 outline 脱钩）和**一处路径假设错误**（`build/`），导致「装了引擎也编不出 PDF」
「编出来也可能少节」；三者都因「假引擎测试恰好绕开真实落点」而长期隐身。修完 F1–F3，M5 才算真正打通全链。
