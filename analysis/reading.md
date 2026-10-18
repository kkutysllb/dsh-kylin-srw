# dsh-kylin-srw 精读模块（R6 / M4）深度分析

> 范围：`src/reading/*.ts`（14 文件 2453 行）、`tests/reading-*.test.ts`（10 文件 53 测试）、
> `tests/tools.test.ts` 中 srw_read 两例、`tests/fixture-pdf.ts`、`docs/02-plan/0205-M4-精读.md`（219 行）、
> `docs/01-tech/0102-技术架构.md` §7.1、`src/tools.ts` 的 `srwReadToolDef`、`src/rpc.ts` 的 `reading.*`。
> 方法：全量阅读 + 定向跑测试 + 5 个最小实验（不写 src/tests/docs，只产出本文件）。
> 结论标注三档：**实测**（本会话跑出数据）、**代码事实**（读码可判定）、**风险**（机制推断，未在真论文复现）。

---

## 1. 模块地图与职责

| 文件 | 行数 | 导出 API / 类型 | 职责 |
|---|---|---|---|
| `extract.ts` | 433 | `BlockKind`(13 值)、`BlockQuality`、`BBox`、`ExtractedBlock`、`ExtractResult`、`detectGutter`、`buildLines`、`refineBlocks`、`UNTRANSLATED_KINDS`、`extractPdfBlocks` | PDF→块表：pdfjs 取坐标 → 分栏 → 行重建 → 块切分 → kind 启发式 → 版面二次判别 |
| `pdfdoc.ts` | 388 | `PdfParagraphInput`、`PdfSectionNote`、`ReadingPdfInput`、`resolveCjkFont`、`renderReadingPdf` | 译注版 PDF（pdfkit）：封面/阅读指南/导读/双语正文/速览·备注盒/附录 A–D/页眉页脚 |
| `source-map.ts` | 137 | `SOURCE_MAP_VERSION=1`、`normalizeSrc`、`srcHashOf`、`TranslationMeta`、`SourceMapBlock`、`SourceMap`、`EXTRACTOR_NAME`、`buildSourceMap`、`MigrationReport`、`migrateBlocks` | 稳定块 ID + 源哈希 + 切分变更时的块迁移 |
| `paragraphs.ts` | 191 | `ReadingParagraph`、`AssembledReading`、`joinTexts`、`worstState`、`assembleReading`、`ReadingSection`、`splitSections` | 呈现层段落装配：块→段，分流 references/figureNotes，供面板与 PDF 共用 |
| `translator.ts` | 207 | `LlmPort`、`MAX_CHUNK_CHARS=4000`、`splitLongText`、`TranslateDeps/Input/Report`、`BlockTranslation`、`translateBlocks` | 逐块翻译：句切 → 并发闸 → `llm.stream` 窄消费 → deadline/退避 → 取消 |
| `glossary.ts` | 63 | `Glossary`、`glossaryHash`、`findViolation`、`GlossaryCheck`、`enforceGlossary`、`affectedBlocks` | 术语硬约束：输入侧 prompt + 输出侧检出/替换（含定向失效候选块） |
| `cache.ts` | 59 | `CacheEntry`、`TranslationCache`、`emptyCache`、`cacheKeyOf`、`lookup`、`store`、`invalidateAffected` | cacheKey 四元组 + 不可变缓存更新 + 定向失效（后者未被调用） |
| `budget.ts` | 35 | `BudgetEstimate`、`estimate`、`CalibrationRecord`、`calibrationRatio` | 成本门纯函数（未接线） |
| `notes.ts` | 151 | `SectionNote`、`NotesFile`、`emptyNotesFile`、`SECTION_SYSTEM_PROMPT`、`GUIDE_SYSTEM_PROMPT`、`buildSectionPrompt`、`GuideInput`、`buildGuidePrompt`、`parseSectionOutput`、`NotesDeps`、`generateGuide`、`generateSectionNote` | 译注版分析层：全文导读 + 每节速览/精读备注（字段行文本协议） |
| `verify.ts` | 45 | `VerifyReport`、`verifyPaper` | 校验门：重算源段哈希 → verified/mismatch/orphan/missing |
| `recommend.ts` | 58 | `RecommendCandidate`、`Recommendation`、`RecommendationState`、`INITIAL_RECOMMENDATION_STATE`、`recommendBatch`、`acceptRecommendation`、`rejectRecommendation` | G2 推荐/同意门纯状态机（未接线） |
| `render.ts` | 113 | `BlockState`、`ParsedBlock`、`parsePaper`、`renderPaper`、`renderPaperWithSources`、`ANCHOR_RE`/`ZH_MARK`/`END_MARK` | paper.md 渲染/解析互逆；块锚绑定 |
| `formula.ts` | 58 | `FormulaBlock`、`looksLikeFormula`、`looksLikeTable`、`fetchFormulaLatex`、`placeholderFormulaBlock` | 公式/表格诚实策略（未接线） |
| `service.ts` | 515 | `LlmPort` re-export、`ReadingDeps`、`ReadingStatus`、`ReadingService` | 磁盘域编排：extract/translate/notes/verify/content/exportPdf/status/glossary |

依赖方向：`service` → 其余全部；`paragraphs`/`verify`/`render` 互相只依赖类型；`translator` 与 `notes` 共用 `LlmPort` 窄面，不 import 宿主 SDK（`translator.ts:13-31`）。

---

## 2. 端到端流水线

```
PDF 字节
 └─ reading.extract / srw_read(extract)
    ├─ extractPdfBlocks: getDocument → 逐页 getTextContent → 过滤旋转/空 item
    ├─ detectGutter（x 中心直方图）→ 双栏逐 item 归栏 → 栏内 buildLines
    ├─ groupBlocks（行距/字号）→ kindOf（块自身）→ order/bbox/quality
    ├─ refineBlocks（全页语境：furniture/title/references/figlabel）
    ├─ buildSourceMap（srcHash/chars/bbox）→ migrateBlocks（旧 map 存在时）
    └─ 落盘 reading/<paperKey>/{source_map.json, sources.json}
 └─ srw_read(translate) 分批 ≤40 keys（仅提示词纪律）
    ├─ wanted = 非 UNTRANSLATED_KINDS；pending = 无 cache 命中（或 force）
    ├─ translateBlocks: 每块 ≤4000 字符句切 → Limiter(3) → llm.stream → deadline 120s/退避 500ms×2
    ├─ enforceGlossary 修复 → cache.store
    ├─ rewriteMapTranslations（map 写 translation 元数据）
    └─ renderPaperWithSources → paper.md → verifyPaper（锚内 state 不回写）
 └─ reading.verify / content：parsePaper + verifyPaper → 三态 states
 └─ srw_read(notes)：assembleReading → splitSections → generateGuide/逐节 generateSectionNote → notes.json
 └─ reading.export / srw_read(export)：assemble（paper.md+map+verify）→ renderReadingPdf
    → <project>/readings/<YYYY-MM-DD>/<paperKey>.pdf（同日覆盖）
```

