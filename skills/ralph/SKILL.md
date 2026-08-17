---
name: ralph
description: 持久执行闭环：不完成任务不停，带架构复核与新鲜验证证据。用户说「ralph / don't stop / 必须完成 / keep going」或任务需要保证完成并验证时使用。
argument-hint: "[--prd|--no-deslop] <任务描述>"
---

# Ralph（持久执行闭环）

## 目的

Ralph 是一个持续到完成并验证的持久循环：任务做完整、测试不偷删、每次完成都拿新鲜证据 + 架构师子代理复核。DSH 环境下有两个等价引擎，按场景选：

- **DSH 原生 `ralph` 工具**：用户明确要求 Ralph 循环时用它——每个轮次开全新子代理、以共享工作区为长期记忆、轮次间只传结构化报告；适合跨多轮、需要持久性的任务。
- **会话内 Ralph 纪律**：不满足 ralph 工具条件（或只需一轮即可完成）时，在会话内执行同一套纪律：todo 清单 + 后台任务 + 新鲜验证 + 独立复核。

## 何时使用 / 何时不用

使用：任务必须保证完成并验证（不是"尽力而为"）；用户说 "ralph" / "don't stop" / "must complete" / "keep going"；工作跨多轮需要持久化；任务受益于并行执行 + 最终架构师签字。

不用：要从想法到代码的全程自动流水线（用 autopilot）；想先探索/规划（用 plan / ralplan）；快速单点修复（直接用 executor 子代理或主会话）；用户要手动控制完成节奏（用 ultrawork）。

## 执行策略

- 独立工作并行发，绝不串行等；长操作（安装、构建、测试套件）一律后台任务（run_in_background）+ job 工具收结果。
- 完整交付：不缩范围、不做半成品、不为通过而删测试。
- 结果先行、更新简洁、局部覆盖、验证与风险匹配、停止规则显式；只问实质破坏性/凭证门控/外部生产/偏好依赖的分支。
- 与 DSH goal 工具集成：有活动目标时先 get_goal，把目标当作顶层停止条件；只有 Ralph 完成审计证明目标真的达成后，才 update_goal(action complete)。

## 步骤

0. **预上下文摄取（进入循环前必须）**：
   - 建/复用 .omx/context/{slug}-{timestamp}.md 快照（任务陈述/期望结果/已知事实/约束/未知项/可能触点）。
   - 请求歧义高时：先查棕色地带事实（grep/glob/read），再跑 deep-interview --quick 收口关键缺口。
   - 快照落地前不做执行工作；紧急推进则显式记录风险取舍。
1. **审进度**：读 todo 清单与 .omx/state 里上一轮状态。
2. **从断点继续**：接着未完成的任务做。
3. **并行委派**：独立子任务用 subagent 并行后台发（prompt = roles/executor.md 全文 + 任务切片 + 验收标准）；简单查询低投入、标准实现中投入、复杂分析高投入（在 prompt 里写明要求，不依赖角色路由）。
4. **长操作后台跑**：构建/安装/测试套件 run_in_background，用 job 工具收输出。
5. **新鲜证据验证**：确定什么命令能证明完成 → 实际跑 → 读输出确认真的过了 → 核对 todo 无 pending/in_progress 残留。
6. **架构复核（Ralph 底线）**：再小也要跑一次独立复核——subagent（roles/architect.md 或 roles/verifier.md 前缀）检查实现与证据；不合格就修并重验，不停。
7. **可选清扫（deslop）**：默认对本次改动文件跑 ai-slop-cleaner 技能（standard 模式）；用户带 --no-deslop 则跳过。清扫后必须重跑全部验证（回归失败则回退清扫或修复，直到全绿）。
8. **完成审计 + 目标收口**：有活动 goal 时——逐条把用户要求/工作流闸/文件/命令映射到产物与证据（prompt-to-artifact 清单），全部通过才 update_goal(action complete)。
9. **干净收尾**：清理 .omx/state 的 ralph 状态；报告改动文件、验证证据与剩余风险。

## 状态管理（文件约定）

无 omx CLI；状态写 .omx/state/{scope}/ralph-progress.json（无 scope 时写根 scope）：

- 启动：{"mode":"ralph","active":true,"iteration":1,"current_phase":"executing","context_snapshot_path":"<path>"}
- 每轮/阶段切换：更新 iteration 与 current_phase（executing/verifying/fixing/complete）
- 完成（仅当完成审计通过）：active:false、current_phase:"complete"、completion_audit{passed:true, checklist:[...], evidence:[...]}
- 取消/清理：删掉该状态文件。

## PRD 模式（--prd）

带 --prd 时先建需求文档再进循环：

1. 跑 deep-interview --quick 做紧凑需求收口，产物 .omx/interviews/{slug}-{timestamp}.md；
2. 建 .omx/plans/prd-{slug}.md（需求/范围/验收）+ .omx/state/{scope}/ralph-progress.json（进度台账）；
3. 把任务拆成用户故事（id、标题、As a...I want...so that、验收标准、优先级），故事尺寸合适（一个会话一个）、标准可验证、故事间独立、基础工作优先；
4. 以用户故事为任务清单进入常规循环。

## 升级与停止条件

- 根本阻塞需要用户输入（缺凭证/需求不清/外部服务挂）→ 停并报告；
- 用户说停止/取消 → 落盘状态并停；
- 架构复核否决 → 修复并重验，不停；
- 同一问题跨 3+ 轮复发 → 作为潜在根本问题上报。

## 最终清单

- [ ] 原任务全部需求满足（无范围缩减）
- [ ] todo 无 pending / in_progress 残留
- [ ] 新鲜测试输出全过
- [ ] 新鲜构建输出成功（适用时）
- [ ] 独立架构复核通过（subagent 证据）
- [ ] 有活动 goal 时完成审计通过且已 update_goal(action complete)
- [ ] deslop 清扫完成（或 --no-deslop 显式跳过）且清扫后回归全绿
- [ ] .omx/state 的 ralph 状态已清理
