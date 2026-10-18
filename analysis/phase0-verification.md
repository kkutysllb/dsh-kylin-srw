# Phase 0 独立验收报告（修后复核）

> 验收员：phase0-verify（fresh context，未参与实施）｜报告：本文件（新建，唯一写入）
> 时间：2026-10-18 19:30–20:10 首轮；20:35–20:55 补充验收（§8）｜工作区：/Users/libing/kk_Projects/dsh-kylin-srw｜HEAD `d21ad8d`（Phase 0 改动未提交）
> 方法：只读源码/测试 + 本机运行质量门 + 独立探针（位于 /tmp，未入库）；**未改源码/lib/package.json，未 commit**。
> 证据等级：**实测**＝本次命令/探针；**代码事实**＝file:line；**未验证**＝当前环境无法判定（明确标注）。

## 0. 一页结论（分层）

1. **质量门本机全绿**：typecheck 0 诊断；test **179/179**（首轮，34 文件，1.85s）→ **补充验收后 181/181**（§8）；`pnpm check`（含 build+smoke）exit 0；smoke:negatives **4/4** 按预期红；构建可复现（build 前后 lib 哈希不变）。
2. **P0-1/2/3/4/5/6 的主缺陷均已修复**，且不止测试自证：input 单源/孤儿隔离/快照回滚/编译门/OpenAlex 撤稿链路均有独立探针证据。
3. ~~P0-1 fail-loud 子项未达成~~ → **已在补充验收关闭**：`WriterDeps.run` 改为必填 + 构造期 `NO_PROVIDER`（§8-2-1）。
4. ~~P1-1 只做了一半~~ → **已在补充验收关闭**：`CompileOutcome.bib` 报告 `tool/bbl/undefinedCitations` 并有串行/统计测试（§8-2-3）。
5. 无 secrets、无新增绝对路径入库、无错误码删除、无返回信封变化；新增字段均为可选（向后兼容）。
6. **出口判定（更新后）：代码侧达成、首轮保留项已关闭；真实 tectonic 出 PDF、CI 首次实跑、OpenAlex 真网仍是外部门槛**，不能算通过。

## 1. 命令 → 结果

| # | 命令 | 结果（本次实测） | 判定 |
|---|---|---|---|
| 1 | `pnpm typecheck` | exit 0，1.38s，零诊断 | PASS |
| 2 | `pnpm test` | **tests 179 / pass 179 / fail 0**，34 文件，duration 1845ms | PASS |
| 3 | `node --import tsx --test tests/*.test.ts`（去 `--test-force-exit`） | 179/179，约 1.81s，exit 0；重复 6 次全绿 | PASS（61.7s 泄漏**已真修**，非仅靠 force-exit 掩盖） |
| 4 | `pnpm check` | exit 0，wall 5.61s；test 段 2368ms/179 全过；build "built Host and Web client bundles"；smoke ALL PASS | PASS |
| 5 | `pnpm smoke` | `dsh-kylin-srw@0.0.1 smoke: ALL PASS`（含在 #4） | PASS |
| 6 | `pnpm smoke:negatives` | 4 条负例全部 ALL RED AS EXPECTED | PASS |
| 7 | build 可复现 | build 前后 `lib/index.js` sha256 同为 `b2dc95d8…`、`lib/client.js` 同为 `8539a424…`；`git status lib` 无新增项 | PASS |
| 8 | 定向 P0 测试（9 文件） | 58/58，1532ms（writer/rate-gate/openalex/identity/enrich/rpc/timeout） | PASS |
| 9 | `grep -c child_process lib/index.js`；`grep -n nodeRun lib/index.js` | **1**；`206486:var nodeRun`、`206583: run: nodeRun` | PASS（P0-1 接线） |
| 10 | 本机 TeX 探测 `command -v` | tectonic / latexmk / xelatex / pdflatex **四缺** | 外部门槛 |
| 11 | CI YAML 解析 | `yaml.safe_load` 通过；9 steps：checkout / pnpm setup / node 24 / install --frozen-lockfile / typecheck / test / build / smoke / smoke:negatives | PASS（静态） |
| 12 | 独立探针 | /tmp/phase0-probe.mts、probe2.mts、bib.mts（证据见 §2/§5，未入库） | — |

> 唯一异常：首次「去 force-exit」全量跑出现过 1 例 `expected 'tectonic' actual undefined`；随后 **6 次全量 + 5 次 writer-wiring 单跑 + pnpm check** 均未复现（见 §5-R6），判为一次性环境抖动，不作 FAIL。

