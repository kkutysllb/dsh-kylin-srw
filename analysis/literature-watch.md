# 文献通路（literature）与定期抓取（watch）深度分析

> 分析对象：`/Users/libing/kk_Projects/dsh-kylin-srw`（Cordis 插件 dsh-kylin-srw，M2/M3 交付面）。
> 方法：只读源码/测试/文档；`rg` + 逐文件通读；在 scope 内跑
> `node --import tsx --test tests/lit-*.test.ts tests/watch-*.test.ts tests/rate-gate.test.ts tests/ssrf.test.ts tests/security.test.ts tests/util-limiter.test.ts`
> → **62 个测试全绿**（duration ≈1.66s）。另用一次性 `node --input-type=module -e` 探针验证若干可疑语义（不落盘、不改仓）。
> 行数口径：literature 12 文件 **1825** 行；watch 3 文件 **409** 行；verify/retraction **101**；net 2 文件 **171**；util 2 文件 **131**；合计 **2637** 行；scope 内测试 15 文件 **1723** 行。
> 本文件是唯一写入产物，`src/`、`tests/`、`docs/`、配置均未改动。

---

## 1. 模块地图与职责

### 1.1 共享类型与出网口

| 文件 | 行数 | 导出 API | 关键类型/常量 |
|---|---|---|---|
| `src/literature/types.ts` | 28 | `LitSource`、`LitIdentity`、`LitCandidate` | 三源归一形状：`{source, identity{doi?,arxivId?,title,year}, authors, venue, abstract, publishedAt?, updatedAt?, pdfUrl?, oaUrl?, citedByCount?}`（types.ts:4-28） |
| `src/literature/http.ts` | 58 | `gatedFetchText`、`gatedFetchJson`、`GatedFetchResult` | `API_DEADLINE_MS=15_000`（http.ts:12）；`redirect:'manual'`、固定 UA、429/503 → `reportFailure` + `RATE_LIMITED`（http.ts:19-42） |
| `src/literature/rate-gate.ts` | 166 | `RateGate`、`DOMAIN_INTERVALS_MS`、`RateGateOptions` | 域级最小间隔（arxiv 3s / openalex·crossref 1s，rate-gate.ts:21-27）；账本 `{schemaVersion:1, domains:{[d]:{lastRequestAt,consecutive429,circuitUntil?}}}`（:33-42） |
| `src/literature/file-lock.ts` | 73 | `withFileLock`、`lockPathFor`、`atomicWrite` | `STALE_MS=30_000`、`POLL_MS=25`、`BUDGET_MS=5_000`（file-lock.ts:12-15） |

### 1.2 三源适配器

| 文件 | 行数 | 导出 API | 备注 |
|---|---|---|---|
| `src/literature/arxiv.ts` | 195 | `ARXIV_API`、`ARXIV_ID_BATCH`、`forceHttps`、`arxivIdFromUrl`、`parseArxivAtom`、`searchArxivUrl`、`arxivQueryField`、`fetchByIdsUrl`、`chunkIds`、`searchArxiv`、`fetchArxivByIds` | 手写 Atom 解析 + 自实现实体解码（:35-48）；link 属性顺序无关的 PDF 探测（:90-106）；`id_list≤100` 分片串行（:169-195） |
| `src/literature/openalex.ts` | 110 | `OPENALEX_API`、`OPENALEX_PER_PAGE_MAX`、`stripDoiPrefix`、`parseOpenAlexResults`、`searchOpenAlexUrl`、`searchOpenAlex` | cursor 翻页终止条件 `next_cursor` 缺席/空/本页 0 条（:106-108） |
| `src/literature/crossref.ts` | 136 | `CROSSREF_API`、`parseCrossrefWork`、`searchCrossrefUrl`、`resolveDoiUrl`、`searchCrossref`、`resolveDoi` | 礼貌池 `mailto`（:71,80）；404 → `UNRESOLVED`（:115-117） |

### 1.3 身份、库、PDF、BibTeX、服务

| 文件 | 行数 | 导出 API | 备注 |
|---|---|---|---|
| `src/literature/identity.ts` | 113 | `normalizeTitle`、`identityKey`、`arxivIdFromArxivDoi`、`normalizeIdentity`、`mergeInto`、`ExistingLike`、`MergeReport` | 纯函数无 I/O；三级 fallback + 批内择优（:85-113） |
| `src/literature/library.ts` | 200 | `LitStatus`、`LitEntry`、`LibraryDoc`、`emptyLibrary`、`libraryPath`、`LibraryStore`、`libraryExists` | 唯一真相源 `library.json`；`save` 乐观并发（:99-127） |
| `src/literature/pdf.ts` | 207 | `PDF_MAX_BYTES`、`DEFAULT_PDF_HOSTS`、`FetchPdfOptions/Result`、`fetchPdf`、`fetchPdfFor`、`fileExists` | 白名单 + 逐跳重验 + 钉 IP + 流式落盘 + sha256（:57-175） |
| `src/literature/bibtex.ts` | 141 | `citekeyOf`、`escapeLatex`、`toBibtex`、`extractCitekeys`、`appendToRefs`、`citekeysFor`、`entryOrThrow` | citekey 确定性公式；`-2/-3` 冲突后缀（:26-31, :102-117） |
| `src/literature/service.ts` | 398 | `LiteratureService`、`candidateFromInput`、`attachLiterature`、`literatureByIds`、`rawJson`、`LiteratureDeps` | 编排：检索/自愈/入库/撤稿/PDF/BibTeX/mailto（:152-377） |

### 1.4 订阅与守护件

| 文件 | 行数 | 导出 API | 备注 |
|---|---|---|---|
| `src/watch/model.ts` | 93 | `WATCH_SCHEMA_VERSION`、`WATCH_EVERY_FLOOR=900`、`WATCH_SOURCES`、`WatchSub`、`WatchDoc`、`emptyWatchDoc`、`watchDocPath`、`validateWatchInput`、`scheduleTitle`、`schedulePrompt` | 只存订阅本体，不复制宿主时钟字段（:1-3） |
| `src/watch/store.ts` | 92 | `WatchStore` | 与 library 同款纪律：原子写 + revision STALE + 护栏（:48-83） |
| `src/watch/binding.ts` | 224 | `WatchManager`、`SchedulePort`、`WatchLiterature`、`WatchDeps`、`attachWatch` | 时钟绑定层 + 抓取执行体（`run`）+ lastResult 记账 |
| `src/verify/retraction.ts` | 101 | `RetractionState`、`RetractionSignals`、`retractionSignalsOf`、`isRetracted`、`retractionStateOf`、`checkRetraction`、`assertNotRetracted` | retracted / corrigendum 类型区分（:23-67） |
| `src/net/ssrf.ts` | 145 | `parseFetchUrl`、`isPublicIp`、`ResolveAddresses`、`resolvePublicAddresses`、`assertWhitelisted`、`isAllowedRedirect`、`PinnedResponse`、`pinnedRequest` | 四步：parse → 整组公网校验 → 钉 IP → 逐跳重验（:1-6） |
| `src/net/deadline.ts` | 26 | `DeadlineError`、`withDeadline` | AbortController 包装（:12-26） |
| `src/util/limiter.ts` | 64 | `Limiter`、`limitedMap` | 并发闸（FIFO）；翻译链用（reading/translator.ts:9,134） |
| `src/util/timeout.ts` | 67 | `TimeoutError`、`UpstreamError`、`timeoutOf`、`retryWithBackoff` | 我方超时 vs 上游取消的区分（:25-44） |

