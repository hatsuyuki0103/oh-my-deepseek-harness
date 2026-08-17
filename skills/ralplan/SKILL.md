---
name: ralplan
description: 共识规划：Planner→Architect→Critic 顺序子代理审查循环 + RALPLAN-DR 结构化审议，产出 .omx/plans 下的 PRD 与测试规格。用户说「ralplan / consensus plan / 先出共识方案」或方案需要架构与测试形态审查时使用。
argument-hint: "[--interactive|--deliberate] <任务描述>"
---

# Ralplan（共识规划）

## 定位

Ralplan 是 `plan --consensus` 的独立入口：驱动 Planner、Architect、Critic 三个角色完成结构化审议（RALPLAN-DR：默认短模式，--deliberate 应对高风险），并记录完整评审生命周期。**它是规划模式：只产出规划产物，绝不直接改代码；执行交接必须经用户显式批准。**

## 标志

- `--interactive`：在关键决策点征求用户（草稿确认 + 最终批准）。不带此标志则全自动跑完 Planner→Architect→Critic 循环，输出最终计划，不执行。
- `--deliberate`：强制深思模式（3 场景 pre-mortem + 扩展测试计划：单元/集成/e2e/可观测）。请求本身带高风险信号（认证/安全、迁移、破坏性变更、生产事故、合规/PII、公共 API 破坏）时自动启用。

## 角色与子代理协议（DSH 版）

DSH 没有原生角色路由，角色 = **本插件 roles/ 目录下的提示词 + subagent 工具的隔离上下文**：

- 角色提示词位于本插件包根目录的 `roles/` 下（即本技能目录的上两级：`../../roles/planner.md`、`../../roles/architect.md`、`../../roles/critic.md`）。找不到时向用户报告，不要用随手编的短提示词顶替。
- 发起子代理：用 `subagent` 工具，prompt = 角色文件全文 + 完整任务陈述 + 上下文快照路径 + 相关产物路径（PRD/test-spec/既有评审）。
- **Architect 与 Critic 必须串行**：等 Architect 子代理完成后再发 Critic；绝不在同一批并行发起；绝不让 Architect 自批 Critic 闸。
- 起草计划的主会话不兼任审查者——评审必须由独立子代理上下文完成。

## 共识工作流

1. **Planner 起草**：自适应计划（步骤数匹配范围，不默认五步）+ 紧凑 RALPLAN-DR 摘要：
   - Principles（3-5 条）
   - Decision Drivers（前 3）
   - Viable Options（>= 2，带有限优缺点；只剩一个可行项时给显式否决理由）
   - deliberate 模式另加：pre-mortem（3 场景）+ 扩展测试计划
2. **用户反馈（仅 --interactive）**：ask_user_question 呈现草稿 + 摘要，选项：Proceed to review / Request changes / Skip review；非交互则自动进入评审。
3. **Architect 评审**：评审架构合理性，必须包含最强钢人反方论（antithesis）、至少一个真实权衡张力、可行时的综合路径；deliberate 模式显式标记原则违反。**等它完成后才进第 4 步。**
4. **Critic 评审**：核验原则-选项一致性、备选探索公平性、风险缓解清晰度、验收可测性、验证步骤具体性；deliberate 模式必须拒绝缺失/薄弱的 pre-mortem 或扩展测试计划。
5. **重审循环（上限 5 次）**：Critic 非 OKAY → 收集双方反馈 → Planner 修订 → 回 Architect → 回 Critic，直到 OKAY 或到上限（上限时把最好版本交给用户）。
6. **合并改进**：通过后把接受的改进合并进计划文件（含简短变更记录）；最终输出含 ADR（Decision / Drivers / Alternatives considered / Why chosen / Consequences / Follow-ups）+ DSH 执行交接指引（subagent 名册、workflow 并行方案、ralph 工具回退、goal 工具承接）。
7. **（仅 --interactive）最终批准**：ask_user_question 呈交计划：批准（选执行通道）/ 请求修改 / 拒绝。用户批准后才按所选通道交接；未批准绝不执行。