## 2. P0 逐项

### P0-1 TeX runner 装配 —— **PASS（主缺陷 + fail-loud 均已达成，见 §8-2-1）**
- 代码事实：`src/service.ts:124` 生产装配 `run: nodeRun`；`nodeRun` 走 `execFile`（`src/writer/run.ts:8-22`），lib 内可见。
- 测试：`tests/writer-wiring.test.ts:40` 用 `SrwService.open({fs},{rootDir})`（**未直接 new WriterService**）→ `:42` `engine==='tectonic'`；`:47-54` 走完 scaffold→confirm→compile，断言 `ok=true`、`pdfWritten=true`、`snapshot!==undefined`、`state.files.buildPdf=true`。
- **首轮保留项已在补充验收关闭**：原探针 A1/A2 里不传 run 会四引擎全 false + `ENGINE_MISSING`；现 `WriterDeps.run` 必填（`service.ts:44-52`）+ 构造期运行时兜底抛 `NO_PROVIDER`（`:57-62`），`engineOf/compile` 直接用 `deps.run`（`:368,396`），`throwNoRunner` 已删除。测试：「run 缺失在构造期抛 NO_PROVIDER」；探针 S1 复现（§8-2-1）。

### P0-2 RateGate 缓存/换根 —— **PASS**
- 代码事实：`this.cache` 字段已删除；`mutate` 在锁内 `loadLedger(path)` 每次读盘（`rate-gate.ts:108-115`），路径进锁前固定；抖动改为 +0–20%（`:52-54`），不低于官方下限。
- 测试：跨实例（A 缓存后 B 推后账本 → A 必须等待且 ≥interval）与换根（新根从空账本起、换回旧根看到旧预约）两条回归均过。

### P0-3 input 与 outline 单源 —— **PASS**
- 代码事实：scaffold 每节绑定 `file`（`service.ts:222-226`）；`main.tex` 用 `% srw:inputs:begin/end` 标记块（定义 `scaffold.ts:16-17`，渲染 `:127`）；`outlineSave/Confirm` 重写 input（`service.ts:273/286`）；改名/删节旧文件 rename 到 `sections/_orphaned`（`:128-143`）；compile 前 `syncInputs` + 逐项比对，不一致抛 `GATE`（`:339-343,147-157`）；`texFiles` 只读 outline 绑定的节（`:396-406`），compliance/citeAudit 不再读孤儿。
- 测试：writer-core 新增标记块/legacy 两路 `syncInputBlock` 用例；writer-service 断言 save 后 `\input` 同步、`02-related-work.tex` 进 `_orphaned`；旧大纲缺 file 现改为**自动迁移后可写**（§8-2-2）。
- 独立探针：C1 删节后 main.tex 只剩 `01-introduction`；C2 `_orphaned` 收到 6 个旧节；C3 孤儿节里的 `\cite{ghost}` **不再**进 citeAudit（预期 missing 为空，实测空）；D2 在标记块外插一条旧 `\input` → compile 抛 `GATE`（门真实生效）。
- 注：块内篡改会被 `syncInputs` 自动修复（outline 是单源），门主要拦块外残留/手改 —— 属设计取舍，不是缺陷。

### P0-4 OpenAlex 摘要/撤稿 —— **PASS**
- 代码事实：`abstractFromInvertedIndex` 按 position 还原（`openalex.ts:30-45`），明文 `abstract` 优先（`:84`）；`openalexId` 剥前缀、`is_retracted` 透传（`:86-95`）；`searchOpenAlexUrl` **未加 select**（`:114-122`），默认完整 work 对象不会把字段投影掉。
- 断链已接：`candidateFromInput` 透传 openalexId/retracted（`literature/service.ts:119-127`），`importEntries` 走该函数（`:280`）；`LibraryStore` 新条目 `status=retracted`、重复入库只升级不降级并补 id（`library.ts:148-186`）；`mergeInto` 批内合并保留落选候选的 openalexId/retracted（`identity.ts:102-115`）。
- fixture 改真实形态（`is_retracted` + 打乱键序的 `abstract_inverted_index`，第二条空 index）；lit-openalex 5 例、lit-identity 1 例、lit-enrich 2 例全过。
- 未验证：真网响应（本次禁网）；代码依赖 OpenAlex 默认返回 `abstract_inverted_index`（无 select 时合理，但未实测）。

