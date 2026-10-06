---
name: venue-fit
description: 投稿匹配与合规整改工作流：对照刊物要求与深度档位核查论文现状，给出机读差距清单与整改路径。
whenToUse: 用户问「这篇论文适合投哪」「离投稿还差什么」「合规检查」（venue fit / compliance）时使用。
---

# 投稿匹配与合规整改（venue-fit）

不做印象分。所有结论都来自 srw_paper 的机读输出——`compliance` 动作返回
`checks[]`，每条 {id, level, pass, actual, expected, where}。

## 工作流

1. **现状盘点**：`srw_paper {action:'state'}`——骨架/大纲状态/编译产物/引擎可用性。
2. **刊物事实**：`venue.list` 里每个刊物都带 confidence 与 sources。`unverified` 的刊物要求**只是建议**——向用户转述时必须说明「未核定，数值以官方作者指南为准」；推荐用户核对后升级。
3. **合规核查**：`compliance` 跑当前 venue+tier。输出按三组汇报：
   - **阻断项**（pass=false 且 level=error，仅 verified 刊物会出现）
   - **建议项**（pass=false 且 level=warn，unverified 全在这里）
   - **事实缺失**（pass=undefined，如未编译没有页数——先补事实再判）
4. **整改路径**：每条不过项按 where 字段给出行动（缺节 → 起草该节；引用不足 → 文献检索补库 + refs.append；超页数 → 压缩建议）。整改动作回到 paper-drafting 工作流执行。
5. **档位调整建议**：差距太大时算一笔账——降档（D3→D2）能不能过？给用户选项而不是替用户决定。

## 红线

- 不编造刊物要求：只引用 venue.list 里的数据 + 标注 confidence；用户问具体刊物的页数/格式，一律建议查官方 CFP/作者指南。
- compliance 的 unverified 建议项永远不要说成「不通过就投不了」。