关键落点与行号：

1. **抽取入口** `extractPdfBlocks`（`src/reading/extract.ts:356-432`）：`doc.getPage` 逐页、`getViewport({scale:1})` 取页宽高（`:367-368`）；item 只保留含 `str` 且非空者（`:371-373`），旋转文本按 `transform[1]/[2]` 非零剔除（`:374-378`）。
2. **分栏** `detectGutter`（`:76-106`）：页宽 24 bins、按 item **中心**计数，找「宽度 ≥2 bins 的空带且左右都有内容」的最宽者；`items.length<8` 直接单栏（`:77`）。双栏分支逐 item 归栏（`:394-403`），跨栏 item 单独收集并在页尾追加（`:407-411`）。
3. **行/块** `buildLines`（`:109-156`）以 y 容差 `max(1.5, 0.5×中位字高)` 分桶（`:119-131`），桶内 x 升序、间距 >0.2×字高补空格（`:136-143`）；`groupBlocks`（`:181-216`）用 `gap ∈ (0, 1.8×字号]` 且字号差 ≤`max(1, 0.35×字号)` 合并同段。
4. **kind** `kindOf`（`:221-235`）只产 `heading/abstract/caption/para`；`title` 故意留给二次判别（注释 `:218-220`）。
5. **版面二次判别** `refineBlocks`（`:256-349`）：① 页缘 62pt 内短行→`furniture`（`:268-275`）；② p1 前 8 块字号最大且 ≥1.08×正文字号→`title`（`:277-297`）；③ References 三形态→进入 refs 段并把其后全部标 `reference`（`:299-320`）；④ 孤立短碎片→`figlabel`（`:322-346`）。
6. **落盘** `service.extract`（`src/reading/service.ts:225-257`）：读 PDF→抽取→`sources` 字典→`pdfSha256`→`buildSourceMap`→旧 map 迁移→原子写 `source_map.json`（`:253`）与 `sources.json`（`:255`）。
7. **翻译编排** `service.translate`（`:261-297`）：map 缺失→`NOT_FOUND`；LLM 缺失→`INVALID`；`pending` 只含 cache miss（`:274-278`）；`translateBlocks` 后若有 failures **先抛错再写缓存**（`:285-293`）；然后 `rewriteMapTranslations`（`:294`）、`renderPaper`（`:295`）、`status`。
8. **渲染/校验** `renderPaper`（`:335-350`）以 `map+sources+cache+glossary` 现算译文重写 paper.md；`verifyPaper`（`src/reading/verify.ts:19-45`）重算锚内源段哈希。
9. **分析层** `generateNotes`（`service.ts:147-198`）：导读缺失才生成（`:163-176`），节备注只补缺失、并发 2、单次 1–12 节（`:177-187`），原子写 `notes.json`（`:195`）。
10. **导出** `exportPdf`（`:380-476`）：`assemble`→标题/作者启发式→摘要统计（`:405-412` 只统计可译块）→`renderReadingPdf`→按日期路径写 PDF（`:452-462`）。

---

## 3. 算法细节

### 3.1 双栏判别

- 直方图分 24 bins（bins 宽 = 页宽/24），统计的是 **item 中心**（`extract.ts:81-85`）；gutter 只接受「完全无 content 的连续 bins」，且要求左右各至少有一个 content bin（`:86-103`）；边缘 10%（≥2 bins）不参与（`:87`），避免把页边距当 gutter。
- 归栏：`x0<gutter && x1>gutter` 且跨出量 >0.1×item 宽 → straddler（`:400`）；否则按中心左右分（`:401-402`）。
- 阅读序永远是「左栏全部 → 右栏全部 → straddler 追加」，从不在全页按 y 排序（文件头注释 `:6`，`:404-411`）。
- **实测风险**：用纯双栏 16 item 得 gutter=242.25；加入一条跨栏整宽标题（x=80,w=450）后 gutter 变成 191.25（空带被移到标题中心与左栏之间）。原因是宽 item 只占其中心一个 bin，整宽元素会把「真空带」挤到别处；一旦 gutter 落错，左栏部分行会被判进右栏，阅读序交错。真论文 p1 的标题/摘要恰是整宽元素，属于**未覆盖场景**。
- **实测缺陷（阅读序）**：straddler 被**追加到页尾**，不是按 y 插回原位。构造「整宽标题 + 左右各 6 块」的 1 页 PDF，抽出 13 块，标题是 `p1-b13`（最后一块），物理位置却在页顶（y=740）。这会让 paper.md / PDF 正文流里标题出现在页面正文之后。
- 同一实验还暴露 **62pt 页缘带与标题冲突**：标题 baseline y=740、页高 792 时 `pageH-yTop=52 < 62`，先被判 `furniture`（`:272-274`），随后 `title` 重选又要求候选不是 furniture（`:282`）→ **该页无 title**（实测 `any title:false`）。`0205` 与测试注释假设「真论文标题不在页缘带内」（`tests/reading-extract.test.ts:11-12`），该假设对 margin<62pt 的模板不成立。

### 3.2 行重建与块切分

- 行 bucket 用「与桶首 item 的 y 差」比较（`extract.ts:124-131`），存在误差累积（链式漂移）风险；`line.height` 统一取全页中位字高、`line.size` 取桶内最大（`:151-152`），因此 bbox 高度不是逐行真实高度。
- 补空格判据 `gap > item.height*0.2`（`:138-140`）；`buildLines` 最后 `replace(/\s+/g,' ')`，块内文本永远单行（这也让后续 `normalizeSrc` 的连字断行规则很少触发）。
- 块合并阈值偏保守：真实 PDF 若 leading≈字高，`gap = prev.yBottom - line.y` 可能为 0，`gap>0` 不成立（`:186`）→ 每行独立成块。这解释了对 fixture 的依赖：测试 fixture 行距 14pt/字号 10 才稳定并段。

### 3.3 稳定块 ID 与哈希