---

## 2. 数据流

### 2.1 检索 → 入库 → PDF → BibTeX → 撤稿

1. **检索**：`LiteratureService.search`（service.ts:194-204）先 `assertOnline()`（offlineMode → `OFFLINE`，:185-187），`limit` 钳 ≤50，按源分发 `searchArxiv` / `searchOpenAlex` / `searchCrossref`。三源都经 `gatedFetch*`（http.ts:45-58）→ `gate.acquire(hostname)`（http.ts:21）→ `withDeadline(15s)` → 429/503 上报退避。
2. **归一化**：arXiv `parseArxivAtom`（arxiv.ts:79-124，`identity.arxivId` 带版本、`doi` 小写、`pdfUrl` forceHttps）；OpenAlex `parseOpenAlexResults`（openalex.ts:20-74，DOI 剥前缀）；Crossref `parseCrossrefWork`（crossref.ts:29-62）。
3. **导入容形**：`importEntries`（service.ts:264-300）→ `candidateFromInput`（:95-130）收编 agent 常见变体（字符串年份 :87-92、`{name}/{given,family}/{author.display_name}` :54-82、顶层 `publication_year` 兜底 :88），并 `normalizeIdentity` 折叠 arXiv 自赋 DOI（:105-110）。
4. **元数据自愈**：`enrichThin`（:211-261）只对“瘦候选”（`year===0 || authors.length===0`，:215）做补全：带 `arxivId` 的批量 `id_list` 一次（:220-231），带通用 DOI 的单发 Crossref ≤10 条（:150, :234-243）；`fillThin` 只补空缺（:134-147）；失败/离线退化原样（:230, :242）。
5. **去重入库**：`store.upsert`（library.ts:130-180）→ `mergeInto`（identity.ts:85-113）批内同键择优（信息量分 :56-66）+ `seenIn` 并集，库内同键记 `duplicate` 不入 `fresh`；插入新条目（:136-155，保留 `status`/`addedAt`/`pdf`，:147-153）；已存在条目二次补全（:159-176，year/authors/pdfUrl/oaUrl/citedByCount/seenIn）；`save` 乐观并发 + tmp→rename（:116-125）。
6. **撤稿核查**：`importEntries` 对新条目（`addedAt` 距今 <60s，:284）逐条 `checkRetraction`（:287；retraction.ts:76-93）→ `retracted` 写 `status='retracted'`（:289）、`corrigendum` 写 `notice='corrigendum'`（:291-294）；两者失败均静默不阻断（:296）。
7. **取 PDF**：`fetchPdf`（service.ts:319-334）→ 目标 `join(root, slug, 'literature','pdf', pdfFilename(entry))`（:326，文件名 = citekey + identityKey 摘要 8 位 :336-339）→ `fetchPdfFor([pdfUrl, oaUrl])`（pdf.ts:178-197）→ 成功后 `updateEntry` 写 `pdf{file,sha256,bytes}` 并把 `unread→has-pdf`（:328-332，已撤稿保持 `retracted` :330）。
8. **BibTeX**：`bibtex`（:349-369）→ 过滤 `status==='retracted'`（:360）→ `appendToRefs`（bibtex.ts:89-129）按 `extractCitekeys` 去重（:71-78, :104-107）→ 原子追加 `paper/refs.bib`（:118-127）。

### 2.2 订阅触发 → 时钟绑定 → 抓取

1. **建订阅**：`srw_watch create`（tools.ts:314-330 / rpc.ts:315-328）→ `WatchManager.create`（binding.ts:98-127）：`validateWatchInput`（model.ts:56-77，slug/source/query≤500/every≥900）→ **先落盘** `upsertSub`（:115）→ 有 `boundSessionId` 才 `bind`（:78-85 `schedule.create`，title 取 `scheduleTitle`、prompt 取自包含 `schedulePrompt`，model.ts:80-93）→ 抽 `id` 写回 `scheduleId`（:41-45, :121）；失败降级 `scheduled:false + hint`，**不回滚订阅**（:123-126）。
2. **宿主时钟投递**：宿主按 `every_seconds` 把 prompt 投进绑定会话 → 会话 agent 调 `srw_watch run`（model.ts:86-93 硬编码指令）。
3. **执行体**：`run`（binding.ts:172-188）：`requireSub` → `requireRoot` → offline 检查（:176）→ `literature.search(source, query, 20)`（:177）→ `importEntries(project, candidates)`（:178，幂等 + 自愈 + 撤稿）→ `record({kind:'ok', fresh})`（:179, :190-201）；异常时 `record({kind:'error'})` **后原样抛**（:181-187）。
4. **生命周期**：`pause` = 删时钟任务 + `enabled:false` + 去 `scheduleId`（:137-145）；`resume` = 先解绑旧任务（:154）→ 落盘 `enabled:true`/新 `boundSessionId`（:157）→ 重建（:159-163）；`remove` = 解绑 + 删本体（:130-134）。
5. **面板信号**：`overview.watchSummary`（service.ts:225-256）由 `lastResult` 推导 `lastFresh` / `lastError`；`srw_watch list` 用 `watchSummaryFor` 有界投影（tools.ts:82-107）。

---

## 3. 关键不变量与契约

### 3.1 RateGate（rate-gate.ts）

