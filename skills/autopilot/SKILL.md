---
name: autopilot
description: 严格自主交付循环：deep-interview → ralplan → ultragoal（goal 工具）→ code-review → ultraqa，闸不干净自动回环。用户说「autopilot / build me / 全自动 / handle it all」或要从具体想法一路交付到评审+QA 通过的代码时使用。
argument-hint: "<想法 / issue / PRD / 需求产物>"
---

# Autopilot（严格自主交付循环）

## 目的

非平凡工作的严格自主交付闭环，默认契约固定为：

    deep-interview → ralplan → ultragoal（goal 工具，必要时 team）→ code-review → ultraqa

code-review 或 ultraqa 不干净 → 带着发现回到 ralplan 重规划 → 再走 ultragoal → code-review → ultraqa，直到闸干净或出现硬阻塞。ralph 只是用户明确点名时的替代执行通道，不作为默认推荐。

## 何时使用 / 何时不用

使用：用户要从具体想法/issue/PRD/需求产物一路做到评审+QA 通过的代码；用户说 "autopilot" / "build me" / "autonomous" / "handle it all"；任务需要澄清、规划、持久执行、验证、评审与 QA，且闸不干净时自动跟进。

不用：只想探索/头脑风暴（plan / ralplan）；只要解释/草稿（正常对话回答）；单个聚焦改动（ultragoal 或直接 executor）；只审已有代码（code-review）。

## 严格循环契约（DSH 版）

各阶段用本插件对应技能执行（skill 工具按名加载：deep-interview / ralplan / ultragoal / code-review / ultraqa）；阶段产物与闸判定如下：

1. **deep-interview（需求澄清闸）**：澄清意图/范围/非目标/约束/决策边界；产出 .omx/specs/deep-interview-{slug}.md（含访谈完成理由）。不清不往下走。
2. **ralplan（共识规划闸）**：基于深访产物做预上下文摄取与共识规划；产出 .omx/plans/ 的 prd-*.md + test-spec-*.md + 持久化交接记录。**只有文件 ≠ 共识达成**；Architect→Critic 顺序评审（subagent + roles/ 提示词）是生命周期证据，执行授权 = 用户显式批准（--interactive 时）或用户在 autopilot 启动时已授权全程（此时记录授权依据）。评审缺失/被阻/不通过就停在 ralplan，不进 ultragoal。
3. **ultragoal（持久实现+验证循环）**：只从已过闸的 ralplan 产物进入。用 DSH goal 工具建聚合目标（create_goal），.omx/ultragoal/ 台账（goals.json / ledger.jsonl）做检查点；实现、测试、构建/lint/typecheck 证据、清理与最终评审闸纪律都归它。故事明显受益于并行时才在故事内用 team（workflow 工具），leader 持有目标与台账。
4. **code-review（合入就绪闸）**：对 ultragoal 产出的 diff/产物跑 code-review 技能（code-reviewer 子代理）。干净 = 推荐 APPROVE 且架构状态 CLEAR。不干净且是修复型问题 → 进入 rework（只修评审发现，修完重跑 code-review）；不干净且暴露计划/需求错误 → 回 ralplan（带 return_to_ralplan_reason 与发现）。
5. **ultraqa（对抗 QA 闸）**：干净评审后，面向用户行为/CLI/集成面/回归风险跑 ultraqa 技能。纯文档/平凡非运行时改动可显式跳过（记录条件与证据）。发现问题 → 存 QA 结论 → 回 ralplan。

唯一正常终态：干净 code-review + 通过或显式跳过的 ultraqa 之后的 complete。取消/凭证阻塞/不可恢复的反复失败/用户显式停止可提前终止（保留状态可续）。

## 预上下文摄取

进入任何阶段前：

1. 提取任务 slug；复用或新建 .omx/context/{slug}-{timestamp}.md（激活提示词/期望结果/已知事实/约束/未知项/可能触点，并注明种子是本次激活提示词而非此前对话的保证）；
2. 棕色地带事实缺失先自查（grep/glob/read），可用 deep-interview --quick 做有界低歧义摄取；听起来可行动 ≠ 跳过澄清闸；
3. 快照路径带进所有阶段状态与交接产物。

## 执行策略

- 阶段顺序固定：deep-interview → ralplan → ultragoal → code-review → ultraqa；team 只在 ultragoal 故事内条件性使用。
- 模糊/自由输入绝不直接跳到实现。
- 每个阶段切换前必须写状态。
- 安全可逆的阶段过渡自动继续；只问破坏性/凭证门控/实质偏好依赖的分支。
- 用户显式点名 Ralph 通道时保留 ralph 作为有意的替代执行阶段，不作为默认。

## 状态管理（文件约定）

状态文件 .omx/state/{scope}/autopilot-state.json：

- mode:"autopilot"、active、current_phase（deep-interview/ralplan/ultragoal/rework/code-review/ultraqa/complete/failed）、iteration、review_cycle、phase_cycle、handoff_artifacts{context_snapshot_path, deep_interview, ralplan, ralplan_consensus_gate{architect_review, critic_review, complete, authorized_by}, ultragoal, code_review, ultraqa}、review_verdict、qa_verdict、return_to_ralplan_reason。
- 每个阶段开始/结束时写一次；交接产物路径必须真实存在。
- review_verdict / qa_verdict 只能来自真实子代理/技能运行的持久证据，leader 自己的小结不算闸证据。

## 继续与恢复

用户说 continue / resume / keep going 时读状态文件，从 current_phase 继续：rework 只做评审发现的修复并回 code-review；ralplan 带 return_to_ralplan_reason 更新规划；complete 报告完成证据不再重启。**继续时绝不丢弃交接产物、绝不重启发现。**

## 升级与停止条件

- 缺凭证/权限 → 停并报告阻塞；
- 同一评审/QA 失败跨 3 个评审周期复发且无新计划 → 停并报告；
- 用户说停止/取消 → 保留状态停；
- 否则循环直到 code-review 干净且 ultraqa 通过/显式跳过（带证据）。

## 最终清单

- [ ] deep-interview 产出/更新了澄清需求或规格
- [ ] ralplan 产出/更新了规划产物，Architect→Critic 顺序评审证据齐，consensus_gate 状态明确（执行授权有依据）
- [ ] ultragoal 用新鲜证据实现并验证，台账/检查点引用持久
- [ ] rework 只用于实现型修复并回到新一轮 code-review
- [ ] team 只在 ultragoal 故事需要并行时使用（或显式记录不需要）
- [ ] code-review 干净（APPROVE + CLEAR）
- [ ] ultraqa 通过或按证据显式跳过
- [ ] review_verdict / qa_verdict 引用真实子代理/技能运行的持久证据
- [ ] 测试/构建/lint/typecheck 证据在交接产物中
- [ ] 状态标记 complete（或取消状态连贯保留）
- [ ] 给用户的最终摘要覆盖澄清、计划、实现、验证、评审与 QA 证据