- ID = `p{page}-b{index}`，index 是**页内阅读序**（`extract.ts:417-430`）。切分算法变一次，所有 id 都可能漂移。
- 稳定性靠 `srcHash`：`normalizeSrc` = 去连字断行 → NFKC → 破折号统一为 `-` → 空白折叠（`source-map.ts:13-20`）；`srcHashOf = sha256(全 hex)`（`:23-25`）。
- `migrateBlocks`（`:93-137`）把旧块按 srcHash 入池，新块依序 `shift()` 认领（重复哈希按序一一配对，`:105-107`），救回的携带 `translation` 元数据（`:132`），未认领旧块进 `orphans`（`:135`）。迁移是**无条件**的（只 gate `schemaVersion`，`service.ts:247`）；`EXTRACTOR_NAME` 被同时写进 `name` 与 `version`（`source-map.ts:67`），指纹无法区分算法 v1/v2（refineBlocks 上线也未 bump）。
- 不变量：`translation` 元数据只记 `cacheKey/model/at`，真正译文在 `cache.json`；`rewriteMapTranslations`（`service.ts:308-332`）在每次 translate 后按 cache 现值**重新派生**，cache miss 时会把旧 translation 元数据丢掉。
- 数据缺口：`migrateBlocks` 的 `orphans` 只被取 `.length` 报数（`service.ts:247-252`），孤儿块的译文元数据不落盘、不可恢复，与 `source-map.ts:2-4` 「记 orphan（报告出来，不静默丢弃）」的承诺不完全一致。

### 3.4 段落装配（呈现层）

- 只在「前块不以句末标点收尾」且「新块 kind=para」时续拼（`paragraphs.ts:99-128`）；`TERMINAL_RE` 含中英句号/问叹/省略号和可选收尾引号括号，分号冒号不算（`:34`）。
- `joinTexts`：`[A-Za-z]-$` 去连字符直拼；CJK 邻接不加空格；其余补空格（`:38-45`）。
- `worstState`：mismatch > orphan > verified（`:47-51`）；段内任一块 mismatch 整段报警。
- 精读版分流（`:99-150`）：`furniture` 丢弃；`figlabel` 进 pending 队列、不直接入流；`reference` 单独进 `references`；caption/heading/title 作为独立段并在入流后结算碎片归属（`:138-150`）。
- 碎片归属算法（`flushLabels`，`:83-98`）：从记录位置向后找首个 caption；找不到后退回最近的前置 caption；都没有就丢弃。归属锚是 caption 段 id（段 id = 段首块 id）。
- **边界风险**（代码事实）：`pos` 记录的是 push 时的 `flow.length`，而当时可能仍有未 flush 的 `current`。若碎片之前有一段正文尚未入流，`pos` 指向「该正文将要占的位置」，caption 的实际下标更大，逻辑仍成立；但若未来允许 caption 与正文合并，该定位会失准。目前测试覆盖了「有后续 caption」「只有前置 caption」「无 caption」三例（`tests/reading-paragraphs.test.ts:76-109`）。
- `splitSections`（`:166-191`）以 `kind==='heading'` 切节，首标题前为 `headingId=undefined` 的导语（题名/摘要）。

### 3.5 标题行（section headings）

- 数字编号 `^\d+(\.\d+)*\s+\S`、罗马数字 `^[IVXLCDM]+\.\s+\S`、关键词（abstract/introduction/related work/conclusion/references/摘要/引言/结论）（`extract.ts:226-229`）。
- 附加约束：`lineCount<=3`、首行 ≤120 字符（`:226`）。行合并把标题与首段并进一块时（行距小）会漏判；无编号的全大写节标题（如 `INTRODUCTION`）只能命中关键词表。
- 罗马数字规则来自 fan2024 活体回归（`docs/02-plan/0205-M4-精读.md:217`）；references 三种形态同理（`:211-216`）。

### 3.6 References 三形态与「英文原样」

`refineBlocks` 逐块顺序扫描 `inRefs`（`extract.ts:303-320`）：

1. 独立成块 `^references$` → 该块 `heading`，开启 refs；
2. 与首条目同块 `^references\s*\[\d+\]` 或 `^references\s+[A-Z]` → 整块 `reference`；
3. 被前段末行吞并 `/\breferences\s*$/` 且 ≤120 字符且无句末标点（如 `work. References`）→ **只开启 refs，块本体保持 para**（仍可译）。

开启后其后所有块→`reference`。`UNTRANSLATED_KINDS = {furniture,figlabel,reference}`（`:353`）使翻译层、`status.pendingIds`、`remaining` 全部按可译块计算。风险：refs 之后的致谢/附录也会被标 reference（论文体例通常附录在后，未做反向判定）。

### 3.7 图注与图内标注

- caption：`/^(figure|fig\.|table)\s*\d+\s*[.:]/i` 且 `lineCount<=10`（`extract.ts:231-234`），刻意要求编号+冒号/点，避免把 `Figure 1 shows…` 正文句误收。
- figlabel（`:322-346`）多重与门：长度 ≤30、词数 ≤4、非放大字号、单行、无句末标点、不以小写开头、上下同栏间隙都 >2.6×正文字号、本页或后 2 页存在 caption。收紧过程见 0205 附记四（`docs/02-plan/0205-M4-精读.md:213-217`）：首版 ≤60 字符误伤 fan2024 跨图续行，后改为 ≤30+≤4 词+拒小写。
- 归属只在呈现层做（`paragraphs.ts:83-98`），PDF 里挂在 caption 下（`pdfdoc.ts:246-249`）。

### 3.8 分析层（导读/精读备注）

- 输出是**字段行文本**而非 JSON（`notes.ts:1-5` 说明理由：LLM JSON 可靠性不足），解析用「【本节速览】/◆精读备注」两标记切段（`:85-95`）；缺标记时整段退为 note（宁可有内容不造假结构）。
- prompt 强约束字段名（`:30-42` 节备注：要点/概念/论证/证据/评述，评述必须含「译者判断」；`:44-55` 导读：类型判定/一句话概括/要解决的问题/章节地图/如果只记三件事）。
- 节译文输入截断 4000 字符（`:65`），无截断提示；导读摘要截断 2000（`:78`）。
- 节候选要求「有 headingId 且有已译段」（`service.ts:177-180`）→ 摘要（headingId=undefined）不生成节备注，只进导读摘要输入。
- 失败恢复：单节失败被 catch 吞掉（`service.ts:184-186`），重跑只补缺失；`limit` 1–12 默认 6（`:181`）。每次调用最多 12 节，工具调用没有暴露 limit 参数（`tools.ts:692-698` 仅 keys/pdfPath）。