- **语义其实是“域级最小间隔闸”而非令牌桶**：无 burst 容量，首个请求立即放行，其后按 `max(0, lastRequestAt+interval-now)` 等待（:119-136）；**悲观预约**——`lastRequestAt` 在持锁时即写为目标放行时刻（:129-131），后来者（含跨进程）自动排队。
- **全抖动 ±20%**（:48-51）：`interval = minInterval*(0.8+rnd*0.4)` ⇒ arXiv 实际最小间隔可低至 **2.4s < 官方 3s**（:126 与 :22 组合；测试 `rate-gate.test.ts:36` 断言的正是 ≥0.8×interval 的下限）。礼貌语义上这是“主动低于要求”。
- **跨进程账本**：`<root>/.srw/rate-ledger.json`（service.ts:169-175 用 getter 支持总根变化），读改写全程 `withFileLock(<ledger>.lock)`（:107-114）；`O_CREAT|O_EXCL` 独占创建 + 25ms 轮询 + 5s 预算 + mtime>30s 强破（file-lock.ts:22-60）。
- **退避/熔断**：`reportFailure` 把 `lastRequestAt` 推到 `now + max(backoff, retryAfter)`（:141-155）；**backoff 实际是 n²×1s**（`Math.min(5,n)**2*1000`，:145），而文件头注释与 0203 Task 2.1 写的是 `2^n×1s`（rate-gate.ts:7；docs/02-plan/0203-M2-文献通路.md:18）——**文档/实现不一致**。连续 5 次 → `circuitUntil = now+10min` 且计数清零（:149-152）；熔断期 `acquire` 抛 `RATE_CIRCUIT_OPEN`（:122-125）；`reportSuccess` 清零并解除熔断（:158-165）。
- 版本/坏账本容错：`schemaVersion !== 1` 或坏 JSON → 全新空账本（:84-98），不报错。

### 3.2 library.json 的 STALE 语义

- 形状 `{schemaVersion:1, revision, entries}`（library.ts:42-46）；`load` 缺文件 → 空库，坏 JSON/坏字段 → `INVALID` **不静默清空**（:79-93）。
- `save` 比对**磁盘 revision 与 expectedRevision**（:103-107）：不等 → `STALE`；文件被删且 `expectedRevision>0` → `STALE`；`expectedRevision===0` 允许首写（:108-115）；成功写 `revision+1`（:116）。
- 所有路径过 `assertInsideRoot`（:65-67, :71-72, :101）；`assertInsideRoot` 在 `fs.resolve/contains` 缺席时 **fail-closed**（host.ts:86-101，security.test.ts:53-56）。
- 契约漏洞：`load` 只校验 `revision/entries` 形状，**不校验 entry 内部**；用手工编辑出 `entries:{weird:{}}` 后 `upsert` 会抛 `TypeError: Cannot read properties of undefined (reading 'doi')`（探针实测），RPC 侧落到 `internal`（rpc.ts:37-41）而不是 `INVALID`。

### 3.3 身份折叠与去重

- 三级 fallback：`doi:` → `arxiv:`（**版本归一**）→ `title:sha1(归一标题)16hex:year`（identity.ts:20-30）。`normalizeTitle` = NFKC → 折叠空白 → 去非字母数字（保留 CJK）→ lowercase（:10-17）。
- **arXiv 自赋 DOI 折叠**：`10.48550/arxiv.*` → arxivId，丢弃 DOI（:32-53），`identityKey` 与 `candidateFromInput` 双端调用，保证跨源同文一键（lit-enrich.test.ts:229-240, 250-262 覆盖）。
- `mergeInto`：库内同键 → `duplicate` 不入库（:92-95）；批内同键 → 信息量分高者胜、`seenIn` 并集、同分保后到者（:96-109）。
- 幂等边界：**键包含 year**，而“year 自愈”用的是同一个键（library.ts:163-167）⇒ **title 键条目无法被治愈**，见 §4 缺陷 D3。

### 3.4 SSRF 四步与 PDF 钉死

1. `parseFetchUrl`：仅 http/https、拒内嵌凭据、长度 ≤2048（ssrf.ts:14-34）。
2. `resolvePublicAddresses`：`dns.promises.lookup({all:true, verbatim:true})`，**任一地址非公网整组拒绝**（:76-96）；`isPublicIp` 覆盖 IPv4 回环/私网/link-local/CGNAT/组播、IPv6 `::`/`::1`/fe80/fc-fd/ULa/64:ff9b/IPv4-mapped（:38-64）。
3. **钉死 IP**：`pinnedRequest` 用 `lookup` 钩子直接回调已校验 IP，并按 `options.all` 双形态响应（:119-145，:130-137）——这是 0203 实录踩坑 #3 的落点。
4. **逐跳重验 + 跨源拒绝**：`openFollowingRedirects` 每跳 `assertWhitelisted` → `openStream`（pdf.ts:96-121）；`isAllowedRedirect` 只允许 **同 host 的 http→https 升级**（ssrf.ts:106-108），其余跨源一律 `SSRF_BLOCKED`。
5. 叠加白名单：默认 5 个 API 域（pdf.ts:28-34），`allowedHosts` 只可替换（:51-53）；`fetchPdf` 落盘前 `assertInsideRoot`（:135），字节上限 200MiB 流式中止并删残件（:148-171），空响应拒（:169-172），sha256 边写边算（:144, :158）。

### 3.5 PDF 通路契约

- `fetchPdfFor` 顺序尝试 `[pdfUrl, oaUrl]`，全失败抛最后一个错误，都缺 → `NO_PDF`（pdf.ts:186-197）。
- 成功才 `reportSuccess`；429/503 才 `reportFailure`；**3xx 既不成功也不失败上报**（:72-85）。
- 文件名确定性：`<citekey>-<identityKey 去符号末 8 位>.pdf`（service.ts:336-339），落盘路径与 `pdf.file` 相对路径一致（:326, :331）。

### 3.6 watch 状态机（binding.ts）

```
create → upsertSub(盘) → [有会话] bind → patch scheduleId
                      ↘ [无会话/失败] scheduled=false + hint（不回滚）
pause  → unbind(删任务) → enabled=false, 删 scheduleId（订阅与 boundSessionId 保留）
resume → unbind(旧) → 盘上 enabled=true + 新 boundSessionId（删 scheduleId）→ bind → patch
remove → unbind → removeSub
run    → search(20) → importEntries → lastResult(ok|error) → [error 再抛]
```
- 关键不变量：**订阅本体是真相源，时钟任务只是可重建的绑定**（:1-6, :123-126）；`resume` 换绑会先解绑避免双任务（:154）。`enabled` 不参与 `run` 的准入判断（暂停的订阅仍可手动 run，:172-188）——与“手动补抓”用途一致，但**并发 run 无互斥**。

### 3.7 撤稿 vs 勘误

- `retractionSignalsOf`（retraction.ts:26-54）：`updated-by[].type ∈ {retraction, withdrawal, removal}` → retracted（:23, :37）；**无 type 的旧式记录保守归勘误**（:33）；`relation.is-retraction-of` → retracted（:49）；`relation.is-update-of` → corrigendum（:51）。
- 优先级 `retracted > corrigendum > ok`（:62-67）；网络/限流/上游失败 → `unknown` 不阻断（:88-92）。
- 消费面：retracted → `status='retracted'` 且 bibtex 跳过（service.ts:289, :360）；corrigendum → 只写 `entry.notice`（library.ts:37-39），**不阻断**。

---

## 4. 失败模式与安全分析

### 4.1 文档已记录的真网踩坑（0203 实录 :144-156；0204 实录 :86-91）

