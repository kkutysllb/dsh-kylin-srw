---
name: materials-proof
description: 素材生成与证明链工作流：表/图/伪代码/公式由 spec+metrics 确定性生成，verify 复算、insert 过溯源门插入正文、numbers 生成数字宏并审计裸数字。
whenToUse: 用户要为论文生成图表/伪代码/公式并插入正文，或要求「每个数字可溯源/可回指」时使用。
---

# 素材与证明链（materials-proof）

论文里的每一个量化结论都要能沿「正文 → artifact → inputs → metrics → run」走通。
srw_materials 工具只做**确定性渲染 + 哈希门**；spec 的内容（列、步骤、公式、TikZ 源码）
由**你自己**起草——生成器不调用 LLM，同 spec + 同 inputs 必须字节级同输出。

## 工作流

1. **先有数据（无 metrics 不生成）**：把实验结果整理成 `{ values: { 指标: { value, stderr?, n?, seed? } }, series?: [{ name, points }] }`，
   用 `metrics.import {project, runId, metrics}` 落到 `experiments/manual/<runId>/metrics.json`。
   没有数据的格子留 TODO 并如实告诉用户——**绝不编造占位数据**。
2. **生成**：`generate {id, kind, provenance, spec}`。kind 取 table（booktabs 表，spec.runId + columns 每列一个指标）/ plot（pgfplots 曲线，spec.runId + seriesName）/ pseudocode（steps 逐行，行前缀 FOR/IF/RETURN 等）/ formula（latex）/ tikz（code）。
   provenance 如实标注 measured/derived/literature；**illustrative 默认拒绝**——用户显式要求示意才传
   `allowIllustrative: true`，且必须告知：水印/脚注/面板红标三处标注，投稿包按同级阻断处理。
3. **复算**：`verify {id}` 用当前输入重渲染比对哈希。verified → 可插入；mismatch → **停下查源**
   （输入/产物/副本被改），恢复后重新 verify——**不许改基线**、不许绕过门直接手写正文数字；
   unverifiable（缺源/公式门未接入）→ 可插入但论文必须加脚注「未验证」。
4. **插入正文**：`insert {id, sectionId}`（需用户审批）——复制到 `paper/figs/<id>.tex` 并在节末追加
   `\input{figs/<id>}`；正文引用 `Table~\ref{tab:<id>}` / `Fig.~\ref{fig:<id>}` 等产物内 \label。
   插入后不要手改 `paper/figs/*`（compile 前门 ARTIFACT_DRIFT 会拦）。撤销用 `remove {id}`。
5. **数字回指**：`numbers {project}` 生成 `paper/generated/srw-numbers.tex`（`\newcommand{\srw<Name>}{…}`）；
   main.tex 加 `\input{generated/srw-numbers}`，正文写 `\srwaccuracy` 这类宏，**不写裸数字**。
   `numbers.audit {project}` 列出节文件里的未溯源裸数字——逐个换成宏或补出处，D2/D3 投稿要求 0 条。
6. **编译**：`srw_paper` 的 compile 会先核对全部插入副本哈希——报 ARTIFACT_DRIFT 时先恢复副本再编译。

## 红线

- **不编造**：每个数字指回 metrics；检索不到/实验没跑就说没有，不生成占位图表冒充真实。
- **mismatch 阻断**：verify 不过不许 insert/compile；更不许手改 `materials/` 产物或 `paper/figs/*` 副本来「复绿」。
- **示意默认拒绝**：illustrative 必须用户显式开启，且三处标注齐备、如实汇报边界。
- **公式恒「未验证」**：sympy 公式门未接入，formula 恒 unverifiable/structural——论文引用必须脚注说明。
- **生成器确定性**：spec 里不要要求时间戳/绝对路径/随机数；产物与 manifest 是审计对象，不是草稿。