### 3.9 公式/表格

- `formula.ts` 只有启发式与占位块：公式符号 ≥3 且含拉丁字母（`:22-25`）；`fetchFormulaLatex` 走 ar5iv HTML 的 `alttext` 粗匹配（`:34-47`），失败返回 undefined。
- **代码事实**：`extract.ts` 从不产出 `formula/table/list/code/footnote` kind（`kindOf` 只返回 4 类，`refineBlocks` 只加 title/furniture/reference/figlabel）；`FormulaBlock`/`imageRef` 未被 service/pdfdoc 引用。0102 §7.1.2 的「公式图片化 + 标注非可编辑源」在本轮**只有纯函数与单测**，端到端未落地。

### 3.10 预算/并发/缓存/术语门

- `budget.estimate` = `ceil(chars/4×2)`，预算>0 才需确认（`budget.ts:13-22`）；`calibrationRatio` 只做平均（`:31-35`）。**未接线**：`srw_read`/RPC 无预算参数，工具描述也无成本门。
- 并发闸：`translateBlocks` 默认 3，夹在 1..6（`translator.ts:129`）；`Limiter` FIFO（`src/util/limiter.ts:6-46`）。**代码事实**：闸只围住「块」这一层，而块内超长句切后 `Promise.all(chunks.map(...))`（`translator.ts:152`）→ 一个 12000 字符的块可同时发起 3 个 LLM 调用，实际并发可达 `concurrency × 块内片数`。
- deadline：`timeoutOf(120s)`（`translator.ts:130,158`）；退避 500ms×2、`attempts=3`（`:131,153-155`）。重试判定 `isRetryable: () => !aborted`，即**所有错误都重试**，包括鉴权/参数错误。
- 缓存键 = `sha256(target\nmodel\nsrcHash\nglossaryHash)` 取 24 hex（`cache.ts:29-33`），`glossaryHash` 排序后取 16 hex（`glossary.ts:13-19`）；`target` 固定 `'zh'`（`service.ts:303-306`）。
- 术语硬约束：prompt 注入（`translator.ts:74-80`）+ 译后 `enforceGlossary` 默认 repair（`glossary.ts:37-51`）。**代码事实**：service 只取 `check.repaired`（`service.ts:288-291`），`violations` 不落盘不上报——「硬约束」是静默替换，无审计线索；替换用词边界正则，CJK 术语用裸 `indexOf`/`replace`，可能误改译文里合法的英文引用。

---

## 4. 数据契约与不变量

### 4.1 磁盘布局

`<root>/<project>/reading/<paperKey>/`（`service.ts:64-68`，slug/paperKey 校验 `:50-53`）：

- `source_map.json`（原子写，`:83-94,253`）
- `sources.json`（id→源文，`:255`）—— **0205 §1 未记载的 sidecar**
- `paper.md`（`:348`，**非原子写** `:96-100`）
- `cache.json`、`glossary.json`、`notes.json`（`:110-120`）
- 导出物另走 `<root>/<project>/readings/<YYYY-MM-DD>/<paperKey>.pdf`（`:452-462`）

路径护栏 `assertInsideRoot` 只校验「在科研总根内」（`src/host.ts:86-98`，`service.ts:70-72`），**不校验在项目内**：`extract` 的 `pdfPath` 可写 `../<other-project>/...` 读取总根内其它项目文件（`service.ts:230-231`）。只读语义下影响有限，但契约上 pdfPath 声称是「库内相对路径」。

### 4.2 paper.md 结构

```
<!-- srw-paper <paperKey> -->            render.ts:73 / :101
<!-- srw:<id> kind=<kind>[ state=<state>] -->   render.ts:9,83
<源文>
<!-- srw:zh -->                          render.ts:10
<译文>
<!-- /srw -->                            render.ts:11
```

- 锚必须独占一行（`ANCHOR_RE` 全行匹配 `render.ts:9`）；`parsePaper` 用三态 phase 解析（`src`, `zh`）（`:22-65`）；渲染侧把连续 3+ 换行折叠为 2（`:78,110`）——若源文本身含 3 连空行会被改写（抽取块是单行文本，当前不触发）。
- `state=` 通道存在但 service 渲染时从不写入（`service.ts:347` 只传 3 参，`render.ts:99` 默认 `{}`；`ParsedBlock.declaredState` 也无人消费）——校验态实际来自 `verify.states`。
- 不变量：**译文不参与哈希**（`verify.ts:35` 只 hash `sourceText`）；源段被手改 → mismatch；手改译文 → verified（测试 `tests/reading-render.test.ts:57-67`）。

### 4.3 source_map

`{schemaVersion, paperKey, source:{pdf,sha256,pages}, extractor:{name,version,ranAt}, blocks:[{id,kind,order,page,srcHash,chars,bbox,quality,translation?}]}`（`source-map.ts:47-53,68-77`）。**不存源文**（`sources.json` 承担），`size` 故意不入 map（`extract.ts:37`）。

**实测缺陷**：`source.pages = Math.max(0, ...blocks.map(b=>b.page), 0)`（`source-map.ts:66`）由块反推。1 页但无文本层的 PDF → `blocks=[]` → `pages=0`（实测），而 `extract` 的返回值用 `extracted.pages=1`（`service.ts:256`）——同一篇论文两处页数不一致；PDF 封面「篇幅」与状态栏都会显示 0 页。
另：块极大时 `Math.max(...spread)` 有栈溢出风险，只是现实规模够不到。

### 4.4 cache.json / glossary.json

- `{entries:{<24hex>:{text,model,at}}}`；`store` 不可变（`cache.ts:41-43`）；无淘汰策略，只增不减（唯一清空点是改术语表，`service.ts:217-219`）。
- `glossary.json = {entries:{term:译名}}`；`setGlossary` trim 并丢空值（`:209-214`）。
- **代码事实（与计划冲突）**：Task 4.5 与 0102 §7.1.3 要求「改术语表只失效受影响块」「定向失效」，实现是**整表清 cache**（`service.ts:217-219`，注释自认取舍）；`affectedBlocks`（`glossary.ts:55-63`）与 `invalidateAffected`（`cache.ts:47-59`）全仓无调用者（grep 证实）。测试 `reading-service.test.ts:105-119` 断言的也是「重译全覆盖」，等于把降级行为固化成了验收。

### 4.5 notes.json