### P0-5 真实引擎落点 —— **PASS**
- 代码事实：四引擎统一 outdir：tectonic `--outdir build`、latexmk `-outdir=build`、xelatex/pdflatex `-output-directory=build`（`engine.ts:37-48`）；compile 前 `mkdir build`（`service.ts:350`）。
- 测试：假引擎按命令行 outdir 解析落点（`writer-service.test.ts:55-64`），不再写 `cwd/main.pdf`；writer-wiring E2E 假 tectonic 写 `build/main.pdf` → `pdfWritten=true`、`state.files.buildPdf=true`。
- 独立探针 B2：快照 manifest 共 12 个文件，含 `build/main.pdf`、`state/outline.json`、`state/venue.json`（快照含 PDF 成立）。
- 缺口：没有正式测试直接断言「快照含 build/main.pdf」（仅探针）；真实引擎 flag 语义未验证（引擎全缺）。

### P0-6 快照越界/纳入 outline —— **PASS**
- 代码事实：白名单 `isSnapshotPathAllowed`（`snapshot.ts:105-109`）+ restore 逐项 `FORBIDDEN`（`:130-133`）+ 快照 id 校验（`:119-121`）+ 服务层 `guard` 接 containment（`service.ts:377-386`）；`collectFiles` 在项目 paper/ 下额外收 `.srw/outline.json|venue.json`（`snapshot.ts:39-47`）。
- 测试：伪造 manifest 的 `../escaped.txt` → `FORBIDDEN`，且 paper 外无文件。
- 独立探针 B2/E2b：outline/venue 入快照；回滚后 `.srw/outline.json` 与快照内副本**逐字节相同**（status=confirmed、7 节）；`_orphaned` 不被误删，陈旧顶层节文件按 manifest 清理。
- 缺口：restore 的 state 写回 + 服务层 guard 组合无正式测试（仅探针）。

## 3. P1 / CI

| 项 | 结果 | 判定 |
|---|---|---|
| **P1-1 bibtex/biber** | `compilePaper` 对裸 xelatex/pdflatex 先跑 bibtex/biber 再跑 2 遍；**补充验收新增**：`CompileOutcome.bib={tool,bbl,undefinedCitations}`，bib 后检查 `build/main.bbl`、只统计**最终 pass** 的 `Citation ... undefined`（`compile.ts:20,52-96`）；新增串行/bbl 测试；探针 S8/S9：bbl 缺失=false、首轮历史噪声不计、最终 1 条 undefined=1。**残留**：结果仅上报不阻断、未进 UI；tectonic/latexmk 自处理 bib 故无此统计（设计口径）；真实引擎未验 | **PASS（代码/测试侧）** |
| **P1-5 RPC UTF-8** | `src/rpc.ts:158-178` 收 Buffer 并 `Buffer.concat().toString('utf8')`；`tests/rpc-transport.test.ts` 真实 `createServer`+`registerSrwRpc`，把「中」三字节切成 3 片发送，断言 echoed 原样、无 U+FFFD；另测 415/413 | **PASS** |
| **P1-16 timeoutOf 预取消** | 预取消直接抛 `UpstreamError`（`timeout.ts:32-38`）；测试 <100ms 且未启动任务；去 force-exit 全套 ~1.8s，证明 61s 泄漏真修 | **PASS** |
| **P1-6 批量精读** | 无 `src/reading` 改动、无相关回归测试；不在本次 diff | **未涉及/Open** |
| **CI** | package.json `test` 已加 `--test-force-exit`；ci.yml 与 scripts 一一对应、YAML 可解析、pnpm 11.23.0/node 24 与本机一致、锁文件 `autoInstallPeers:false`（不会拉 @deepseek-ai peers） | **静态 PASS**；未在干净容器实跑；**build 后无 `git diff --exit-code`（lib 同步无门禁）** |

## 4. 越界 / 回归审查

**4.1 改动文件分类**
- Phase 0 源码：`src/service.ts`、`src/writer/{service,engine,scaffold,compile,outline,snapshot}.ts`、`src/literature/{rate-gate,openalex,identity,library,service,types}.ts`、`src/rpc.ts`、`src/util/timeout.ts`、`src/client/workbench.tsx`。
- Phase 0 测试/夹具：`tests/writer-wiring.test.ts`、`tests/rpc-transport.test.ts`（均新）、`tests/{writer-core,writer-service,rate-gate,lit-openalex,lit-identity,lit-enrich,util-limiter,venue-depth}.test.ts`、`tests/fixtures/openalex-page.json`（首轮 +16 例；补充验收后合计 +18 例）。
- Phase 0 工程：`package.json`（仅 test 脚本一行）、`.github/workflows/ci.yml`（新）。
- 构建产物：`lib/index.js`、`lib/client.js(.map)`、`lib/types/**`——build 重生成，哈希可复现，属 src 改动的产物。
- **会话前既有（非 Phase 0）**：`scripts/smoke-dual-host.mjs`（npm pack `--cache`）、`tests/host.test.ts`（QILIN_HOME 显式清空）——与基线 00 §6.1 记录一致；`analysis/`（分析包）、`outputs/`（bailian-comic 等）untracked。
- 只读未改：`src/writer/run.ts`（nodeRun 早已存在）、`src/tools.ts`、README。

