---
name: submission-fit
description: 投稿整备工作流：cover letter/highlights/声明逐项起草（数据可得性自动取证）、格式检查十项、审稿响应信（引用真实 diff hunk）、四道 GATE 的投稿包。
whenToUse: 用户要准备投稿材料、写 cover letter 或响应信、跑格式检查、打投稿包，或问「离能投还差什么」时使用。
---

# 投稿整备（submission-fit）

材料内容由**你自己**起草，srw_submission / srw_paper 工具负责落盘、取证与门；
门只验证「引用存在」，**不验证「改得对」**——结论必须交用户复核。

## 工作流

1. **起稿前三查**（任一不过先停下向用户说明）：
   - `srw_patent {action:'publication.check'}`——先申请后公开，投稿前必查；
   - `srw_paper {action:'cite.audit'}`——未解决引用先补；
   - `srw_materials {action:'verify'}`——素材证明链 mismatch 先修。
2. **材料草稿**：`srw_submission {action:'submission.draft'}` 逐字段落盘——
   - `field:'coverLetter'`：头部（标题/刊物/档位/轮次）自动填充，正文你起草；
     刊物 `unverified` 时封面会标「未核定」，提醒用户人工核对作者指南；
   - `field:'highlights'`：3–5 条、每条 ≤100 字符，逐条对应真实贡献；
   - `field:'statement.<kind>'`：声明逐项写。**数据可得性**会从 experiments/
     data registry 自动取证（authored 优先）；取不到的声明标「需作者确认」，
     你必须问作者本人，**绝不代填**。D2/D3 有缺稿声明 pack 会被阻断。
3. **格式检查**：`srw_paper {action:'format.check'}` 十项（模板/页数/摘要/图
   表计数/引用样式/图片 DPI/栏数）。档位区间是启发式（warn），但 verified
   刊物的 error 级不过必须整改后才能 pack。
4. **返修轮**（有审稿意见时）：`srw_paper {action:'snapshot.tag'}` 锚基线 →
   改稿编译 → `{action:'diff'}` 拿真实 hunk → `srw_submission {action:'review.open'}`
   结构化意见 → `review.respond` 的 changes **必须引用 diff 里真实存在的
   file+hunkIndex**（伪造引用会被 RESPONSE_UNBACKED 拒绝）→ `review.export`
   导出响应信。
5. **打包**：`srw_submission {action:'submission.pack'}`——七件套落
   submissions/<ts>/。GATE 拒绝时按返回原因逐项整改后重试。

## 红线

- 每一个数字、每一条声明都要能回指真实产物（metrics/manifest/registry）；
  缺证据就明说「需作者确认」，不编造。
- 响应信的「已修改」必须有 diff hunk 证据；不许说「已改」而拿不出位置。
- 声明不构成法律/伦理意见；COI/ethics 由作者本人撰写。
- 投稿包产出后由**人**上传到投稿系统——工具不做任何自动提交。
