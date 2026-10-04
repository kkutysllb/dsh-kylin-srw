---
name: literature-triage
description: 文献筛选与入库工作流：把用户给出的研究方向/论文线索转成 arXiv/OpenAlex/Crossref 检索、筛选、入库到指定项目。
whenToUse: 用户想找论文、查文献、把检索结果入库到科研项目时使用。
---

# 文献筛选与入库（literature-triage）

把「用户口中的文献线索」变成「项目文献库里的结构化条目」。始终用 `srw_literature` 工具完成检索与入库（不要自己编造文献条目）。

## 工作流

1. **澄清目标**：用户要的是「找几篇看看」（search 即可）还是「正式入库」（search → import）。没说就先 search 展示，入库前确认。
2. **确定检索源**：
   - 预印本/CS/物理 → `arxiv`（检索词可带 `ti:`/`au:`/`abs:` 字段前缀，短语会自动加引号）；
   - 跨学科/引文数据/开放获取 → `openalex`；
   - 正式出版物元数据/DOI 核验 → `crossref`。
3. **检索**：`srw_literature {action:'search', source, query, limit}`。结果太多就收窄检索词，太少就换同义词或换源。
4. **筛选口径**（向用户报告时按此分组）：主题相关性 > 年份新近 > 有 OA/PDF 链接 > 引用数。
5. **入库**：`srw_literature {action:'import', project, items}` —— project 用 `srw_project` 工具确认（list 查看已有项目；没有就征求用户意见先建）。import 会自动：跨源去重、DOI 撤稿标红（retracted 状态）。
6. **汇报**：新增 N 条 / 去重 M 条 / 撤稿 K 条；列出新增条目的标题+年份+是否有 PDF 链接。

## 红线

- 不虚构 DOI / arXiv id / 作者；工具返回什么就是什么。
- import 和 pdf 动作需要用户审批——被拒时不要重试，改问用户意图。
- 科研总根未设置时报错 NO_ROOT：引导用户在「科研工作台」面板先选总根。