**4.2 安全 / 兼容 / 纪律**
- secrets：diff 无 token/key/私钥；绝对路径：新增行无 `/Users/`。`lib/client.js.map` 内的 `/Users/.../README.md` 来自既有 `src/client/view.tsx:137`，HEAD 同样存在，非本次引入。
- public API：`LitCandidate/LitEntry +openalexId/retracted`、`PaperState.outline.files` 均为新增；`restoreSnapshot/compilePaper/emptyOutline` 只加可选参数；新增 helper 导出（additive）。
- 错误码：新增 `FORBIDDEN`（snapshot 越界）；无删除/改名；RPC 返回信封未变（transport 测试覆盖）。
- lossless JSON：**181 全绿**（补充验收后；含 tools 无损回归门）；旧库文档缺新字段照读。
- 测试是否被弱化：无用例删除；rate-gate 阈值 0.8×→1.0×（更强）；venue-depth 断言跟随新参数；新增 18 例（首轮 16 + 补充验收 2）。
- **行为变化（需 Lead/用户知悉）**：① `outline.confirm` 现在拒绝未绑定 file 的旧大纲（面板已禁用确认，需 `outline.save` 一次恢复）；② 旧 outline（无 file）上 `compile` 会抛 `INVALID`，且 `citeAudit/compliance` 对这类 outline 只读 main.tex（**会静默少算**）——迁移风险；③ compile 每次按 outline 重写 `\input`（块外篡改被 gate 拦，块内被自动修复）。
- 仓库卫生：`build/main.pdf` 仍是提交 `1dab90c` 的 20B 假 PDF（基线 B4），本次未清理；`outputs/` 大量 untracked 资产，勿误提交。

## 5. 残余风险（按严重度）

- **R1 真实引擎未验**：本机四引擎全缺；P0-1/5 与 P1-1 的「真 PDF」仍是外部门槛。假引擎只证明落点契约与参数装配。
- **R2 P0-1 fail-loud**：**已关闭**（§8-2-1）；保留：运行时兜底只判 `undefined`，显式传 `null` 仍晚失败（极低概率）。
- **R3 P1-1**：**主体关闭**（§8-2-3）；保留：bbl/undefined 只上报不阻断、未进 UI；tectonic/latexmk 路径无 bbl 统计；真实引擎未验。
- **R4 旧大纲迁移**：**主体关闭**（§8-2-2，自动迁移）；保留：`ensureOutlineFiles` 在 citeAudit/compliance/未确认 sectionWrite 上也会写盘（读操作/被 GATE 拒绝时已发生迁移副作用）；`state()` 不迁移，首次 confirm/compile 前 UI 仍显示 files 偏少（已不据此禁用）；手工命名与 slug 不一致的旧节文件不会被绑定（生成占位，旧文件不参与编译但不丢失）。
- **R5 旧快照兼容**：升级前快照无 `state/*`，回滚不会恢复 outline；但 compile 会按现 outline 重写 input，不会静默丢节。
- **R6 一次性测试抖动**：首次去 force-exit 全量跑 1 例 tectonic 探测失败，6×全量 + 5×单跑未复现；建议 writer-wiring 的 PATH 假引擎探测加重试/显式超时，或降低该文件并行压力。
- **R7 CI 门禁窄**：无干净容器实跑、无 lib diff 门、未跑 smoke:dual。
- **R8 P0-4 真网**：未复测 OpenAlex 默认响应字段（禁网）。
- **R9 P1-6**（批量精读部分失败/截断入缓存）不在本次范围，仍 Open。

## 6. Phase 0 出口判定

