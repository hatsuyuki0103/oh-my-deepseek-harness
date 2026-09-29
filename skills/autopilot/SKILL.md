---
name: autopilot
description: 严格自主交付循环：deep-interview → ralplan → ultragoal（默认组队，Agent Teams 优先）→ code-review → ultraqa，闸不干净自动回环。用户说「autopilot / build me / 全自动 / handle it all」或要从具体想法一路交付到评审+QA 通过的代码时使用。
argument-hint: "<想法 / issue / PRD / 需求产物>"
---

# Autopilot（严格自主交付循环）

> 可选能力：本技能引用的可选工具（DSH 原生 `ralph` 工具、官方团队九工具、`workflow`、`subagent`/`subagent_fork`）可能在当前 profile 未挂载或被预设停用；探测方式与四级降级阶梯见本包根目录 `docs/capability-matrix.md`（技能目录上两级：`../../docs/capability-matrix.md`）。

## 目的

非平凡工作的严格自主交付闭环，默认契约固定为：

    deep-interview → ralplan → ultragoal（goal 工具 + 默认组队）→ code-review → ultraqa

code-review 或 ultraqa 不干净 → 带着发现回到 ralplan 重规划 → 再走 ultragoal → code-review → ultraqa，直到闸干净或出现硬阻塞。ralph 只是用户明确点名时的替代执行通道，不作为默认推荐。

## 何时使用 / 何时不用

使用：用户要从具体想法/issue/PRD/需求产物一路做到评审+QA 通过的代码；用户说 "autopilot" / "build me" / "autonomous" / "handle it all"；任务需要澄清、规划、持久执行、验证、评审与 QA，且闸不干净时自动跟进。

不用：只想探索/头脑风暴（plan / ralplan）；只要解释/草稿（正常对话回答）；单个聚焦改动（ultragoal 或直接 executor）；只审已有代码（code-review）。

## 严格循环契约（DSH 版）

各阶段用本插件对应技能执行（skill 工具按名加载：deep-interview / ralplan / ultragoal / code-review / ultraqa）；阶段产物与闸判定如下：

1. **deep-interview（需求澄清闸）**：澄清意图/范围/非目标/约束/决策边界；产出 .omx/specs/deep-interview-{slug}.md（含访谈完成理由）。不清不往下走。
2. **ralplan（共识规划闸）**：基于深访产物做预上下文摄取与共识规划；产出 .omx/plans/ 的 prd-*.md + test-spec-*.md + 持久化交接记录。**只有文件 ≠ 共识达成**；Architect→Critic 顺序评审（执行者：teammate（团队面可用）→ 子代理（降级），配 roles/ 提示词）是生命周期证据，执行授权 = 用户显式批准（--interactive 时）或用户在 autopilot 启动时已授权全程（此时记录授权依据）。评审缺失/被阻/不通过就停在 ralplan，不进 ultragoal。
3. **ultragoal（持久实现+验证循环）**：只从已过闸的 ralplan 产物进入。用 DSH goal 工具建聚合目标（create_goal），.omx/ultragoal/ 台账（goals.json / ledger.jsonl）做检查点；实现、测试、构建/lint/typecheck 证据、清理与最终评审闸纪律都归它。进入后**默认组队**（官方团队九工具 + 共享任务板；团队面未挂载时退 `workflow` 扇出作为降级层，细则见「团队协作默认策略」），leader 持有目标与台账。
4. **code-review（合入就绪闸）**：对 ultragoal 产出的 diff/产物跑 code-review 技能（code-reviewer：teammate（团队面可用）→ 子代理（降级））。干净 = 推荐 APPROVE 且架构状态 CLEAR。不干净且是修复型问题 → 进入 rework（只修评审发现，修完重跑 code-review）；不干净且暴露计划/需求错误 → 回 ralplan（带 return_to_ralplan_reason 与发现）。
5. **ultraqa（对抗 QA 闸）**：干净评审后，面向用户行为/CLI/集成面/回归风险跑 ultraqa 技能。纯文档/平凡非运行时改动可显式跳过（记录条件与证据）。发现问题 → 存 QA 结论 → 回 ralplan。

唯一正常终态：干净 code-review + 通过或显式跳过的 ultraqa 之后的 complete。取消/凭证阻塞/不可恢复的反复失败/用户显式停止可提前终止（保留状态可续）。

## 预上下文摄取

进入任何阶段前：

1. 提取任务 slug；复用或新建 .omx/context/{slug}-{timestamp}.md（激活提示词/期望结果/已知事实/约束/未知项/可能触点，并注明种子是本次激活提示词而非此前对话的保证）；
2. 棕色地带事实缺失先自查（grep/glob/read），可用 deep-interview --quick 做有界低歧义摄取；听起来可行动 ≠ 跳过澄清闸；
3. 快照路径带进所有阶段状态与交接产物。

