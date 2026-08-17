---
name: plan
description: 战略规划：按请求具体度自动选择「访谈澄清」或「直接规划」，支持共识模式（Planner→Architect→Critic 循环 + RALPLAN-DR 结构化审议）与评审模式（对已有计划的 Critic 评估）。用户说「plan this / 帮我规划 / let's plan」或想先规划再实现时使用。
argument-hint: "[--direct|--consensus|--interactive|--deliberate|--review] <任务描述>"
---

# Plan（规划）

## 目的

Plan 通过智能交互产出全面、可执行的工作计划：宽泛请求自动进入访谈，具体请求直接规划；共识模式（consensus）用 Planner→Architect→Critic 循环 + RALPLAN-DR 结构化审议做多视角校验；评审模式（review）让 Critic 评估已有计划。

## 何时使用 / 何时不用

使用：用户想先规划再实现；模糊想法需要结构化需求收集；要评审已有计划（"review this plan" / --review）；要多视角共识（--consensus / "ralplan"）；任务宽泛、写码前需要定界。

不用：用户要端到端自动执行（用 autopilot）；任务清晰想直接写码（用 ralph 工具或直接干）；简单问题（直接回答）；单点修复范围明显（跳过规划直接做）。

## 模式选择

| 模式 | 触发 | 行为 |
|------|------|------|
| Interview | 默认（宽泛请求） | 交互式需求收集 |
| Direct | --direct 或请求已具体 | 跳过访谈直接出计划 |
| Consensus | --consensus / "ralplan" | Planner→Architect→Critic 循环直到一致（默认短模式，--deliberate 应对高风险）；默认只输出计划不执行 |
| Consensus Interactive | --consensus --interactive | 同上，但在草稿与批准节点暂停征求用户，批准后才交接执行 |
| Review | --review / "review this plan" | 对已有计划做 Critic 评估 |

## 执行策略

- 按请求具体度自动判定访谈 vs 直接模式。
- 访谈时**每次只问一个问题**（ask_user_question 一次一个 question），绝不批量合并多轮。
- 代码事实先自查（grep / glob / read），再问用户。
- 计划质量标准：80%+ 论断引用 file/line；90%+ 验收标准可测。
- 实现步骤数量匹配任务范围；不要默认五步。
- 共识模式默认输出最终计划（不执行）；--interactive 才做执行交接。
- 高风险信号（认证/安全、数据迁移、破坏性/不可逆变更、生产事故、合规/PII、公共 API 破坏）自动启用 deliberate 模式。
- 结果先行、可见更新简洁、局部覆盖、证据支撑、明确停止规则；只问实质破坏性/需凭证/外部生产/偏好依赖的分支。

## 步骤

### Interview 模式（宽泛请求）

1. 分类请求：宽泛（模糊动词、无具体文件、触及 3+ 区域）→ 访谈。
2. 用 ask_user_question 一次问一个焦点问题（偏好/范围/约束）。
3. 先查代码事实，再问有依据的跟进问题。
4. 每个问题建立在上一个回答之上。
5. 需要时用 analyst 子代理（roles/analyst.md）挖隐藏需求、边界与风险。
6. 用户示意就绪（"出计划"）后产出计划。

### Direct 模式（具体请求）

1. 可选：analyst 快速过一遍；
2. 立即产出全面计划；
3. 可选：用户要求时做 Critic 评审。

### Consensus 模式（--consensus / "ralplan"）

完整流程见 ralplan 技能（本包的 ralplan = plan --consensus 的别名，含逐步子代理协议与交接契约）。要点：