`{version:1, model, at, guide?, sections:{<headingId>:{summary,note}}}`（`notes.ts:17-24`）。可恢复性 = 只写缺失节 + 导读只生成一次；**没有模型变更失效**（`service.ts:160-161` 沿用旧 guide/sections，只在落盘时覆盖顶层 `model`）。

### 4.6 verify 门规则

- `verified` = 锚内源文哈希 == map.srcHash；`mismatch` = 不等；`orphan` = 锚 id 不在 map；`missing` = map id 未出现在 paper.md（`verify.ts:27-44`）。
- 门是**展示性**的：PDF 段首标 `[id] ⚠ 源文被改`（`pdfdoc.ts:77-80,218-221`），面板亮徽章（`workbench.tsx:1176-1182`），但没有任何 API 阻止引用/导出。0102 §7.1.4 说「UI 红标并禁止该产物进入正文引用」；写作线的引用审计不读 reading 状态（`src/writer/cite-audit.ts` 无 `reading` 引用），该禁止点尚未实现。
- **语义漂移**：`status` 用 `verify.verified.length` 统计所有 paper.md 块（含 reference 等不可译块），而 `translatable` 排除了 3 类（`service.ts:486-494`）；`missing` 又用 `max(0, translatable - verified - mismatch - orphan)` 兜底。结果：有参考文献的论文 `verified` 会大于 `translatable`，`missing` 恒 0，面板「✓ N」的口径与「可译 M」不一致；`exportPdf` 则正确按 `translatableIds` 过滤（`:406-412`）。两套统计并存。

### 4.7 幂等续跑与分批协议

- extract 重跑：无条件迁移，译文元数据按 srcHash 救回（`service.ts:243-252`）。
- translate 重跑：cache 命中零 LLM 调用（测试 `reading-service.test.ts:88-103`）；`force` 全量重打。
- notes 重跑：只补缺失节。
- export 重跑：同日同路径覆盖（测试 `reading-pdf.test.ts:181-184`）。
- 批次协议：`status.pendingIds`（≤600，`tools.ts:611,631-639`）→ `translate{keys}` → 返回 `remaining`（`tools.ts:649-661`）→ `remaining=0` → `notes` → `export`。**40 块/批没有服务端强制**：`"40"` 只出现在工具描述与 hint 文案（`tools.ts:607,658,686,697`），`rpc.ts:352-360`/`service.translate` 对 keys 数量无上限。工具超时 300s（`tools.ts:702`）。
- **代码事实（续跑断点）**：一批里只要 1 块失败，`service.translate` 在写缓存前抛 `UPSTREAM`（`:285-287`），该批**已成功的译文全部丢弃**；重试要重烧整批 token。缓存写入 / paper.md 更新也都不发生，用户看到一次失败却丢了整批进度。

---

## 5. 失败模式与降级

| 失败 | 现状 | 评级 |
|---|---|---|
| `pdf.worker.mjs` 未随构建复制 | 构建脚本已复制（`scripts/build.mjs:97-99`），M4-1 勘误记录「bundle 同目录」教训；单测直接 import node_modules，**测不到打包路径** | 已修复，回归靠人工 |
| pdfjs 依赖缺失/加载失败 | `loadPdfjs` 中文 fail-closed 报错（`extract.ts:66-72`） | 好 |
| 损坏/加密 PDF | `getDocument` 拒绝原样上抛 → RPC `internal`（`rpc.ts:37-43`），无 ServiceError 语义 | 可接受 |
| 无文本层（扫描件） | `items.length===0 → continue`（`extract.ts:387`），service 不检查 0 块 → 成功落盘空 map，`status` 显示 extracted=true/0 块，工具 hint 会提示「全部已译」→ 可导出空 PDF。0102 §7.1.2 要求「提示用户，不静默产出空精读」 | **未实现** |
| `sources.json` 丢失/损坏 | `readJson` 失败返回 undefined → `{}`（`service.ts:268,338`）→ 翻译输入空、渲染源文空 → verify 全 mismatch，无错误提示 | 风险（代码路径） |
| pdf 被替换 | map 存了 pdf sha256 但 translate/render 从不比对（`source-map.ts:50`；grep 无消费者） | 风险 |
| LLM 缺席 | `translate`/`notes` 报 `INVALID`，extract/status/verify 正常（`service.ts:264-265,154-155`）；测试覆盖（`reading-service.test.ts:121-135`） | 好 |
| 默认模型未配置 | `llmConfig()` 抛 `NO_PROVIDER`（`src/service.ts:100-107`）；但 `status.llmAvailable` 只看 `llm() !== undefined`（`service.ts:481,506`）→ 状态栏可能显示「可用」而翻译报错 | 小不一致 |
| LLM 上下文/超长块 | 块内 ≤4000 字符句切（`translator.ts:33-62`），无句读硬切 | 好 |
| LLM 输出截断 `finish.reason='length'` | 只把 `error/aborted` 当失败（`translator.ts:172-174`）→ 截断译文被当作成功写入缓存；notes 完全忽略 finish（`notes.ts:107-116`） | **风险/缺口** |
| 重试/退避 | 3 次、500ms×2、逐块 120s（`translator.ts:129-131,152-181`） | 好 |
| 外部取消 | 外层 `Promise.race` 立即 reject（`translator.ts:143-147,200-206`），但已排队 worker 仍以已 abort 的 signal 进入 `timeoutOf`；`timeoutOf` 无「已 abort 快速失败」分支（`src/util/timeout.ts:30-33` 仅注册监听）→ 每个迟到任务要等满 deadline | 风险（实测见 §6） |
| 并发闸 | 块内分片绕过闸（见 §3.10） | 风险 |
| CJK 字体 | 回退链仅 macOS/Linux（`pdfdoc.ts:61-68`），无 Windows 字体（msyh/simsun）；全 miss 时 `FONT_MISSING` fail-closed（`:144-147`） | Windows 不可用 |
| `⚠`(U+26A0) 字形 | Hiragino 子集无该码位；用自有抽取器回读译注版 PDF 时该字符变成 `\u0000`（实测），问题段警示符可能显示为空框 | 小 |
| PDF 页眉/页码 | **实测 bug**：9 页产物只有最后一页有页脚，且写的是 `1 / 1`；任何页都没有页眉（详见 §7） | 确定缺陷 |

---

## 6. 测试覆盖评估

### 实测结果

| 命令 | 结果 |
|---|---|
| `node --import tsx --test tests/reading-extract/sourcemap/paragraphs/cache/render/refine/extras .test.ts` | 35 tests，35 pass，0.63s |
| `… tests/reading-service.test.ts` | 5 pass，0.74s |
| `… tests/reading-pdf.test.ts` | 5 pass，0.91s |
| `… tests/reading-*.test.ts`（全部） | 53 pass，**wall 61.4s** |
| `--test-name-pattern=外部取消` 单测 | 用例 32ms，**进程 60.2s 才退出** |