- **达成（代码侧）**：P0-1（含 fail-loud）、P0-2/3/4/5/6、P1-5、P1-16、P1-1（代码/测试侧）、G1 confirm 绑定与旧大纲自动迁移、CI 骨架；**181 测试** + 4 负例全绿；构建可复现；快照/回滚/孤儿/编译门/撤稿/bbl 链路均有独立探针或测试。
- **外部门槛（不算通过，补充验收未改变）**：真实 tectonic 出 PDF（本机四引擎全缺）、CI 首次实跑、OpenAlex 真网复测。
- 建议 Lead 对外口径：**「Phase 0 代码侧达成（首轮保留项已关闭）；论文线要等装 tectonic 并用真实引擎跑一次 writer-wiring 后才能宣称可出 PDF」**。

## 7. 下一步建议（按顺序；第 2/3/6 项已在 §8 补充验收关闭）

1. 装 tectonic（brew install tectonic），把 writer-wiring 的假脚本替换为真引擎跑 scaffold→confirm→compile→snapshot；另装 tinytex 验 xelatex+bibtex 路径与 bbl。
2. 补 P0-1 fail-loud：service 构造期显式要求 `run`；probeEngines 区分端口缺失；加测试。
3. 补 P1-1：编译后校验 `build/main.bbl` 存在、日志无 `Citation ... undefined`，纳入 compile 结果/合规。
4. 补两条正式测试：快照 manifest 含 `build/main.pdf`；`service.snapshotRestore` 把 `state/outline.json` 写回 `.srw`（当前仅探针证据）。
5. CI 增加 build 后 `git diff --exit-code -- lib`（lib 同步门），可选 `smoke:dual`；推送后观察首跑。
6. 旧 outline 迁移：`outlineGet` 发现缺 file 时自动补绑或给显式迁移错误，避免 confirm/compile 突然 INVALID 与审计低估。
7. 仓库卫生：`git rm --cached build/main.pdf`；确认 `outputs/` 不入库。
8. P1-6（批量精读部分失败/截断）另立任务，不计入本次 Phase 0。

## 附：本次实验的复现命令（只读）

```bash
pnpm typecheck && pnpm test && pnpm check && pnpm smoke:negatives
node --import tsx --test tests/*.test.ts            # 去 force-exit，验 61s 泄漏已消失
grep -c child_process lib/index.js ; grep -n nodeRun lib/index.js
node --import tsx /tmp/phase0-probe.mts             # P0-1 fail-loud / P0-5 快照 / P0-3 孤儿 / P0-6 回滚
node --import tsx /tmp/phase0-probe2.mts            # 恢复写回 .srw / 标记块外 input 触发编译 GATE
node --import tsx /tmp/phase0-bib.mts               # bibtex/biber 调用序（xelatex/pdflatex）
```

> 探针脚本在 /tmp（未入库）；若要长期保留，应把 §5 建议 4 的两条断言落成 `tests/` 正式用例。

## 8. 补充验收（2026-10-18 20:35–20:55，task-9）

> 触发：Lead 对首轮三个保留项补修；本验收员 fresh 复核（只读源码 + typecheck/test + 独立探针 `/tmp/supp-probe.mts`）。
> 写入边界：仅本文件；未改源码/lib/package.json，未 commit。
> 行号口径：§2–§6 的 `service.ts` 行号以首轮版本为准；补充验收新增 `ensureOutlineFiles`/构造期 guard 后整体下移，§8 用**现行**行号。

### 8.1 质量门（复跑）

| 命令 | 结果（本次实测） | 判定 |
|---|---|---|
| `pnpm typecheck` | exit 0，1.34s，零诊断 | PASS |
| `pnpm test` | **tests 181 / pass 181 / fail 0**，34 文件，duration 2414ms（首轮 179 + fail-loud 1 + 串行/bbl 1；旧「confirm 拒绝」用例被迁移用例替换，净增 2） | PASS（与 Lead 预期 181 一致） |
| lib 同步（内容级，未跑 build） | `lib/index.js` 含构造期 NO_PROVIDER message、`ensureOutlineFiles`、`undefinedCitations`，`throwNoRunner` 0 命中；`lib/types/writer/service.d.ts` 中 `run: RunPort` 必填、`ensureOutlineFiles` 声明在；`lib/client.js` 不旧于 src/client | PASS（内容级；mtime 同秒有歧义，建议提交前再跑一次 build） |

### 8.2 三项补修复核