1. Planner（roles/planner.md）产出初始计划 + 紧凑 RALPLAN-DR 摘要（Principles 3-5 条、Decision Drivers 前 3、Viable Options >= 2 或显式否决理由；deliberate 模式另加 3 场景 pre-mortem 与 单元/集成/e2e/可观测 扩展测试计划）。
2. --interactive 时用 ask_user_question 呈现草稿 + 摘要，选项：Proceed to review / Request changes / Skip review；非交互则自动进入评审。
3. Architect（roles/architect.md 子代理）评审架构合理性：必须给钢人反方论、至少一个真实权衡张力、可能的综合路径。**等它完成再进入第 4 步，绝不并行**。
4. Critic（roles/critic.md 子代理）按质量标准评审：原则-选项一致性、备选探索公平性、风险缓解清晰度、验收可测性、验证步骤具体性。**只允许在第 3 步完成后运行**。
5. 重审循环（最多 5 次）：Critic 非 OKAY → 收集 Architect+Critic 反馈 → Planner 修订 → 回到 Architect → 回到 Critic，直到 OKAY 或到 5 次上限（上限时把最好版本交给用户）。
6. 合并评审通过后的所有改进建议进计划文件；最终共识输出必须含 **ADR** 段（Decision / Drivers / Alternatives considered / Why chosen / Consequences / Follow-ups）。
7. --interactive 时用 ask_user_question 呈交最终计划：批准进入执行 / 请求修改 / 拒绝。非交互则输出最终计划并停止，**绝不自动执行**。

### Review 模式（--review）

1. 评审者不得是起草者：写这份计划的上下文不能是批准它的上下文。
2. 读 .omx/plans/ 下的计划文件。
3. 用 critic 子代理评估。
4. 清理/重构类计划额外核实：清理计划、回归测试或显式测试缺口、逐气味分遍、质量闸。
5. 结论：OKAY / REVISE（附具体反馈）/ REJECT（需重规划）。

### 计划输出格式

- Requirements Summary、可测 Acceptance Criteria、Implementation Steps（带文件引用，步数匹配范围）、Risks and Mitigations、Verification Steps。
- 共识模式另加：RALPLAN-DR 摘要、ADR、DSH 执行交接指引（subagent 名册 / workflow 并行方案 / ralph 工具回退 / goal 工具承接）。
- deliberate 共识模式另加：Pre-mortem（3 场景）+ 扩展测试计划。

计划存 `.omx/plans/`，草稿存 `.omx/drafts/`。

## 设计选项呈现（访谈时）

分块呈现，一次一个选项，等用户反应后再给下一个，最后才给推荐：

```
### Option A: [名称]
**Approach:** [一句话]
**Pros:** [要点]
**Cons:** [要点]

你对这个方案怎么看？
```

## 问题分类（问之前先归类）

| 类型 | 例子 | 动作 |
|------|------|------|
| 代码事实 | "用了什么模式？""X 在哪？" | 自查，不问用户 |
| 用户偏好 | "优先级？""时间线？" | ask_user_question |
| 范围决策 | "包含 Y 吗？" | 问用户 |
| 需求约束 | "性能要求？" | 问用户 |

## 评审质量标准

| 标准 | 门槛 |
|------|------|
| Clarity | 80%+ 论断引用 file/line |
| Testability | 90%+ 标准具体 |
| Verification | 文件引用全部存在 |
| Specificity | 无「快」类无度量词汇 |

## 升级与停止条件

- 需求清楚到可以规划时停止访谈——不要过度访谈。
- 共识模式 5 次循环后把最好版本交给用户。
- 用户说"just do it / skip planning"→ 移交 goal 工具建目标或按用户明确指定的执行通道；规划角色绝不直接实现。
- 不可调和的取舍需要业务决策时上报用户。

## 最终清单

- [ ] 验收标准可测（90%+ 具体）
- [ ] 适用处引用了具体 file/line（80%+ 论断）
- [ ] 所有风险有缓解措施
- [ ] 无「fast」式无度量词汇（"fast" → "p99 < 200ms"）
- [ ] 计划保存到 .omx/plans/
- [ ] 共识模式：RALPLAN-DR 摘要含 3-5 原则、前 3 驱动、>=2 选项（或显式否决理由）
- [ ] 共识模式最终输出：ADR 段齐全
- [ ] deliberate 模式：pre-mortem + 扩展测试计划齐全
- [ ] --interactive：用户显式批准后才执行；非交互：Critic 通过后只输出计划，不自动执行