`reading-*.test.ts` 合计 53 测试；加上 `tests/tools.test.ts:308-397` 的 srw_read 两例 = 55。全部通过，但整套耗时被取消用例拖到 61s：`translateBlocks` 的 `timeoutOf(60_000)` 定时器在「signal 已 abort」时不提前释放（`timeout.ts:30-33`），迟到 worker 要等满 deadline（本会话实验：已 abort 的 external + 700ms deadline 实测 702ms 才 reject）。这意味着 `npm test` 的下限被一个测试细节拉长，且**取消的及时性只在「外层 race」层面被证明，流级中断未被证明**。

### 已证明行为

- 抽取：单栏并段/heading、双栏不交错、straddler 标 suspicious 且不进 ok 流、gutter 单簇不误判（`reading-extract.test.ts` 5 例）。
- 版面二次判别：furniture、p1 title 重选、venue/arXiv 排除、References 三形态、figlabel 收紧（`reading-refine.test.ts` 8 例）。
- 哈希/迁移：NFKC/连字归一、重复哈希一一配对、orphans 计数（`reading-sourcemap.test.ts` 4 例）。
- 装配：续段/句末不并、连字/CJK 拼接、最坏态、三通道分流、分节（7 例）。
- 翻译链：切块、usage 汇总、重试、超时、并发上限、外部取消、术语表入 prompt（8 例，假 LLM）。
- 缓存/术语：四元组敏感性、定向失效纯函数、违规检出与替换（4 例）。
- paper.md 往返/verify 三态（4 例）。
- Service 全链、增量零调用、术语表触发重译、LLM 缺席降级、非法 paperKey（5 例）。
- 译注版 PDF：自有抽取器回读验证 15 项结构（`reading-pdf.test.ts:91-136`，需 CJK 字体）；notes 失败恢复 + export 同路径覆盖（`:138-198`）。
- 工具面：审批全豁免、status→分批 translate→remaining→notes→export（`tests/tools.test.ts:308-397`）。

### 未覆盖 / 只在合成数据上成立

1. **没有真实 PDF fixture**（`tests/fixture-pdf.ts:1-50` 手写最小 Type1 PDF）。双栏页只有规则网格；无一页内「整宽标题+双栏正文」、无跨页表格、无真实 arXiv PDF。真论文回归是 0205 里的**一次性人工**记录（`docs/02-plan/0205-M4-精读.md:205-219`），不进 CI。
2. `refineBlocks` 测试直接喂 `ExtractedBlock` 数组（`reading-refine.test.ts:9-26`），绕过 buildLines/groupBlocks——版面判别的输入分布未与真实抽取对齐。
3. 未测：无文本层 PDF、空 PDF、损坏 PDF、PDF 页数/块数极端值、`source_map.pages` 契约。
4. 未测：RPC 的 6 个 `reading.*` 端点（`tests/host.test.ts` 用 `handleSrwRpc` 但不含 reading），只测了 tool 层。
5. 未测：打包产物路径（pdf.worker/pdffonts）——M4-1/M4-3 的坑都只能活体暴露。
6. 未测：部分失败（1 块失败 → 整批进度丢失）、`finish='length'`、已 abort signal 的快速失败。
7. PDF 结构测试对字体环境**二选一**：无字体时 `FONT_MISSING` 断言执行、结构回读 skip；有字体时反过来（`reading-pdf.test.ts:78-91`）——两条分支无法在同一 CI 同时验证。
8. 未断言页眉/页码是否存在——所以 §7 的确定性 bug 一直全绿。

---

## 7. 设计亮点与风险

### 亮点

1. **基底层/呈现层分离**（`paragraphs.ts:1-8`；0205 附记三）：块是校验/缓存/迁移的唯一锚，段落只做阅读体验；改呈现不需重译、不破坏 verify。这是整个模块最正确的架构决策。
2. **结构性防幻觉**：块锚 + 源文哈希 + 译文不参与哈希（`render.ts`/`verify.ts`），把「译文绑真源」从提示词祈祷变成可计算的约束；活体篡改实验（0205:84-85）证明约束成立。
3. **稳定 ID + 哈希迁移**：换切分算法不丢用户数据，重复哈希按序配对（`source-map.ts:93-137`），失败只报 orphan 不静默丢（设计意图正确，落盘有缺口见 §4.3）。
4. **真实语料驱动的启发式迭代**：References 三形态、figlabel 收紧、罗马数字节标题都来自 pepar-review 五篇活体回归（0205:205-219），不是拍脑袋；`refineBlocks` 的注释保留了「为什么不用 X」的证据。
5. **LLM 窄面 `LlmPort`**（`translator.ts:14-31`）：只声明用得到的 chunk 形状，宿主 ABI 变化不侵入业务；测试可完全用假 LLM 驱动，单测不花钱、不联网。
6. **分析层「可恢复 + 分批」**：notes 只补缺失节、limit 分批、pending 计数回报（`service.ts:177-197`），把 LLM 的不稳定变成可重入流程；字段行协议（非 JSON）是对模型能力的诚实评估。
7. **译注版 PDF 的体例工程**：封面信息表、阅读指南、速览/备注盒、附录 A–D、图内标注、页眉页脚骨架（`pdfdoc.ts:143-330`）；CJK 字体回退 + glyph 子集内嵌；用**自己的抽取器回读产物**做验收（`tests/reading-pdf.test.ts:119-135`），闭环很漂亮。
8. **引擎车道而非插件后台**：面板只负责发起（`workbench.tsx:528-591,677-703`），长任务在会话里可见可中断；`selectPanel(null)` + 400ms 挂载 + 双通路 + 剪贴板兜底，是对宿主时序的真实把握。
9. **fail-closed 的路径护栏**与「LLM 缺席只降级翻译」的可用性分层（`service.ts:58-72,264-265`）。
10. **批处理协议写进工具描述**而不是藏在代码里（`tools.ts:686-697`），agent 可读、可续跑。

### 确定性缺陷（本会话实测）

