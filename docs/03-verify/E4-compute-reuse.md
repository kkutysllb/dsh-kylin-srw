# E4 · 算力复用三级链与长任务脱离托管（阶段记录）

- 日期：2026-10-04
- 目标主机：**WSL `125.64.108.97:18908`**（用户口径的 M7 初期算力目标；`26训练`/`74推理` 推迟）
- 状态：**①② 级适用性定论 + ③ 级通路配置就绪但当前不可达**；机制演练（V12）待 SSH 可用窗口
- 证据分级：✅ 本会话实跑；⚠ 未核实

## 逐级结论

### 第 ① 级 ControlMaster 复用 —— 注册在案（dev home），当前不可用

- ✅ **WSL 主机已注册**：`~/.kcoder-dev/ssh-remote/hosts.json` 命中 `125.64.108.97`（2 处）——注意是 **`.kcoder-dev`**（dsh-ssh-remote 的 dev home），不是 0102 记录的 `~/.kcoder`；两套 home 并存，`compute/hosts` 实现要**两处都探测**（ADR-20 候选补充）。
- ✅ `~/.ssh/config` 已有两条由 ssh-remote 引导生成的主机别名：`dsh-wsl2`（User `kkutys`，key `~/.ssh/dsh_wsl2_ed25519`）与 `dsh-125-64-108-97`（key 在 `~/.kcoder-dev/ssh-remote/keys/`）→ **用户侧凭据引导已完成，我们永远不需要碰 `credentials.enc`**。
- ✅ 两处 `cm/` 目录均**无在线 socket**（master 不在线）→ 第 ① 级的前提「用户近期用过 SSH 工具」当前不成立。**裁定：本级机制保留为 P0 优先，可用性随宿主使用浮动；实现上「探测 socket 存在才尝试」。

### 第 ② 级 工具表 `ssh_run` —— 待测（依赖 DSH 桌面端会话）

- ⚠ `ctx.tools.execute('ssh_run')` 需要 agent 作用域 + callId，且 dsh-ssh-remote 装在 **DSH 桌面端**世界（`~/.kcoder(-dev)`）——麒麟 web profile 未装。实测方式：在桌面端开会话由 agent 调用。**待用户配合窗口**；我们自己的审批门在前（0102 §8.2）。

### 第 ③ 级 直连 —— 配置就绪，**当前不可达（待在线窗口）**

- ✅ TCP `125.64.108.97:18908` 连通（`nc -z` 成功）。
- ✅ SSH 通路配置齐备（config 别名 + 独立 key，BatchMode 可验）。
- ❌ **SSH banner 不可达**：banner 探测 15s 空响应；`ssh` 先报 `timed out during banner exchange`、后报 `Connection closed`——典型「Windows 侧端口转发存活、WSL 内 sshd 未运行」。**需要用户在 Windows 侧启动 WSL/sshssd** 后重跑（这是唯一的阻塞点）。
- 预期通过后的验收项（待重跑）：`echo ok` 连通 → `nvidia-smi -L` GPU 盘点 → python3/node 环境 → `uname`。

## V12 长任务脱离托管 —— 待 SSH 窗口（判据已定稿）

- ✅ `tail -c +N` 的 N 为 **1-based** 已本地验证（`tail -c +3` 于 `ABCDEFGHIJ` 得 `CDEFGHIJ`）。
- ✅ 注记：macOS 无 `setsid`（远端 Linux 有）——`scripts/remote/launch.sh` 只在远端执行，无碍；但本地 fixture 测试不能复用同一脚本路径。
- 待跑（SSH 恢复后 ~5 分钟）：
  1. `setsid nohup bash -c 'sleep 20 && echo done > /tmp/srw-e4.txt' >/tmp/srw-e4.log 2>&1 & echo $! > /tmp/srw-e4.pid`
  2. 断开本 ssh → 重连接 `kill -0 $(cat /tmp/srw-e4.pid)` 判活 → 20s 后验 done 文件与退出码文件；
  3. 日志偏移续读：两段式 `tail -c +1` / `tail -c +$((${已读}+1))` 无重复无缺口。

## 对架构/计划的回改项

| 项 | 回改 |
|---|---|
| hosts.json 位置 | 0102 §11.1「`<home>/ssh-remote/hosts.json`」补注：**`~/.kcoder` 与 `~/.kcoder-dev` 双 home 并存，`compute/hosts` 两处探测、以修改时间新者为准** |
| 三级链适用性 | §11.1 的「WSL 预计不在 hosts.json」被推翻——**已注册**（dev home），①②③ 三级对 WSL 全部适用 |
| RISK-4 | 由「中」改「低」：注册/凭据/别名全部就绪，唯一变量是 sshd 在线窗口（RISK-10 同源） |
| Task 7.2 | 补「双 home 探测」用例 |

## 阻塞与请求

**唯一阻塞**：WSL 内 sshd 未运行。请在 Windows 侧任选其一：① 启动 WSL（`wsl` 进入后 `sudo service ssh start` 或等效）；② 若转发由 wsltty/nat 等方案托管，重启该转发。就绪后我立即重跑第 ③ 级连通 + V12 全套（约 5 分钟出全部结论）。