| # | 坑 | 代码落点 | 评估 |
|---|---|---|---|
| 1 | arXiv 字段查询裸空格返回 0 条 → 必须 `ti:"…"` | `arxivQueryField`（arxiv.ts:141-154）、测试 lit-arxiv.test.ts:61-66 | 已闭环；AND/OR 保留、逐子句加引号 |
| 2 | arXiv Atom `<link>` 属性顺序无关（href 在前） | arxiv.ts:90-106 逐标签取属性 | 已闭环 |
| 3 | `http.request` lookup 回调 `all:true` 需地址对象数组 | ssrf.ts:130-137 | 已闭环（否则钉 IP 静默失效） |
| 4 | 重复≠丢弃：重复条目做信息补全 | library.ts:159-176 | 已闭环，但见 D3/D4 |
| 5 | 工具输出必须无损 JSON（undefined 键被丢弃 → `value is not lossless JSON`） | tools.ts:229-250 条件展开；tests/tools.test.ts:183-198 无损门 | 已闭环 |
| 6 | RPC 返回形状与客户端解析错位（裸数组 vs `value.items`） | rpc.ts:251-290；client/workbench.tsx:454-455 注释 | 已闭环 |
| 7 | agent 剪薄 import 参数（只留 source/arxivId/title）→ year=0/authors=[]/citekey 退化 | `enrichThin`（service.ts:211-261）+ upsert 自愈 | 部分闭环（见 D3） |
| 8 | 跨源身份两键（`10.48550/arxiv.*` vs `arxiv:`） | `normalizeIdentity`（identity.ts:45-53） | 已闭环 |
| 9 | Cordis 围栏：未 inject 服务属性访问抛错 → 需 `reflect.get` + 降级 | service.ts:325-331（`schedule()` 两级读） | 已闭环，缺席降级 `NO_PROVIDER` |

### 4.2 仍可失败/仍缺防御的点（本次分析新增，按严重度）

**D1（高）OpenAlex 摘要恒为空（真实 API 无 `abstract` 字段）。**
`parseOpenAlexResults` 读 `work['abstract']`（openalex.ts:66）。OpenAlex 官方 Work 对象**只提供 `abstract_inverted_index`**（“OpenAlex doesn't include plaintext abstracts”，见 [works/work-object 文档](https://github.com/ourresearch/openalex-docs/blob/main/api-entities/works/work-object/README.md)），`tests/fixtures/openalex-page.json` 里**根本没有 abstract 字段**（fixture 键为 authorships/best_oa_location/cited_by_count/display_name/doi/id/open_access/primary_location/publication_date/publication_year），所以 fixture 测试结构上无法暴露。后果：OpenAlex 源入库条目摘要永远空串，`mergeInto` 的信息量择优会把 arXiv/Crossref 条目排在前面（identity.ts:56-66 中 abstract 计 2 分）——恰好掩盖问题，但“无摘要”条目在精读/写作侧缺上下文。另 OpenAlex 有 `is_retracted` 字段（同文档），未用于撤稿判定。

**D2（高）PDF 白名单把非 arXiv 的 OA PDF 全部挡在门外。**
默认白名单只有 5 个 API 域（pdf.ts:28-34）；OpenAlex 的 `best_oa_location.pdf_url` / `open_access.oa_url` 现实中几乎都是出版商/仓储域（如 `www.pnas.org`、`ncbi.nlm.nih.gov`、`peerj.com`，见 OpenAlex 文档示例），`assertWhitelisted`（ssrf.ts:99-103）会直接 `SSRF_BLOCKED`。即 **OpenAlex/Crossref 条目的“取 PDF”实际不可用**，只有 arXiv 条目可用（与 0203 实录 :140 只有 arXiv 成功一致）。`isAllowedRedirect` 只准同 host 的 http→https（ssrf.ts:106-108）进一步把“同域跳转”封死：若源站开始 `arxiv.org/pdf/x → export.arxiv.org/pdf/x` 之类跨 host 跳转，通路即断（两域都在白名单也救不了）。这是**产品能力缺口而非安全缺陷**（安全侧是收紧的）。

**D3（中）title 键条目无法被 year 自愈，且会永久产生重复条目。**
`identityKey` 把 year 编进标题键（identity.ts:27-29），而 upsert 的自愈按 `identityKey(candidate.identity)` 反查（library.ts:160-167）。探针实测：先入 `{title:'Drift Paper', year:0}`（无 DOI/无 arXiv id）得键 `title:a7018d55d374ce9b:0`；再入同题 `year:2025` 得键 `title:…:2025`，`existingKeys` 不含它 → **added=1，库里两篇同文**，且后续任何 candidate 都命中不到旧键，`yearHealed` 永不触发。带 DOI/arXiv 的条目不受影响（键不含 year）。触发面：Crossref/OpenAlex 无 DOI 记录、agent 手输、离线首次入库（`enrichThin` 对无 arxivId 且无 doi 的候选完全跳过，service.ts:220, :234）。

**D4（中）RateGate 内存缓存破坏跨进程唯一性，且换根不清缓存。**
`loadLedger` 只在 `cache===null` 时读盘（rate-gate.ts:84-98），`mutate` 在锁内也只读缓存（:107-114）。虽然 `withFileLock` **持锁**正确，但读的是**陈旧副本**：探针实测两实例（模拟两进程）interval=500ms，g2 预约 +485ms，g1 用陈旧缓存再预约 +506ms ⇒ 两次放行只差 **21ms**，`lastRequestAt` 也被 g1 覆盖回退。也就是说 0102 §10.3 声称的“跨进程唯一性”只在“进程刚启动第一次 acquire”时成立；常驻进程（面板 + 桌面端同开、或两个 host 同时跑）会稳定越限，对 arXiv 3s 约束是真实风险。另：`ledgerPath` 是 getter（支持总根变更），但缓存不按路径失效——探针实测切根后新根账本继承了旧根的 `lastRequestAt`（凭空等待 516ms），与“账本跟根走”的注释意图相悖。

**D5（中）`resolveDoi` 绕过统一出网口：无超时、无 UA、无 ServiceError 包装。**
crossref.ts:111-114 直接 `fetch(url,{redirect:'manual'})`，**不走 `withDeadline`**（http.ts:24 的超时纪律在这里缺失）⇒ DNS/TLS 挂起时可无限期阻塞（仅依赖工具 120s timeout，service 层无兜底）。这是全模块唯一“裸 fetch”路径（service.ts:165-168 的 `enrichByDoi` 与公开方法 :303-307 都走它）。同时 `checkRetraction` 没有复用它（用的是 `gatedFetchJson`），导致 `UNRESOLVED` 分支在 retraction.ts:90 实际不可达（`gatedFetchJson` 只产 `UPSTREAM/RATE_LIMITED`）——假 DOI 在撤稿核查里被判 `unknown`，静默放行。