1. **译注版 PDF 页眉/页码只作用于最后一页，页码错误** — `renderReadingPdf` 构造 PDFDocument 时未启用 `bufferPages`（`pdfdoc.ts:149`），pdfkit 在 `addPage()` 时会 `flushPages()`（`node_modules/pdfkit/js/pdfkit.js:7079-7081`），已写出的页面不再可切换；末尾 `bufferedPageRange()` 只返回当前页（`pdfkit.js:7106-7116`），故 `for i` 只跑一次，`i>range.start` 永不成立（页眉永不写），页脚写成 `1 / 1`（`pdfdoc.ts:314-327`）。实测 9 页 PDF：仅第 9 页出现 `1 / 1`，无任何页眉。修复=`new PDFDocument({..., bufferPages:true})`。
2. **整宽元素阅读序颠倒** — straddler 追加页尾（`extract.ts:407-411`）：实测整宽标题成为 `p1-b13`（页内最后），物理在页顶。
3. **62pt 页缘带可吞标题** — 同一实验里 y=740/页高 792 的标题先判 furniture，`title` 重选又跳过 furniture（`extract.ts:272-274,282`）→ 全文无 title（实测 `any title:false`）。
4. **`source_map.pages` 由块反推** — 无文本层 PDF 得 `pages:0`（实测），与 `extract` 返回值不一致（`source-map.ts:66` vs `service.ts:256`）。
5. **测试套件被 60s 定时器绑架** — 实测单测 60.2s，全文件 61.3s（§6）。

### 风险/技术债/TODO（按影响排序）

| # | 事项 | 证据 | 建议 |
|---|---|---|---|
| R1 | 部分失败丢整批进度/token | `service.ts:285-293` | 先落已成功缓存再抛错，或在 failures 里返回 partial |
| R2 | `finish='length'` 静默截断入缓存 | `translator.ts:172-178` | 视为失败/标记，禁止截断译文落 cache |
| R3 | 术语表变更=全量重翻（与计划冲突） | `service.ts:217-219`；`cache.ts:47`、`glossary.ts:55` 死代码 | 接 `affectedBlocks`+`invalidateAffected`，或更新 0102/0205 口径 |
| R4 | 预算门/推荐 G2/公式策略全部未接线 | grep：`estimate(`/`recommendBatch`/`placeFormulaBlock` 仅测试引用 | 明确标注 M5+，避免文档「已完成」误导 |
| R5 | `quality`(suspicious) 无消费者 | grep 无读取方 | 面板/PDF 标级，或删字段 |
| R6 | 抽取器从不产 formula/table/list/code/footnote | `extract.ts:221-235` + grep | 收窄 BlockKind 或实现 |
| R7 | 无文本层不报错、静默空产物 | `extract.ts:387`；`service.ts:238-256` | blocks==0 且 pages>0 → 显式 `NO_TEXT_LAYER` 提示 OCR |
| R8 | `sources.json` 缺失无检测 → 全 mismatch | `service.ts:268,338`；`render.ts:105` | 缺失时 fail-fast，或从 PDF 重抽 |
| R9 | extract 的 pdfPath 可跨项目读 | `service.ts:230` + `host.ts:94-98` | 增加 project 级 contains 校验 |
| R10 | `status` 与 `export` 统计口径不一致 | `service.ts:486-494` vs `:406-412` | 统一为 translatable 口径，`missing` 用 `verify.missing` |
| R11 | paper.md 译文手改会在下次 translate 被覆盖 | `service.ts:294-296,335-349`（cache 才是真相） | 文档明示或做写回 |
| R12 | 迁移 orphan 译文未持久化 | `service.ts:247-252` | 写 `orphans.json` 或在 map 保留 |
| R13 | 取消时迟到任务等满 deadline；同时拖慢测试 | `timeout.ts:30-33` 实测 702ms/60s | `timeoutOf` 开头加 `if (external?.aborted) throw UpstreamError` |
| R14 | 超长块分片绕过并发闸 | `translator.ts:150-152` | 分片也走 Limiter，或按片计费 |
| R15 | 40 块/批只靠提示词 | `tools.ts:686,697`；`service.ts:270-273` | 服务端 clamp keys 长度并返回提示 |
| R16 | `CURRENT_YEAR=2026` 硬编码 | `recommend.ts:28` | 用时钟注入 |
| R17 | dead code：`require0`+底部重复 import | `service.ts:511-515`；`kindOf` 的 `bodySize` 未用（`:221`）；`renderPaper` 占位路径（`render.ts:68-92`） | 清理 |
| R18 | `EXTRACTOR_NAME` 同时当 version | `source-map.ts:55,67` | 分离 name/version，算法变更 bump version |
| R19 | cache 无上限、无淘汰 | `cache.ts` / `service.ts:292` | 加 TTL/条数上限 |
| R20 | 字体链无 Windows | `pdfdoc.ts:61-68` | 补 msyh/simsun/NotoSansSC |
| R21 | notes 无模型变更失效、摘要不入节备注 | `service.ts:160-161`、`:177-180` | notes 记 per-section model，摘要单独成节 |
| R22 | `reading.notes` 无 RPC（只有 agent tool） | grep `rpc.ts` 无此端点 | 面板走 agent 属设计，但外部契约不对称 |
| R23 | 文档漂移 | 见下 | 更新 0102/0205 |

### 文档与实现漂移清单

- 0205 §1 写 `meta.json`；实现是 `source_map.json` 内嵌 `extractor` + 独立 `sources.json`（`docs/02-plan/0205-M4-精读.md:21-27` vs `source-map.ts:47-53`、`service.ts:255`）。
- 0205 §1 与 0102 §7.1.1 写 `quality` 三态 `ok|suspicious|degraded`；实现只有两态（`extract.ts:19`）。
- 0102 §7.1.1 列 11 种 kind；实现 13 种（多 `furniture/figlabel`，`extract.ts:10-17`），但实际只产出 7 种。
- 0102 §7.1.3 写「改术语表定向失效」；实现整表清空（见 R3）。
- 0102 §7.1.4 写译文用 `> ` 引用块/折叠标记、导出走 LaTeX 通道；实现是 `<!-- srw:zh -->` 标记 + pdfkit（0205 附记已改口径，0102 未回写）。
- 0102 §7.1.4 写「mismatch 禁止进入正文引用」；实现只有 UI 警示（§4.6）。

---

## 8. 对外接口

### 8.1 Agent 工具 `srw_read`（`src/tools.ts:604-711`）

| action | 入参 | 返回要点 |
|---|---|---|
| `status` | project, paperKey | `ReadingStatus` + `pendingIds`（≤600）+ 分阶段 hint（`tools.ts:620-643`） |
| `extract` | + pdfPath | `{pages, blocks, migrated, orphan}` + hint（`:644-648`） |
| `translate` | + keys[]（≤40，**未强制**） | status + `remaining` + hint（`:649-661`） |
| `notes` | — | `{guideReady,total,done,pending,model}` + hint（`:662-670`） |
| `export` | — | `{path, bytes, summary}`（`:671-673`） |