## 执行策略

- 阶段顺序固定：deep-interview → ralplan → ultragoal → code-review → ultraqa；ultragoal 阶段**默认组队**（见「团队协作默认策略」），仅团队面不可用或故事确实不可并行才降级并记录理由。
- 模糊/自由输入绝不直接跳到实现。
- 每个阶段切换前必须写状态。
- 安全可逆的阶段过渡自动继续；只问破坏性/凭证门控/实质偏好依赖的分支。
- 用户显式点名 Ralph 通道时保留 ralph 作为有意的替代执行阶段，不作为默认。

## 团队协作默认策略（Agent Teams 优先）

1. **触发（默认开）**：进入 ultragoal 前做名册自检；名册含 `spawn_teammate` + `wait_agent` + `team_task_create`/`team_task_list`（`team_task_*`）→ **默认组队**；仅当「故事确实不可并行（单文件/单命令）」或「团队面未挂载」才不组队，且必须显式记录理由。
2. **Lead-only 限定**：`spawn_teammate` 与 `interrupt_agent` 仅 **Lead 可调用**；teammate 名册同样注册九工具，但调用期受 `TEAM_LEAD_REQUIRED` 限制 → 技能文本不得让 teammate 去「自己组队」。
3. **编制（= 1 名 Lead + 至多 `maxMembers` 名 teammate）**：Lead + 每条可并行写入范围 1 名 teammate；live 生效值 = **8**（含既有非活跃成员也占位；`dsh-experimental-agent-team-profile/cordis.patch.yml` 覆盖 `agent-team.maxMembers`；插件默认 16，实测第 9 名 teammate 创建被拒）；每条 workstream 先用 `team_task_create({subject, description, write_scopes, blocked_by})` 建**无主 pending** 任务 → owner 由 `team_task_update(action:'claim', expected_revision)` 取得 → `action:'edit'` 登记/调整 write_scopes → 完成后 `action:'complete'`；任务就绪不会唤醒 owner，需 `send_message` 唤醒；teammate 初始 `prompt` 必含「先用 `skill` 加载 <技能名>」+ 写入范围 + 验收证据命令 + 四段报告格式；**评审/QA 双通道复用两名现有 teammate**，不新增槽位。
4. **协作纪律**：共享 cwd 无文件锁 → 范围互斥、先读后写；`team_task_get` → `claim`（CAS `expected_revision`）→ `complete`；`send_message` 的 `queued` **绝不重发**；`wait_agent` 从不唤醒 → `noProgress` 先 `send_message`；`inactive` ≠ 完成；Lead 必须等齐必需 teammate 才能给最终答案。
5. **评审/QA 通道**：ralplan 的 Architect/Critic、code-review 双通道、ultraqa **优先由 teammate 承担**（`spawn_teammate` + `wait_agent` 收证据）；按 `COND_REVIEW` 三档降级（无团队面 → `subagent` → 报告 `independent review unavailable`）。
6. **降级阶梯**：官方团队九工具 → `workflow` → `subagent`/`subagent_fork` → 会话内串行；先命中即用、不得越级；探测方式与阶梯定义见 `docs/capability-matrix.md`。

## 状态管理（文件约定）

状态文件 .omx/state/{scope}/autopilot-state.json：

- mode:"autopilot"、active、current_phase（deep-interview/ralplan/ultragoal/rework/code-review/ultraqa/complete/failed）、iteration、review_cycle、phase_cycle、handoff_artifacts{context_snapshot_path, deep_interview, ralplan, ralplan_consensus_gate{architect_review, critic_review, complete, authorized_by}, ultragoal, code_review, ultraqa}、review_verdict、qa_verdict、return_to_ralplan_reason。
- 每个阶段开始/结束时写一次；交接产物路径必须真实存在。
- review_verdict / qa_verdict 只能来自真实 teammate（团队面可用）→ 子代理（降级）/技能运行的持久证据，leader 自己的小结不算闸证据。

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
- [ ] ultragoal 阶段已按默认组队建队（或显式记录不组队理由：单文件/单命令 或 团队面未挂载）
- [ ] code-review 干净（APPROVE + CLEAR）
- [ ] ultraqa 通过或按证据显式跳过
- [ ] review_verdict / qa_verdict 引用真实 teammate（团队面可用）→ 子代理（降级）/技能运行的持久证据
- [ ] 测试/构建/lint/typecheck 证据在交接产物中
- [ ] 状态标记 complete（或取消状态连贯保留）
- [ ] 给用户的最终摘要覆盖澄清、计划、实现、验证、评审与 QA 证据
