# E4 · 算力复用三级链与长任务脱离托管（终版）

- 日期：2026-10-04（18:44–18:52；WSL 重启后重跑）
- 目标主机：**WSL `125.64.108.97:18908`**（用户口径的 M7 初期算力目标）
- 状态：**✅ 第 ③ 级直连 + V12 脱离托管全部通过**；① 机制保留、② 待桌面端窗口
- 证据分级：✅ 本会话实跑（命令与输出摘要如下）

## 逐级结论

### 第 ③ 级 直连 —— ✅ 通过（主路径成立）

- ✅ `ssh -o BatchMode=yes dsh-wsl2 'echo CONNECTED'` → `CONNECTED`（key 认证、零交互、零凭据读取）。
- ✅ 环境盘点（V13 WSL 基线）：
  - OS：WSL2，kernel `6.18.33.2-microsoft-standard-WSL2`，x86_64，host `kkutysllb`；
  - **`nvidia-smi` 不可用——这台 WSL 当前没有 GPU 透传**：M7 的 GPU 作业（V13 基线、CUDA_VISIBLE_DEVICES 注入）**不能在本机验收**，真实 GPU 运行仍需 `26训练`/`74推理` 在线窗口或给本机装驱动/直通；本机定位调整为「远程执行机制验收 + CPU 型作业」；
  - `python3 3.14.4` ✓、`bash` ✓、`setsid /usr/bin/setsid` ✓、`node` ✗（实验环境需自带/远端安装）。

### V12 长任务脱离托管 —— ✅ 全套通过（架构级判据）

| 步骤 | 实测 |
|---|---|
| `setsid nohup … & echo $! > pid` 点火 | ✅ `launched pid=740`，ssh 会话正常返回 |
| **会话退出后判活**（新连接 `kill -0 $(cat pid)`） | ✅ **ALIVE**——远端进程不随 SSH 会话存活，0102 §11.2 的派发纪律成立 |
| 日志按字节偏移续读 | ✅ `head -c 40` + `tail -c +41` 两段拼接与全量一致，无重复无缺口（N=1-based 已本地验证） |
| 显式终态 | ✅ 12 tick 全部完成；`exit 文件=0`、`done 文件` 就位（「显式成功而非静默」契约可落地） |
| 清理 | ✅ 远端临时文件已删 |

### 第 ① 级 ControlMaster 复用 —— 机制保留，可用性浮动

- ✅ WSL 已注册于 `~/.kcoder-dev/ssh-remote/hosts.json`（**dev home**——与 `~/.kcoder` 双 home 并存，0102 §11.1 待补注：`compute/hosts` 两处探测）。
- ✅ `.ssh/config` 已有 ssh-remote 引导的别名与独立 key（`dsh-wsl2` / `dsh-125-64-108-97`）→ **我们永不碰 `credentials.enc`** 的红线成立且无代价。
- ✅ 两处 `cm/` 当前无在线 socket → 实现纪律：**探测到 `<home>/ssh-remote/cm/<id>.sock` 存在才尝试复用**，否则走 ③。

### 第 ② 级 工具表 `ssh_run` —— 待测（低优先）

- ⚠ 需要 DSH 桌面端会话由 agent 调用（麒麟 web profile 未装 dsh-ssh-remote）。第 ③ 级已是可用主路径，本级降为「增强项」，M7 前找桌面端窗口补测一次即可。

## 对架构/计划的回改项（Task 0.10 汇总清单）

| 项 | 回改 |
|---|---|
| 0102 §11.1 | 「WSL 预计不在 hosts.json」**推翻**：已注册于 dev home；补「双 home（`~/.kcoder` + `~/.kcoder-dev`）探测」 |
| 0102 §11.3 / RISK-10 | 本机 WSL **无 GPU**：M7 真实 GPU 验收仍需远程窗口；本机承担「机制验收 + CPU 作业」 |
| RISK-4 | 「中 → 低」：直连主路径实测通过，三级链只剩增强项 |
| RISK-13 / V12 | **关闭**：脱离托管 + 偏移续读 + 显式终态全部实测通过 |
| 0201 Task 7.2 | 补双 home 探测用例；Task 7.5 的偏移续读语义已验证（N=1-based） |

## 遗留

- 第 ② 级 `ssh_run` 补测（桌面端窗口，≤10 分钟）。
- 真实 GPU 基线（`26训练`/`74推理`）——M7 排期，不阻塞 M0。