## 计划/执行边界

- Ralplan 进行中：只读仓库 + 只写 `.omx/context/`、`.omx/plans/`、`.omx/specs/`（以及必要的 `.omx/state/` 记录）。实现类写操作全部出界。
- 规范流程：`ralplan → 评审闭环 → 用户显式批准 → 执行通道（goal 工具 / workflow 团队 / ralph 工具）`。
- 交接前必须落盘**持久化交接记录**（.omx/plans/ralplan-{slug}-handoff.md 或计划文件内独立段）：

```
- planning_artifacts: PRD/test-spec 路径
- ralplan_architect_review: Architect 评审结论（含 antithesis/tradeoff/synthesis）
- ralplan_critic_review: Critic 评审结论（只在 Architect 之后记录）
- ralplan_consensus_gate.complete: true/false（false 时带 blocked_reason，如 user_approval_pending）
- recommended_lane: goal / workflow / ralph / none + staffing 建议
```

- 只有 PRD 与 test-spec 文件存在**不等于**共识达成，也不等于可以执行。

## 预上下文摄取

1. 从请求提取任务 slug；
2. 复用 .omx/context/{slug}-*.md 中最近快照；没有就建一个（任务陈述/期望结果/已知事实/约束/未知项/可能触点）；
3. 歧义仍高时先自查棕色地带事实（grep/glob/read），再跑 `deep-interview --quick` 收口；
4. 计划依赖外部事实（官方文档/框架版本行为/最佳实践）时用 web_search 收集证据并写进计划；
5. 摄取完成前不交接执行；紧急情况下强行推进要显式记录风险取舍。

## 执行前闸（ralplan-first gate）

执行通道（ralph 工具 / autopilot / workflow 团队）代价高，模糊请求先被本闸拦下转共识规划：

**通过（可直接执行，任一信号即可）**：带文件路径、issue/PR 编号、camelCase/PascalCase/snake_case 符号、测试命令、编号步骤、验收标准、错误引用、代码块，或 `force:` / `!` 前缀。

**拦截（先转 ralplan）**：如「ralph fix this」「autopilot build the app」「team improve performance」——无文件、无符号、无测试规格。

**绕过**：`force: <请求>` 或 `! <请求>`。

## 目标模式跟进（用户批准执行后）

- 长期可追踪目标 → DSH goal 工具（create_goal，客观验收后 update_goal 标 complete）；
- 持久单主闭环（用户明确要求）→ DSH 原生 ralph 工具；
- 多路并行 → team / ultrawork（基于 workflow 工具）；
- 默认推荐 goal 工具承接（可追踪、可续跑）；workflow 团队适合可并行拆分的交付；ralph 只在用户点名时用。

## 升级与停止条件

- 用户说停止/取消 → 落盘当前状态并停；
- Architect 缺失/被阻 → 停在 Architect 评审并报告；
- Critic 缺失/被阻/不通过 → 停在 Critic/重审或报告上限结果；
- 5 次循环未 OKAY → 把最好版本交给用户并说明共识未达成；
- 不可调和取舍 → 上报用户做业务决策。

## 最终清单

- [ ] 预上下文快照存在（.omx/context/{slug}-*.md）
- [ ] RALPLAN-DR 摘要齐全（3-5 原则 / 前 3 驱动 / >=2 选项或否决理由）
- [ ] Architect 评审完成且含 antithesis/tradeoff tension/synthesis（deliberate 时含原则违反标记）
- [ ] Critic 在 Architect 之后运行且结论明确
- [ ] 重审循环上限 5 次内收敛，改进已合并并留变更记录
- [ ] ADR 段齐全
- [ ] PRD 与 test-spec 落在 .omx/plans/
- [ ] 持久化交接记录已写，consensus_gate.complete 状态明确
- [ ] 未经用户显式批准未启动任何执行通道
- [ ] 本模式内未改任何业务代码
