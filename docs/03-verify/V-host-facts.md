# V 系列 · 宿主事实核对汇总（M0 收口时点）

- 日期：2026-10-04
- 口径：源码已给结论、运行时实跑签字的清单（0102 §16.2）。M0 期间顺带关闭/部分关闭的项在此登记；其余**绑定到 M1+ 的具体里程碑**顺带完成，不单开实验。
- 详细证据：[E1](E1-panel-rightbar-session.md) / [E2](E2-qilin-external-bundle.md) / [E3](E3-schedule-semantics.md) / [E4](E4-compute-reuse.md)

| # | 项 | 状态 | 说明 / 去向 |
|---|---|---|---|
| V1 | `connection.rpc.handle` 与裸 `webServer.register` 双通道挂载 | ◐ 部分关闭 | ✅ `webServer.register` 直连双通道实证（diag 往返 + 401 栅栏 + 设备 cookie）；`rpc.handle` 对第三方 patch row 待测（不阻塞：直连为已验证主路） |
| V2 | `requestRejection` 请求形态分布 | ◐ 部分关闭 | ✅ 无 cookie 回环 POST → 401；带设备 cookie → 放行。Origin/`sec-fetch-site` 变体 → M1 Task 1.3 的 `test:rpc` 用例顺带 |
| V3 | storage `version-mismatch` / `backup-and-skip` | ⬜ 待测 | M1 Task 1.5（storage 域）单测顺带 |
| V4 | `ctx.fs.contains` 符号链接/相对路径行为 | ⬜ 待测 | M1 Task 1.2 `pnpm test:security` 对真实宿主跑一次 |
| V5 | DSH 侧 `ctx.fs` 能力子集（缺 writeBytes 等） | ⬜ 待测 | M1 `pnpm test:host` 双分支；诊断面板已能观测（inject `fs` 后 caps 表即显示） |
| V6 | `ctx.fs.watch` 恒失败 | ⬜ 待测 | M1 顺带（项目文件变更监听选型） |
| V7 | `ctx.jobs` 座位是否挂实现 | ⬜ 待测 | M3（长任务进度）前探测 |
| V8 | `ctx.llm.stream` 错误形状 / usage chunk | ⬜ 待测 | M4（翻译链）首个真实 LLM 调用时录 |
| V9 | 代理链下 `globalThis.fetch` + arXiv 重定向 | ⬜ 待测 | M2 Task 2.7（PDF 获取）联网用例 |
| V10 | pdfjs legacy 双栏阅读顺序 | ⬜ 待测 | M4 Task 4.1（fixture 双栏 PDF） |
| V11 | sympy 缺席门 = `unverifiable` | ⬜ 待测 | M6 Task 6.3 |
| V12 | 长任务脱离托管 + 偏移续读 | ✅ **关闭** | E4：setsid nohup 判活 ALIVE；`tail -c +N`（N=1-based）两段拼接无缝；显式 exit/done 终态 |
| V13 | GPU 真机基线 | ✅ 本机关闭 / ◐ 远程待窗口 | 本机 WSL：2× RTX 4090（24G×2，driver 616.92，cc 8.9）；slurm/MIG 未测（WSL 无 slurm）；⚠ `nvidia-smi` 需全路径。`26训练`/`74推理` → M7 扩容窗口 |
| V14 | 技能 rank / SKILL.md frontmatter 字段名 | ⬜ 待测 | M1 Task 1.7（第一个技能 `research-idea` 注册时验证） |

**结论**：无一项阻塞 M1 开工。剩余项全部绑定具体里程碑的任务用例，随做随签。
