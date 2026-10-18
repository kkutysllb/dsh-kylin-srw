---
name: literature-triage
description: 文献筛选、检索计划与入库工作流：把用户给出的研究方向/论文线索转成 arXiv/OpenAlex/Crossref 三源检索、可重放计划、OpenAlex/Crossref 元数据、OA 全文获取与项目入库。
whenToUse: 用户想找论文、查文献、批量检索、把检索结果入库到科研项目，或要取开放获取全文时使用。
---

# 文献筛选与入库（literature-triage）

把「用户口中的文献线索」变成「项目文献库里的结构化条目 + 可复现检索记录」。始终用 `srw_literature` 工具（不要自己编造文献条目）。工具结果只认返回的字段；需要审批的 import/pdf/fulltext 被拒时不要重试。

## 工作流

1. **澄清目标**：用户要的是「找几篇看看」（search 即可）、「正式入库」（search → import）还是「可复现的批量检索」（plan.save → plan.run → plan.replay）。
2. **确定检索源**：
   - 预印本/CS/物理 → `arxiv`（检索词可带 `ti:`/`au:`/`abs:` 字段前缀，短语会自动加引号）；
   - 跨学科/引文数据/开放获取 → `openalex`；
   - 正式出版物元数据/DOI 核验 → `crossref`。
3. **单次检索**：`srw_literature {action:'search', source, query, limit}`。结果太多就收窄检索词，太少就换同义词或换源。
4. **检索计划（P0-5，正式综述用）**：
   - `plan.save`：传 `project`、`text`（或 `query:{text,filters}`）、`sources`、`perSourceLimit`、`sort`。保存不触网，同一内容得到同一 `planId`。
   - `plan.run`：三源并发（各源 RateGate 限速）→ 归一化 → identityKey 去重（title 弱键带同题不同文守卫）→ identityKey 稳定排序 → 写 `literature/runs/<runId>/{plan.json,results.jsonl,summary.json}`。返回 `counts` 与 `resultHash`；同一计划连续运行 resultHash 必须一致。
   - `plan.list` 查看计划；`plan.replay` **只读本地快照、不联网**，重算 resultHash 并给出 diff（有上一 run 时是相对上次的新增/消失）。用户断网/换机时用它证明检索可复现。
   - `results.jsonl` 里就是要入库的原始条目；不要重新联网抄一遍。
5. **筛选口径**（向用户报告时按此分组）：主题相关性 > 年份新近 > 有 OA/PDF 链接 > 引用数。
6. **入库**：`srw_literature {action:'import', project, items}` —— project 用 `srw_project` 工具确认（list 查看已有项目；没有就征求用户意见先建）。import 会自动：
   - 跨源去重（DOI → arXiv id → title 弱键；同题不同文按作者/年/venue 守卫保留两条）；
   - 对含 DOI 的候选跑一次 `verifyDoi`（失败标 `verification.status='unresolved'`，**不阻断入库**、不改变 status）；
   - 新条目 DOI 撤稿核查并标红（retracted）。
7. **DOI 校验与引用门（P0-6）**：
   - 入库前后可单独 `{action:'verify', doi}` 核验（Crossref 404 → `UNRESOLVED`）。
   - 导出前 `{action:'citeGate', project, keys?}`：`blocked` 为撤稿硬阻断，`warnings` 为 DOI 未核验（不阻断但提示先 verify）。bibtex 会跳过撤稿并返回 `skippedRetracted`。
8. **OA 全文获取（P0-4）**：
   - `{action:'fulltext', project, key}`（或 `doi`）。流程：Unpaywall（需 `<root>/.srw/root.json` 的 `unpaywallEmail`，缺则 INVALID 提示配置）→ `best_oa_location` 的 PDF → 域确认（默认白名单 + `root.json` 的 `fulltext.confirmedHosts`）→ SSRF/钉 IP 下载 → content-type/魔数门（`%PDF-`）→ 落 `literature/pdf/<citekey>.pdf` + 证据 `literature/fulltext/<paperKey>.json`（finalUrl/host/sha256/bytes/retrievedAt/source）。
   - 失败分型：`PAYWALLED` / `HOST_NOT_ALLOWED` / `CONTENT_NOT_PDF` / `UNRESOLVED` / `SSRF_BLOCKED`。遇到 `HOST_NOT_ALLOWED`，把提示的主机作为 `allowHost` 重传一次（会写回 confirmedHosts，之后免传）。
   - **红线**：只取 OA，不携带 cookie/机构凭据、不绕付费墙、不抓 Google Scholar。
9. **身份迁移（P0-3）**：老库出现同题重复时，先 `{action:'migrate', project}` dry-run 看将重命名/合并/冲突的条数；确认后 `apply:true` 才会写盘并备份 `library.json.bak`。可重复执行（无变化不写盘）。
10. **汇报**：新增 N 条 / 去重 M 条 / 撤稿 K 条 / DOI 未核验 U 条；列出新增条目的标题+年份+是否有 PDF。计划运行额外报 identified/deduped/resultHash 与错误源。

## 红线

- 不虚构 DOI / arXiv id / 作者；工具返回什么就是什么。
- 不手改 `library.json`；迁移只走 `migrate`（dry-run → apply）。
- import/pdf/fulltext 动作需要用户审批——被拒时不要重试，改问用户意图。
- 科研总根未设置时报错 NO_ROOT：引导用户在「科研工作台」面板先选总根。
- 离线模式：search/plan.run/fulltext/verify 报 OFFLINE；plan.list/replay、library、bibtex、reading 仍可用。