- 全部动作**豁免审批**：`ASK_TABLE` 不含 `SRW_READ_TOOL_NAME`（`tools.ts:103-107`），`approvalDecision` 返回 undefined；测试固化（`tests/tools.test.ts:308-312`）。理由：写的是项目域派生产物，授权来自会话显式意图（`tools.ts:604-608`）。
- 工具超时 300s（`tools.ts:702`），执行异常统一 `toolEnvelope` → `{ok:false,error:{code,message}}`（`:145-148`）。
- 工具注册在 `src/index.ts:110`；系统公告 `src/index.ts:50` 写明「每批 ≤40 块逐批汇报」。

### 8.2 Web RPC（`src/rpc.ts`）

通道 `/dsh-kylin-srw`（`RPC_CHANNEL`，`:19`），`webServer.register(kind:'prefix')`（`:105-113`）；先过 `connection.requestRejection` 同源/鉴权栅栏（`:128-133`），仅 POST（`:134-137`），`content-type: application/json`（`:148-151`），body ≤4 MiB（`:152-156,161-172`）。

信封：请求 `{type:'client-request', rpcId, method, payload}`；响应 `{type:'server-response', rpcId, result}`，`result` 为 `{ok:true,value}` 或 `{ok:false,error:{code,message,details}}`（`src/rpc.ts:14-17,174-196`）。`details:{}` 必须有——vendored 客户端校验失败分支要求对象（`:30-39`）。`method` 必须等于 URL endpoint，否则 200 + `invalid`（`:190-196`）。endpoint 字符集 `[A-Za-z0-9_$.:-]+`（`:143-146`）。

精读端点（`src/rpc.ts:348-386`）：

| method | 参数 | Service |
|---|---|---|
| `reading.extract` | project, paperKey, pdfPath | `extract` |
| `reading.translate` | project, paperKey, keys?, force? | `translate` |
| `reading.status` | project, paperKey | `status` |
| `reading.verify` | project, paperKey | `verify` |
| `reading.content` | project, paperKey | `content`（markdown+verify） |
| `reading.export` | project, paperKey | `exportPdf` |
| `reading.glossary` | project, paperKey, entries | `setGlossary` |

- **没有 `reading.notes`**：分析层只能经 agent 工具触发（面板「导读/备注」也是发提示词，`workbench.tsx:704-720`）——属设计选择（长 LLM 任务走引擎车道），但外部契约不对称。
- 参数校验在 RPC 层做类型/长度（`reqString ≤5000`，`:69-78`），业务校验在 service（paperKey/slug 正则）。
- 错误映射：`ServiceError.code` 透传，其它→`internal`；请求关闭→`aborted`（`:37-43`）。取消信号只传给 handler（`handleSrwRpc(..., abort.signal)`），reading 端点不消费 signal（服务层无取消参数）。

### 8.3 面板与 `selectPanel` 语义（`src/client/workbench.tsx`）

- 精读卡：论文下拉（来自带 PDF 的库条目）+ paperKey 输入 + 抽取/翻译/导读·备注/校验/导出 PDF 五个按钮（`:1103-1152`）；首屏自动带出第一条候选 paperKey（`:924-933`，修 M4-2）。
- 「抽取/校验/导出」直连 RPC；「翻译/导读·备注」只**发起**：组装自包含提示词 → `sendToCurrentAgent`（`:528-595`）。
- `sendToCurrentAgent` 步骤：会话 id 主源 `uiSession.adapter.current.key`（`sessions.list.current` 不可靠，注释 `:534-539`）→ `ctx.layout.selectPanel(null)` 把主区交还会话页（`:577-578`）→ 固定 `400ms` 等会话面挂载（`:579`，宿主 input shell 需要活跃会话控制器）→ 路径 A `sessions.retain(id)` + `sessions.binding(id).ctx` → `conversation.input.for(carrier).setDraft+submit`；A 失败走路径 B `retainAgentScope+scope`（`:581-583,547-570`）；两路都断 → 提示词进剪贴板（`:586-592`）。整体每步 4s `withTimeout`（`:544-545`）。
- 面板阅读器：`reading.content` → `parsePaper` + `assembleReading`（前端复用同一 `paragraphs.ts`，`:624-649`）→ 逐段渲染，仅非 verified 段显示 `[id]` + 徽章（`:1185-1198`）；`reading.status` 驱动状态行（`:1155-1166`）。
- 结论：`selectPanel(null)` 是「让出主区」而非「关闭面板」；插件不拥有长任务生命周期，转让给会话 Agent——这与 0205 附记二（引擎车道）一致，也是本模块与宿主耦合最深的一处（依赖 `uiSession`/`sessions`/`conversation.input` 三个非契约面，均有判空降级）。

---

## 9. 结论

精读模块的**骨架是高质量的**：块级基底层 + 呈现层装配的分层、锚+哈希的结构性校验、哈希迁移、可恢复的分析层、以及「长任务交给引擎车道」的取舍，都经得起推敲；53 个阅读测试全绿且覆盖了绝大多数纯函数与关键编排路径。

但「完成度」在三个方向上有可见缺口：

1. **确定性 bug**：译注版 PDF 的页眉/页码只写最后一页（pdfkit `bufferPages` 未启用，已实测）；整宽元素阅读序颠倒；62pt 页缘带可吞标题；`source_map.pages` 由块反推导致无文本层 PDF 显示 0 页。这些都不会让测试变红，因为测试断言的是「某文本出现」而不是「出现在哪一页/哪个位置」。
2. **降级/续跑语义对 token 不友好**：部分失败丢整批、术语表变更全量重翻、截断输出静默入缓存、取消后迟到任务等满 deadline——引擎车道把长任务暴露给用户，但失败成本仍然由用户承担。
3. **文档跑在实现前面**：预算门/G2 门/公式策略三项「已完成」实为纯函数+TODO 接线；术语表定向失效、quality 三态、meta.json、LaTeX 导出等口径均未回写。对本项目「可验收」的定位而言，这是比 bug 更隐蔽的债。

若只做三件事：修 `bufferPages`（1 行）、把 straddler 按 y 回插、`timeoutOf` 加预取消快速失败——分别解决产物正确性、阅读序正确性、测试/取消延迟三个最刺眼的问题。
