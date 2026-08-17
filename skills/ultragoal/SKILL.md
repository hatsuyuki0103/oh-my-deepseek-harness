---
name: ultragoal
description: 持久多目标执行：把简报拆成故事，用 DSH goal 工具建聚合目标，.omx/ultragoal 台账逐故事检查点与完成审计。用户说「ultragoal / 建目标 / 多目标计划 / 顺序执行目标」时使用。
argument-hint: "<简报或规格路径>"
---

# Ultragoal（持久多目标执行）

## 定位

Ultragoal 把一份简报变成仓库内持久工件（.omx/ultragoal/brief.md、goals.json、ledger.jsonl），再用 **DSH goal 工具**安全驱动执行：一个聚合目标（create_goal 建一次）指向整个计划，故事 G001/G002… 的进度记在台账里。DSH 的 create_goal / get_goal / update_goal 即 Codex goal mode 的对应物。

## 建目标（create-goals）

1. 输入：简报文本或 .omx/plans/ 规格路径（如 deep-interview / ralplan 产物）；
2. 生成 .omx/ultragoal/goals.json：聚合目标（objective 为指向 brief.md 的稳定指针）+ 故事列表（G001/G002…，每条含 objective、验收标准、依赖、优先级）；
3. 生成 .omx/ultragoal/brief.md（原始简报 + 约束 + 架构/领域不变量节，如有）；
4. 检查并精修 goals.json 再开工。

## 完成目标（complete-goals 循环）

循环直到全部故事完成：

1. 读台账挑当前故事（按依赖与优先级）；
2. **get_goal** 查活动目标：无活动目标 → create_goal（objective = 聚合指针目标）；已有同聚合目标 → 继续当前故事，不重复建；
3. 只完成当前这一个故事；
4. 对该故事目标做完成审计：故事 objective ↔ 真实产物/测试证据逐条核对；
5. 中间故事**不** update_goal（聚合目标仍 active）；checkpoint 写 ledger.jsonl（用新鲜 get_goal 快照佐证）；
6. 最后一个故事：先跑**最终清理/评审闸**（见下），闸干净才 update_goal(action complete)，再 get_goal 取 fresh complete 快照做最终 checkpoint；
7. 被阻/失败：checkpoint 记 failed/blocked + 证据；用转向（steer）或后续故事解决；
8. 完成后运行 `create_goal` 建下一个聚合目标前，确保无其他活动目标（DSH 同会话只有一个活动目标；旧目标已 complete 才能建新目标）。

## 台账格式（ledger.jsonl 每行一条）

{"ts": "...", "story_id": "G001", "status": "checkpoint|complete|failed|blocked", "evidence": "...", "goal_snapshot": "<get_goal 摘要>"}

## 动态转向（steer）

真实发现/阻塞证明故事拆分该变时（聚合目标与简报约束不变）显式转向，禁止猜测：

- 允许：add_subgoal / split_subgoal / reorder_pending / revise_pending_wording / annotate_ledger / mark_blocked_superseded；
- 不变式：不改聚合 objective、简报约束、质量闸与完成状态；不硬删故事、不自动完成工作、不弱化验证；每次转向在 ledger.jsonl 追加审计条目；
- 被取代/无替代的阻塞故事跳过调度，但最终完成前必须有显式转向处理。

## 与 Team 叠加

故事明显受益于并行时：ultragoal 保持 leader 所有（goals.json + ledger.jsonl），team（workflow 工具）做并行执行、交任务/证据状态。worker 不碰目标状态、不建台账、不 checkpoint；leader 用 team 终验证据 + 新鲜 get_goal 快照做 checkpoint。

## 最终清理/评审闸（最后一个故事完成前必跑）

1. 故事定向验证（新鲜证据）；
2. ai-slop-cleaner 技能对改动文件清扫（无相关改动则记录 no-op 通过）；
3. 清扫后重跑验证；
4. **架构不变量审计**：从 brief/spec/访谈/转向产物推导不可协商的架构/领域不变量，逐条用实现证据 + 测试证据 + 独立评审证据证明；
5. **独立评审**：code-review 技能走独立子代理路径（code-reviewer + architect 两个独立 subagent），干净 = 推荐 APPROVE 且架构 CLEAR 且不变量闸 passed；
6. 闸不干净 → **不** update_goal；记录 review-blocked 阻塞故事（证据 = 评审发现），继续修；
7. 闸干净 → update_goal(action complete) → get_goal 取 complete 快照 → 最终 checkpoint（含质量闸 JSON：aiSlopCleaner / verification / codeReview / architectureInvariantGate）。

## 约束（硬规则）

- get_goal 报告有**另一个**活动目标时绝不 create_goal；
- 聚合目标未真正全部完成绝不 update_goal(action complete)；
- 中间故事 checkpoint 需 active 快照，最终完成需 complete 快照；
- ledger.jsonl 是持久审计轨迹：每次成功/失败都 checkpoint；
- goal 工具是唯一目标状态接口，任何文件/脚本不得暗改目标。

## 最终清单

- [ ] brief.md / goals.json / ledger.jsonl 存在且一致
- [ ] 聚合目标已 create_goal（或确认同聚合目标仍 active）
- [ ] 每个故事完成前做过 objective↔证据 完成审计
- [ ] 中间故事只 checkpoint，不 update_goal
- [ ] 最终故事通过清理/评审闸（deslop + 回归验证 + 不变量审计 + 独立双 subagent 评审）
- [ ] 全部完成后 update_goal(action complete) + complete 快照最终 checkpoint
- [ ] ledger 无缺口（成功/失败/被阻都有记录）
- [ ] worker（team 叠加时）未碰目标状态