**D6（中）`srw_literature` 没有 DOI 校验动作，`resolveDoi` 是死 API。**
`LiteratureService.resolveDoi`（service.ts:303-307）在 `src/` 内无调用者，RPC 无端点（rpc.ts:251-290），工具动作枚举无 `resolve`（tools.ts:391-403）。0203 验收 #6“假 DOI → UNRESOLVED 明确报错”实际**无从触达**（只有自愈路径内部用，且错误被吞）。`assertNotRetracted`（retraction.ts:97-101）同样零调用者，撤稿门只在 bibtex 里内联实现（service.ts:360）。

**D7（中）撤稿核查的 60s 窗口 + 无上限串行网络调用。**
`importEntries` 遍历**全库**，条件 `Date.parse(item.addedAt) < Date.now()-60_000` 跳过老条目（service.ts:281-284）。含义：60s 内重复导入/双 run 会对同一批条目**重复核查**；且每条是一次 Crossref 请求（域间隔 1s）⇒ 100 条批量导入 = ~100s 串行 + 100 次 `updateEntry`（每次 load+save 全文件重写）。RPC 侧允许 `items 1..100`（rpc.ts:262-266），工具 timeout 120s（tools.ts:402）——**临界**。核查失败完全静默（:296），返回值也没有“未核查”计数（只有 retracted/corrigendum），用户无从知道撤稿门本次是否真的生效。

**D8（低-中）PDF 下载不校验 content-type，且只钉第一个地址。**
`fetchPdf` 只把 `content-type` 透传返回（pdf.ts:139-140, :174），不判断是否 PDF ⇒ 200 的 HTML 错误页会被当 PDF 落盘（M4 抽取时才炸）。`openStream` 只 `pinnedRequest(target, addresses[0] ?? '')`（:67）：DNS 多地址时**无 happy-eyeballs 回退**，若首个地址是 AAAA 而本机无 IPv6 路由（`defaultResolve` 用 `verbatim:true`，ssrf.ts:70，常使 IPv6 在前），会确定性失败；`resolvePublicAddresses` 在 `withDeadline` 之外（:64 先于 :67），DNS 挂起无超时。

**D9（低）`isPublicIp` 对非规范 IPv6 字面量漏判。**
探针：`0:0:0:0:0:0:0:1` → `true`、`0:0:0:0:0:0:0:0` → `true`（ssrf.ts:49-62 只做字符串前缀匹配）；另 `198.18.0.0/15`、`192.0.0.0/24`、`198.51.100.0/24`、`203.0.113.0/24`、`2001:db8::/32` 均判公网。**实际不可达**：Node 的 WHATWG URL 会把 IPv6 规范化（探针：`[0:0:0:0:0:0:0:1]` → hostname `[::1]`），且白名单是第一道闸（固定常量域，非攻击者可控）；仅作纵深防御的待补项（应改用 `node:net` 的地址解析或补充网段表）。

**D10（低）跨平台/并发细节。**
`watchDocPath` 用 `${rootDir}/.srw/watch.json` 与 `save` 用 `path.slice(0, path.lastIndexOf('/'))` 建目录（model.ts:51-53；store.ts:66），与 library 的 `path.join`（library.ts:54, :117）不一致，Windows 下 `watch.json` 会拼成混斜杠路径且 `lastIndexOf('/')` 取不到目录。`appendToRefs`（bibtex.ts:89-129）与 `writer.refsAppend`（writer/service.ts:317-345）都写 `paper/refs.bib` 且**不取锁**——两侧并发（agent 补 BibTeX + 用户导出）可能丢追加；对照 RateGate 用了文件锁，这里是空白。

### 4.3 语义/文档不一致清单（低危但会误导维护）

