# E3 · `ctx.schedule` 运行时边界（收口记录）

- 日期：2026-10-04（19:05–19:20）
- 环境：麒麟 web profile（3091 验证实例）、`dsh-kylin-srw@0.0.1`（link:）
- 状态：**✅ 收口**——主结论早已由源码定论（0102 §10.1：`create(sessionId, req)` 只把消息投递进既有会话、不能新建根 agent、不补发）；本轮补上运行时形态，并**新发现一条 profile 编排事实**。ADR-8 维持。

## 运行时实测

| # | 项 | 结果 |
|---|---|---|
| 1 | inject 一个 profile 未挂载的服务（`schedule` in web profile） | ⚠ **插件永久 pending**：宿主日志 `dsh-kylin-srw (…): pending (waiting for service: schedule)`，面板不出现；撤回 inject 后恢复。**这是 inject 纪律的运行时证据：名单里的每个名字必须是「目标宿主编排保证存在」的服务** |
| 2 | `ctx.get('schedule')` 绕过 inject？ | ❌ 同样被拦：`cannot get property "schedule" without inject`——宿主服务访问**只有 inject 一条路**（协议级设计，非实现瑕疵） |
| 3 | 服务缺席时的降级形态 | ✅ `diag.schedule.create` 返回结构化 `{ok:false, error:{code:'NO_PROVIDER', message:…}}`——降级契约工作正常，A′ 车道可据此整体禁用并说明 |
| 4 | （顺带）RPC 鉴权栅栏 | ✅ 无 cookie 的回环 POST → **401**，设备 cookie 交换（token URL → 303 + Set-Cookie）后放行 |
| 5 | 真实投递 / 失联 / 不补发三边界 | ◐ **本 profile 无法实测**（服务未挂载）——需在含 schedule 的宿主形态（DSH 桌面端，`~/.kcoder/storages/schedule.json` 在案）开窗口跑；步骤与判据保留在下方 |

## 新宿主事实（0102 §5.3 勘误项）

**「ctx.schedule 双通道可用 ✅」要拆成两层**：服务**代码**双通道同构（✅ 源码核对不变）；但**profile 编排决定可用性**——麒麟 web profile 默认编排**不含** schedule 插件（本轮 pending 实证），KCoder/桌面端已挂载（`~/.kcoder/storages/schedule.json` 在案）。推论：**任何依赖 schedule 的功能（A′ 提醒道）必须先能力探测 + 缺席降级**，不能写死可用。

## 对产品的影响

- **零阻塞**：ADR-8 的确定性抓取走自建时钟（车道 A）、无人值守走 `agents.create`（车道 B），本就不依赖 `ctx.schedule`；schedule 只是可选的 A′ 提醒道。
- **M3 新增纪律**：接入 schedule 前先探测（collectCaps 加一行 + 启动时判定），缺席 → A′ 车道置灰并给出「当前宿主形态未挂载 schedule」的说明。
- **inject 名单维护规则**（写进 M1 开工约定）：每加一个名字，先确认两通道目标 profile 编排都挂载；否则用软探测 + 降级，绝不进 inject。

## 遗留（低优先，不阻塞 M1）

在 DSH 桌面端（有 schedule）跑三边界：
1. `create(活会话, {after_seconds:10, …})` → 验 agent 被恢复跑一轮；进程重启后是否仍被拾起；
2. `create(不存在的 sessionId, …)` → 验投递时只 warn、任务永久 `active` 不重试（「静默失联」形态原文核对）；
3. 改存储 `scheduledAt` 越过 3 个周期 → 验只投递最近一次（不补发）+ `daily{time_zone:'Asia/Shanghai'}` 落点。

试验端点（`diag.schedule.create/list/delete/storage`）保留在代码中（服务缺席时返回 NO_PROVIDER），M3 定稿 A′ 时复用。
