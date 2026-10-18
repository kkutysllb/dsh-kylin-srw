---
name: repro-audit
description: 复现审计工作流：从 spec+runs+registry 审计一次实验是否可复现（代码哈希/种子/环境/数据集哈希），用 claims.check 把论文数字逐点对账，用 gaps.list 列出补数据缺口并按 P0>P1>P2 排期。
whenToUse: 用户要审计实验可复现性、核对论文数字、盘点补数据缺口，或准备投稿前的证明链时使用。
---

# 复现审计（repro-audit）

目标口径（04 文档 §10）：**gaps 的 P0/P1 为空 且 所有 claim verified**。
审计是找茬，不是背书——每一项都给出可执行的复核路径。

## 工作流

1. **run 溯源面**：对每个引用的 run 检查 runs/<runId>/run.json——
   code.archiveSha256 + code.manifestSha256（代码快照哈希，gitCommit 可空
   但哈希必须有）、env.cudaVisibleDevices + gpus（环境快照）、seeds、
   inputs[].sha256（数据集哈希）。缺任何一项就是复现缺口。
2. **数字对账**：把论文正文/表格里的每个数字登记进 paper/claims.json：
   `{id, kind: number|table-cell, source: {path, metric, reducer: mean|median|last, n?},
   value, digits, tolerance?}`，然后 `claims.check`。
   - verified：重算在容差内（容差缺省 0.5×10^-digits，stderr 会并入）；
   - mismatch：**查源**——metrics 被手改/路径指错/reducer 选错；恢复文件后
     重跑，绝不改 claim 基线来「复绿」；
   - unverifiable：源缺失/指标缺失/n 不符/hashPolicy=none——论文里要么补
     数据要么脚注「未验证」，不许冒充 verified。
3. **缺口盘点**：`gaps.list {project, expId}` 生成 gaps.json + queue.json。
   优先级语义：P0=阻断 claim（failed-run 被引用、mismatch/unverifiable）>
   P1=档位硬要求（数据集/基线/种子不足、缺显著性）> P2=成本/异常值分析。
   排序同级按 estGpuHours 升序「填谷」。
4. **补数据纪律**：缺失不插值不猜；异常值保留原始值（中位数偏离 >30% 记
   outlier，聚合时给 exclude 清单+理由）；失败 run 不许「只报成功 seed」。
   补跑 = 新 runId + parentRunId，旧数据保留。
5. **完成判定**：P0/P1 清空 + claims 全 verified + 无非终态作业——三者
   全真才算「补完了」，任何一项为假都要显式可见并告知用户。

## 红线

- **不改基线**：mismatch 恢复源文件，不改 claim.value 凑数。
- **不假 verified**：unverifiable 就是 unverifiable（hashPolicy=none、缺源
  都算），脚注是诚实不是污点。
- **哈希是唯一真相**：数据集/代码/指标的身份就是 sha256；改一个字节必
  mismatch，这是特性不是 bug。