**8.2-1 P0-1 fail-loud —— 关闭**
- 代码：`WriterDeps.run` 必填（`service.ts:44-52`）；构造期 `if (deps.run === undefined) throw ServiceError('NO_PROVIDER', …)`（`:57-62`）；`engineOf`（`:366-371`）与 compile（`:396`）直接使用 `deps.run`；`throwNoRunner` 已删除。
- 测试：`writer-service.test.ts:216`「run 缺失在构造期抛 NO_PROVIDER」（`as unknown as WriterDeps` 绕过类型）。
- 探针 S1：构造即抛 `NO_PROVIDER`（不再四引擎全 false）；生产 `SrwService.open` 仍传 nodeRun（writer-wiring 全绿）。
- 残余：运行时兜底只判 `undefined`，显式传 `null` 仍会晚失败（可忽略）。

**8.2-2 旧 outline 自动迁移 —— 关闭**
- 代码：`ensureOutlineFiles`（`service.ts:132-164`）按 title/index 绑定 `sections/NN-slug.tex`（与 scaffold `slugifySection` 同算法），已有文件不覆盖、缺文件补占位、重名加 `-2` 后缀，并写回 outline.json；调用点：confirm（`:322`）、sectionWrite（`:354`）、compile（`:382`）、citeAudit（`:453`）、compliance（`:495`）。
- 测试：`writer-service.test.ts:223`「旧大纲缺 file 自动迁移绑定」——confirm 成功 → sectionWrite 写 `sections/01-introduction.tex`，不再是死路；旧「confirm 拒绝」用例被替换（预期行为变更，非弱化）。
- 探针 S2–S7：旧 confirmed 大纲（无 file）→ citeAudit 触发迁移后报出 `ghost`（旧实现会漏）；已有 `01-introduction.tex` 的 `KEEP-ME` 内容保留；compile 成功且 main.tex input 序列与迁移后文件一致；`bib` 正常返回。
- UI：确认按钮只按 draft 禁用（不再按 files 数），title 改为「旧大纲会在确认时自动绑定节文件」（`workbench.tsx:1316`）。
- 残余：见 §5-R4（读操作写盘 / 未确认 sectionWrite 抛 GATE 前已迁移 / state() 不迁移 / 手工命名不绑定）。

**8.2-3 P1-1 bbl + undefined citation —— 关闭（代码/测试侧）**
- 代码：`CompileOutcome.bib={tool,bbl,undefinedCitations}`（`compile.ts:20`）；bib 后 `access(build/main.bbl)`、按**最后一次 TeX pass** 统计 `Citation .*? undefined`（`:52-96`，bbl/统计在 `:82-83`）。
- 测试：writer-core「xelatex + bibtex 串行；bbl 与最终 pass 的 undefined citation 统计」——调用序 `['xelatex','bibtex','xelatex','xelatex']`、`bib={tool:'bibtex',bbl:true,undefinedCitations:0}`（首轮噪声不计）。
- 探针 S8/S9：bbl 缺失 → `{bbl:false,undefinedCitations:0}`；最终 pass 1 条 undefined → `undefinedCitations:1`（首轮 `Citation A undefined` 不计）。
- 暴露：`service.compile` / RPC / `srw_paper` 返回完整 outcome（含 bib）；**UI 不展示、不阻断**（client 类型 `{ok,engine,errors,pdfWritten}`，`workbench.tsx:805`）。
- 残余：仅上报；tectonic/latexmk 自处理 bib，不填 bib（设计口径）；真实引擎未验。

### 8.3 越界 / 回归（补充轮）
- 新增改动：`src/writer/service.ts`、`src/writer/compile.ts`、`tests/writer-service.test.ts`、`tests/writer-core.test.ts`、`src/client/workbench.tsx`（G1 按钮）、`README.md`（状态更新）、`lib/**`（随源码重生成）。
- 无 secrets / 无新增绝对路径；public API 仅新增可选 `bib`（`compile` 返回值），沿用既有 `NO_PROVIDER`；错误码与信封未变。
- **文档漂移**：README 写「测试 163→179」，本轮后实为 **181**；建议改为 163→181（或去掉具体数）。
- 测试删除：仅「confirm 拒绝旧大纲」被迁移用例替换（预期行为变更），无其他弱化。

### 8.4 更新后的结论
- 首轮三个保留项（P0-1 fail-loud、P1-1 bbl/undefined、旧大纲迁移）**全部关闭（代码/测试侧）**；**181/181** 全绿。
- 仍为外部门槛：真实 tectonic 出 PDF、CI 首跑、OpenAlex 真网；另：bib 结果未接门禁/UI、README 数字待更新。
- 出口口径：**Phase 0 代码侧达成（保留项已关闭，有外部门槛）**。
