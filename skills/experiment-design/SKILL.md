---
name: experiment-design
description: 实验设计工作流：把论文档位（D1/D2/D3）要求翻成可执行的实验 spec（数据集/基线/种子/消融/显著性/成本），过设计门后用 srw_experiment submit 提交 GPU 作业并跟踪七态生命周期。
whenToUse: 用户要设计实验、跑 GPU 实验、提交训练/评测作业，或问「这个档位要哪些实验」时使用。
---

# 实验设计（experiment-design）

spec 是实验的法律文本：一旦确认（confirmed=true）并提交，runs 只增不改。
你的职责是把「论文档位要求」翻成诚实的 spec，而不是把 spec 凑过门。

## 工作流

1. **定档位**：论文在 srw_paper 里应用的 tier（D1/D2/D3）决定最低要求——
   用 `srw_experiment env` 先盘点主机（GPU 数/显存/nvcc），再按档位填 spec：
   D1 需要 ≥1 数据集 + ≥2 基线 + 1 种子；D2 ≥2 数据集 + ≥4 基线 + 消融；
   D3 ≥3 数据集 + ≥6 基线 + ≥3 种子 + 消融 + 显著性 + 成本分析。
2. **写 spec**：`{expId, tier, entry: ["bash","job.sh"], gpus: 1, seeds: [...],
   datasets: [...], baselines: [...], metrics: [...], ablation?, significance?,
   costAnalysis?, job?: {env?, maxHours?}, confirmed}`。entry 是远端作业入口
   （argv 词）；env 键值与 entry 都会单引号转义后写进 job.sh——**不要试图把
   shell 语法塞进 entry**，复杂逻辑写成脚本文件随 code 一起上传。
3. **确认**：向用户逐项过 spec（尤其 seeds/datasets/baselines 数量与
   maxHours 预算），用户点头后 confirmed=true。未确认就 submit 会被
   SPEC_NOT_CONFIRMED 拦下——这是设计门，不要绕。
4. **注册数据集**：引用的数据集必须先 `dataset.register`（license 必填；
   hashPolicy=none 的数据集可以跑，但引用它的论文数字只能 unverifiable）。
5. **提交**：`submit {project, spec, code: [{path, contentBase64}]}`（需用户
   审批——远端代码执行）。档位硬缺口会报 D_TIER_BLOCK：要么补 spec，要么向
   用户明说再用 ack=true 放行（会落修订审计，不要偷偷 ack）。
6. **跟踪**：`status {project, expId}` 轮询（≤10s 间隔，向用户报进度）；
   七态 queued/running/succeeded/failed/cancelled/interrupted/unknown——
   unknown 表示远端三件套全丢，绝不假成功，要人工确认。`logs` 偏移续读看
   输出；失败先看日志首 4KiB（OOM/语法错都有机读原因）。
7. **归集**：succeeded 后 `collect` 回传 metrics.json/artifacts（sha256 与
   远端对账），然后 `claims.check` 把论文数字逐点对账；缺口走 `gaps.list`。

## 红线

- **不假跑**：主机不可达/GPU 全忙时 run 保持 queued（HOST_UNREACHABLE /
  NO_FREE_GPU），绝不换本地假数据冒充结果。
- **不编造**：metrics 由远端作业产出并 sha256 对账；collect 不出来的数字
  不能进论文。
- **不绕门**：SPEC_NOT_CONFIRMED 与 D_TIER_BLOCK 是用户知情权，ack 必须
  用户明示。
- **数据只增不删**：重跑用新 runId（attempt+1，parentRunId 指旧 run）；
  失败 run 保留，分母效应（n_planned/n_ok）显式化。