| 位置 | 文档说 | 实现是 |
|---|---|---|
| rate-gate.ts:7 / 0203:18 | 退避 `2^n × 1s` | `n² × 1s`（:145），n≥5 熔断（:149-152） |
| 0203:16 | `acquire(domain,{minIntervalMs})` | `acquire(domain, now)`（:119） |
| 0203:17, 95 | `report429`、`updated-by/relation` | `reportFailure`（:141）；relation 已实现（retraction.ts:41-52） |
| 0203:66 | `save` 比对 “revision + 文件 mtime” | 只比对 revision（library.ts:103-115）；0102 §6.3 的 mtime/内容哈希未实现 |
| 0203:72 | 新增 `tests/lit-pdf.test.ts` | 不存在；PDF 测试在 `tests/ssrf.test.ts:100-174` |
| 0203:74 | `createPinnedLookup` | 现名 `pinnedRequest`（ssrf.ts:119） |
| 0203:48 | Crossref 归一化 `type` | `LitCandidate` 无 `type` 字段；`toBibtex` 用 venue 关键词猜类型（bibtex.ts:53-55） |
| 0204:59 | 新文件 `src/watch/runner.ts` | `run()` 合并在 `watch/binding.ts:172` |
| 0204:58 | 服务包装 schedule create/delete/**update** | 只有 create/delete（service.ts:333-357）；resume 用重建绕开 update |
| 0102 §8.1 | `watch.upsert` / `watch.runNow` / `watch.runs` / `literature.import{citekeyPolicy}` / `fetchPdf{preferOa}` | 实际端点 `watch.list/create/remove/pause/resume/run`、`literature.search/import/fetchPdf/lib/bibtex`（rpc.ts:251-346）；无运行历史表，只有 `lastResult` |
| 0102 §10.4 / §12 | “订阅游标持久化”“账本含 seenIds” | 无游标/seenIds；幂等完全依赖查询式检索 + library 去重（0204 §1 已改口径，0102 未回写） |
| 0204:34, 0102 §2 | 面板创建绑“最新根会话” | 实现有（service.ts:261-271），但面板 `resume` 只传 `{id}`（client/workbench.tsx:274）⇒ 若创建时无根会话（`boundSessionId` 缺失），面板“补排程”永远只能得到“无可绑会话”提示，与 0204 §1“面板 resume 时选择会话”不符 |

---

## 5. 测试覆盖评估

scope 内 15 文件 1723 行 / 62 用例（全绿）。

| 测试 | 证明了什么 | 未证明/盲区 |
|---|---|---|
| `rate-gate.test.ts`（145 行） | 并发预约间隔 ≥0.8×interval（:25-42）；Retry-After 取大者 + `RATE_CIRCUIT_OPEN` + `reportSuccess` 解熔断（:44-71）；换实例读盘（:73-84）；文件锁临界区无重叠 + 陈旧锁强破（:86-109）；**4 子进程 ×5 次读改写 = 20**（:111-137，跨进程锁确有实证）；`withDeadline`（:139-145） | 退避**数值序列**未断言（只测 ≥59s），因此 n² vs 2^n 的实现漂移不被发现；**常驻进程缓存陈旧**（D4）无覆盖；换根不清缓存无覆盖；熔断到期自愈无覆盖（只测 reportSuccess 手动解除） |
| `ssrf.test.ts`（174 行） | `isPublicIp` 16 个负例 + 5 个正例（:37-46）；整组拒绝/DNS_FAIL（:48-59）；parse/白名单/重定向策略（:61-75）；**连接前拒非白名单**、白名单+`allowPrivateForTest` 落盘 + sha256 + 无 `.srw-tmp-` 残留（:100-136）；跨源重定向拒 + SIZE_LIMIT 无残件（:138-174） | 真实 DNS/真实 HTTPS 未覆盖；`pinnedRequest` 未单测（D8 只钉首地址）；不走 `isPublicIp` 的 IPv6 非规范形态（D9）；`fetchPdfFor` 顺序回退未测；content-type 不做门未测；`DEFAULT_PDF_HOSTS` 与真实 OA 域的兼容性未测（D2） |
| `security.test.ts`（103 行） | `assertInsideRoot`：包含放行、`../`/绝对路径/符号链接拒绝、`~` 展开、能力缺失 fail-closed（:41-68）、真实 node:fs 符号链接负例与 ENOENT fail-closed（:70-103） | 只测护栏本身；library/watch 侧对护栏的调用只测了 `fs=undefined`（lit-library.test.ts:80-82） |
| `lit-library.test.ts`（103 行） | upsert 幂等（0/1/2 新增）、revision 递增、`status` 保留（:40-62）；STALE、坏 JSON → INVALID、坏 slug、fail-closed（:64-84）；offline 三态（search/fetchPdf 拒，import/lib 放行）（:86-103） | **不自愈路径**（D3）；坏 entry 形状（TypeError）；并发 upsert 的 STALE 重试策略；`updateEntry` 的 NOT_FOUND |
| `lit-identity.test.ts`（74 行） | DOI>arXiv>title 优先级、版本归并、标题归一（:20-34）；三路同文一条 + seenIn + 库内 duplicate（:36-69）；NFKC/去标点（:71-74） | `normalizeIdentity` 的 arXiv-DOI 折叠在 lit-enrich.test.ts:229-248 才有覆盖；`mergeInto` 的“同分保后到者”与 `completeness` 权重无断言 |
| `lit-bibtex.test.ts`（79 行） | citekey 确定性/CJK 退化/无作者（:27-37）；LaTeX 转义 + 三类型映射 + doi 字段（:39-53）；appendToRefs 首写/重复跳过/批内 `-2`/无 tmp 残留（:55-79） | 并发追加（D10）；`@article` 里 `venue=` 字段而非 `journal=` 的 BibTeX 语义（未测、也未在文档中声明）；CJK 作者恒 `unknown` 造成的同年碰撞 |
| `lit-retraction.test.ts`（52 行） | `updated-by[type=retraction/withdrawal/removal]`、`is-retraction-of` → retracted；corrigendum/erratum/is-update-of → corrigendum；双信号取撤稿；无 type 归勘误；干净 ok（:7-51） | **`checkRetraction`（网络+gate 包装）零测试**；`unknown` 分支；import 侧的 60s 窗口与静默失败（D7）；`notice` 是否被 UI 消费 |
| `lit-arxiv/crossref/openalex.test.ts`（86/47/46 行） | 三源 fixture 解析字段级断言（多作者/doi/版本/日期补全/venue/OA 链接/引用数）、URL 构造与钳制、`id_list≤100` 分片、mailto、DOI 编码、`ti:"…"` 引号 | **`searchArxiv/searchOpenAlex/searchCrossref/resolveDoi` 四个真实网络函数零测试**（grep 命中 0，只有 URL/parse 被覆盖）；OpenAlex 摘要字段与真实 schema 不符（D1）正因 fixture 缺该字段而不可见；cursor 多页拼接只在 URL 层测（`searchOpenAlex` 的翻页循环未测） |
| `lit-enrich.test.ts`（346 行） | 自愈三闸：arxivId 批量只补空缺（:88-114）、完整候选不触网（:116-134）、离线/失败退化（:136-173）、存量坏数据重导即愈（:175-210，仅 arxiv 键）、无损 JSON（:212-225）、DOI 折叠同键（:229-248）、四种 agent 变形容形（:250-295）、openalex 瘦候选走 arxiv 补齐（:297-323）、通用 DOI 单发 ≤10（:325-...）、单条失败跳过、跨源一批合并 | 无 DOI 且无 arXiv id 的 title 键自愈（D3）；`enrichThin` 的 DOI 上限边界（只测 2 条）；自愈与撤稿核查的时序 |
| `watch-store.test.ts`（114 行） | 往返/revision 单调（:42-59）；patch/remove、STALE（:61-78）；坏 JSON 不清空（:80-94）；入参校验（query 空/every<900/source/slug、非法频率回退 86400）（:96-104）；标题/prompt 确定性（:106-114） | 跨平台路径（D10）；`save` 遇到坏 JSON 时抛 SyntaxError 而非 INVALID（library 同款）；并发 update 的 STALE |
| `watch-binding.test.ts`（256 行） | create 绑时钟（title/prompt/every 正确）（:95-114）；无会话/时钟失败降级不回滚（:116-133）；pause 删任务留订阅、resume 重建 + 换绑会话、remove 双删（:135-164）；run 幂等（第二次 fresh=0）+ lastResult（:166-186）；失败/离线落 error 后原样抛（:188-225）；NO_ROOT 优先于 NOT_FOUND（:227-256） | 真实 `ctx.schedule`（E3 面）只有活体验收记录，无测试；run 并发无互斥；`record` 的 STALE 会让一次成功抓取变 error（见 §6 R4）；resume 失败返回 `prev`（可能与盘上不一致）；`corrigendum` 未进 `WatchLiterature` 接口（binding.ts:22-30），watch 结果丢该信号 |
| `util-limiter.test.ts`（98 行） | 并发上限/峰值、FIFO、异常不堵队、非法并发拒、`limitedMap` 保序、`timeoutOf` 我方超时 vs 外部取消、`retryWithBackoff` 可重试/不可重试（:10-98） | 与本 scope 的“文献/抓取”无耦合（只被 reading 使用），列出以满足任务范围 |
| `tools.test.ts`（相关部分） | `srw_literature` 的 import/lib/bibtex/offline-search 全过无损门（:170-199）；`srw_watch` 审批矩阵 create/remove ask、run/pause/resume/list 豁免（:244-256）与全动作无损（:257-...） | `srw_literature` 的 `search/pdf` 成功路径（真网）无测试；审批矩阵之外的 `lib` 动作未在 ask 表（正确，但无显式断言） |

**结论**：解析层/纯函数层/存储层的覆盖很好（fixture + 文件系统真跑），**网络层几乎是“只有活体验收、没有自动化”**（4 个 search 函数、`resolveDoi`、`checkRetraction`、`pinnedRequest` 均无单测），这正好是 D1/D2/D8 类问题的逃逸通道。

---

## 6. 设计亮点 + 风险/技术债/TODO

### 6.1 亮点（值得保留的决策）

1. **文件即真相源 + 乐观并发**：`library.json` / `watch.json` 都有 revision + STALE + tmp→rename（library.ts:99-127；store.ts:48-76）；watch 只存 `scheduleId` 不复制宿主时钟字段（model.ts:1-3），宿主页与面板不会双写漂移。
2. **触发与执行分离**（0204 §1）：时钟只负责“往会话投一条 prompt”，抓取是确定性 host 代码（binding.ts:172-188）——抓取零 token、可审计、失败可精确重试；时钟缺席时降级为“可手动 run”（:116-118, :123-126）。
3. **降级可见、不回滚**：绑定失败不丢订阅，返回 `hint` 由面板/工具显式呈现（:121-126；tools.ts:329,349）；`lastResult` 让“静默停滞”变可见信号。
4. **身份折叠的工程性**：arXiv 自赋 DOI 折叠 + 版本归并 + `seenIn` 累积，解决了实测中“同文两键再造 5 条重复”的真问题（identity.ts:32-53；lit-enrich.test.ts:229-262）。
5. **SSRF 四步自实现且白名单只收不放**（ssrf.ts；pdf.ts:51-53），测试用本地靶机 + `allowPrivateForTest` 精确隔离测试降级口（pdf.ts:40-41），产品代码不传——这个 seam 设计很干净。
6. **输入不可信的自愈层**：`candidateFromInput` 的容形 + `fillThin` 只补空缺 + upsert 二次治愈（service.ts:54-147, :211-261），是“上游 agent 会剪参数”这一现实的正确响应。
7. **跨进程锁自实现**：`O_CREAT|O_EXCL` + 陈旧 mtime 强破 + 4 进程实测（rate-gate.test.ts:111-137），零依赖且可验证。
8. **撤稿/勘误分型**：`updated-by.type` 白名单 + `relation` 兜底 + 无 type 保守归勘误（retraction.ts:23-53），避免把勘误误标红阻断引用。

### 6.2 风险 / 技术债 / TODO（按优先级）

| 优先级 | 条目 | 证据 | 建议 |
|---|---|---|---|
| P0 | D4 RateGate 缓存导致跨进程/换根越限 | rate-gate.ts:84-98,107-114；探针 21ms 间隔 | `mutate` 内**每次读盘**（缓存只作短 TTL 或按 path+mtime 失效）；`acquire` 支持 `ledgerPath` 变化时清缓存；加一条“两实例交替 acquire 间隔 ≥interval”的回归测试 |
| P0 | D1 OpenAlex 摘要恒空 | openalex.ts:66 + 官方 schema + fixture 缺字段 | 解析 `abstract_inverted_index`（按 position 还原）；补 fixture 与断言；顺手消费 `is_retracted` 做第二道撤稿信号 |
| P1 | D2 非 arXiv OA PDF 不可取 | pdf.ts:28-34,51-53；ssrf.ts:99-108 | 产品层面要么“从 config 扩白名单”（0102 已声明可扩不可缩），要么把 `pdfUrl` 的 host 预检前移给出**可解释错误**（`SSRF_BLOCKED: hub 不在白名单，请先在设置里加域`）；同时允许“同 host 任意跳转 + https 升级”以抗源站改路径 |
| P1 | D3 title 键 year 漂移产生重复 | identity.ts:27-29 + library.ts:160-167；探针 added=1 两次 | upsert 前按“归一标题”额外建索引做二次匹配；或把 title 键改为不含 year（year 只作合并时的择优字段）；补一条 title-only 自愈测试 |
| P1 | D5 `resolveDoi` 裸 fetch 无超时 | crossref.ts:111-114 | 改走 `gatedFetchJson` 或至少 `withDeadline(15s)`；统一 UA |
| P1 | D6 DOI 校验/撤稿硬门是死 API | service.ts:303-307；retraction.ts:97-101；rpc.ts:251-290；tools.ts:391-403 | 给 `srw_literature` 加 `resolve`（或 `check`）动作 + RPC `literature.resolve`；bibtex 走 `assertNotRetracted` 而非内联判断 |
| P2 | D7 撤稿核查 60s 窗口 + 全库串行 + 静默失败 | service.ts:281-296；rpc.ts:262-266 | 只核查“本批新增/被补全”的键；返回 `unchecked` 计数与原因；批量聚合（Crossref 无批量端点，至少做并发上限 2~3 并用 `Limiter`） |
| P2 | D8 PDF 无 content-type 门 / 只钉首地址 / DNS 无超时 | pdf.ts:64-67,139-174 | 校验 `application/pdf` 或 `%PDF-` 魔数（否则 `UPSTREAM` 并删残件）；按地址列表回退（首失败试下一个）；DNS 也套 deadline |
| P2 | D9 `isPublicIp` 网段表不全 | ssrf.ts:38-64 | 补 198.18/15、192.0.0.0/24、198.51.100/24、203.0.113/24、2001:db8::/32；或改用二进制解析 |
| P2 | D10 跨平台路径 + refs.bib 无锁 | model.ts:51-53；store.ts:66；bibtex.ts:89-129；writer/service.ts:317-345 | watch 路径统一 `path.join`；refs.bib 追加复用 `withFileLock` |
| P2 | 死代码/无用状态 | `archived`（library.ts:17）从未写入；`fileExists`（pdf.ts:200）、`libraryExists`（library.ts:193）、`citekeysFor`（bibtex.ts:132）、`rawJson`（service.ts:395）、`literatureByIds`（:389）、`assertNotRetracted` 均无调用者 | 删除或接线；`notice:'corrigendum'` 写盘后 **UI/RPC/工具都没展示**（client/workbench.tsx:1079-1080 只渲染 status），0204 3.6“通知”只完成了一半 |
| P3 | 文档回写 | §4.3 整表 | 按 §4.3 修正 0102 §8.1/§10.4/§12、0203 任务口径、0204 文件表；把 rate-gate 注释改成 n² |
| P3 | 定时唤醒的 token 成本未在设计里量化 | model.ts:86-93；0204 §1“抓取本身零 token” | 每次到期都会唤醒一个会话跑一轮 agent（有 LLM 成本）；文档应显式标注“每 tick ≈ 1 个 agent turn”，并给出“合并多条订阅到单会话”的可选优化 |

### 6.3 值得注意的“非缺陷但需知情”的语义

- STALE 是**拒写而非重试**：`upsert`/`update` 各自 load→save，一次并发即把整次抓取变成 error（watch 侧还会先记 error 再抛）。设计上符合 0102 §6.3，但自动化路径（watch + 面板同时操作）缺少“读-改-重试”包装。
- `status` 与 `pdf` 是**粘性**的（library.ts:147-153, :169-171）：重复导入不会把 `has-pdf` 打回 `unread`，也不会重复下载；`fetchPdf` 在 `retracted` 上失败前会先写盘（service.ts:327-332）——即撤稿条目的 PDF 仍会落盘，仅状态保持 `retracted`。
- `search` 的 `limit` 在 service 层钳 50（service.ts:197），而各适配器自钳 200/100/100（arxiv.ts:135；openalex.ts:87；crossref.ts:70）；watch 固定 20（binding.ts:177）。
- `everySeconds` 非法（非整数/字符串）**静默回退 86400**（model.ts:71-72，watch-store.test.ts:102-103 明确断言此行为）——与其余“非法即 INVALID”的风格不一致，但已成契约。
- 订阅的 `boundSessionId` 一旦会话被删，投递只 warn（宿主语义），`lastResult` 停滞是唯一信号（binding.ts:1-6 注释），`resume` 是唯一修复路径。

---

## 7. 与其他模块的接口（host / tools / rpc 精确方法名）

### 7.1 host 侧装配

- `SrwService.literature` / `.watch` 是**懒加载 getter**（service.ts:77-88）：`attachLiterature(this)`（literature/service.ts:380-386，取 `ctx.fs`、`config.offlineMode`、`currentRoot()`）；`attachWatch(this, () => this.literature)`（watch/binding.ts:205-224）。
- 时钟面：`WatchManager` 只依赖 `service.scheduleCreate({sessionId,title,prompt,everySeconds})` / `service.scheduleDelete(sessionId,id)`（binding.ts:213-221 → service.ts:333-357）；`schedule()` 用**属性访问 + `ctx.reflect.get` 两级读**并归一 `NO_PROVIDER`（service.ts:318-331）。
- 面板创建默认绑定会话：`service.newestRootSessionId()`（service.ts:261-271，读 `ctx.agents.roots()` 取最新会话 id），由 `watch.create` 分支调用（rpc.ts:315-328）。
- 根切换：`RateGate` 的 `ledgerPath` getter 每次取 `this.root()`（literature/service.ts:169-175），`LibraryStore`/`WatchStore` 每次动作前 `requireRoot()` 重建（:189-191；binding.ts:56-58）——根变更即时生效（但见 D4 缓存问题）。
- `politeMailto`：每次取用都读 `<root>/.srw/root.json`（service.ts:371-376；workspace/root.ts:15, :43-45），传给 Crossref 的 `mailto`。
- 文献 → 论文线：`SrwService` 注入 `writer` 的 `libraryEntry: (project,key) => literature.entry(project,key)`（service.ts:115-125；writer/service.ts:50, :320-334），`refsAppend` 用 `toBibtex`/`extractCitekeys`（writer/service.ts:21）；`writer/cite-audit.ts:4` 也用 `extractCitekeys`。

### 7.2 RPC 端点（rpc.ts）

- 文献：`literature.search{source,query,limit?}`、`literature.import{project,items[1..100]}`、`literature.fetchPdf{project,key}`、`literature.lib{project}`（返回 `{entries}`）、`literature.bibtex{project,keys?}`（rpc.ts:251-290）。
- 订阅：`watch.list`、`watch.create{project,source,query,everySeconds,sessionId?}`、`watch.remove{id}`、`watch.pause{id}`、`watch.resume{id,sessionId?}`、`watch.run{id}`（rpc.ts:313-346）。
- 诊断辅助：`diag.schedule.create/list/delete/storage`（rpc.ts:293-311），是 M3 期探针面的遗留（对第三方公开，值得评估是否收缩）。
- 错误映射：`ServiceError → {code,message}`；其它异常 → `internal`（rpc.ts:37-41）⇒ D2 的 `TypeError` 会以 `internal` 露出。

### 7.3 agent 工具（tools.ts）

- `srw_literature`（tools.ts:378-452）：`action ∈ {search, import, pdf, bibtex, lib}`；`search` 输出 `searchOutputFor`（:229-250，authors 截 6、abstract 截 300、可选键条件展开守无损）；`import/pdf` 需审批（:55-85 `TOOL_ASKS`）；`pdf` 返回 `{path,sha256,bytes}`、`bibtex` 返回 `{added,skippedRetracted}`；`timeoutMs:120_000`（:402）。
- `srw_watch`（tools.ts:279-370）：`action ∈ {list, create, remove, pause, resume, run}`；`create/remove` ask、其余豁免（:84-110 `WATCH_ASKS`）；`list` 用 `watchSummaryFor` 有界投影（:82-107）；`run` 返回 `{fresh,duplicates,enriched}`（:354-358）。
- 审批判定唯一入口：`approvalDecision`（tools.ts:112-140 + `ASK_TABLE` :107-112），`srw_literature` 的 `lib` 与 `srw_watch` 的 `list/pause/resume/run` 不在 ask 表内（符合 0204 §1 授权语义）。

### 7.4 面板（client）消费面

`literature.search`（裸数组）、`literature.import`（`{added,duplicates,retracted}`）、`literature.fetchPdf`、`literature.lib`（`{entries}`）、`literature.bibtex`（`{added,skippedRetracted}`）、`watch.list/create/run/remove/pause|resume`（client/workbench.tsx:238-278, :440-515）；撤回/勘误只渲染 `status` 徽章（:1079-1080），`notice` 未展示（§6.2 最后一行）。

---

## 附：本次为验证语义所做的探针（均为一次性命令，未写入仓库）

1. RateGate 换根：`gate` 首次 `acquire` 后改 `ledgerPath` 指向 → 第二次仍按旧根 `lastRequestAt` 等 516ms，且把账本写进新根。
2. RateGate 双实例：interval=500ms，g1#1=0、g2#1=+485ms、g1#2=+506ms ⇒ g2→g1#2 间隔 **21ms**（应 ≥500）。
3. `isPublicIp('0:0:0:0:0:0:0:1') === true`、`isPublicIp('0:0:0:0:0:0:0:0') === true`；Node URL 会规范化成 `[::1]`（故当前不可达）。
4. Library title 键漂移：`upsert(year:0)` → `upsert(同题 year:2025)` ⇒ added=1、两条 `title:…:0` / `title:…:2025` 并存。
5. 坏 entry（`entries:{weird:{}}`）→ `upsert` 抛 `TypeError: Cannot read properties of undefined (reading 'doi')`（无 ServiceError code）。
6. 交叉核对 OpenAlex 官方 Work 对象字段：只有 `abstract_inverted_index`，无明文 `abstract`（[OpenAlex 文档](https://github.com/ourresearch/openalex-docs/blob/main/api-entities/works/work-object/README.md)）。
