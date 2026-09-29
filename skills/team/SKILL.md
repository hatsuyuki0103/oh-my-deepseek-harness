---
name: team
description: 协调多路并行执行：官方 Agent Teams（`spawn_teammate` + `team_task_*` 任务板）为首选通道，`workflow`/`subagent`/会话内串行为降级阶梯；leader 持有目标与任务板台账。任务多路、可并行拆分、需要协调交付时使用。
argument-hint: "[N] <任务描述>"
---

# Team（协调并行团队）

> 可选能力：本技能引用的可选工具（DSH 原生 `ralph` 工具、官方团队九工具、`workflow`、`subagent`/`subagent_fork`）可能在当前 profile 未挂载或被预设停用；探测方式与四级降级阶梯见本包根目录 `docs/capability-matrix.md`（技能目录上两级：`../../docs/capability-matrix.md`）。

## 定位

DSH 版 team = **官方 Agent Teams 团队原生化**：leader 负责拆路、派活、整合、终验；teammate 负责执行切片、报证据；任务态由团队任务板承载，不再依赖任何外部任务文件。

- **显式委派才建队**：只有 leader 明确用 `spawn_teammate` 才创建 teammate；一次性 `subagent` 不是团队成员，也不进 `list_agents` 名册。
- **团队九工具就是执行面**：`spawn_teammate`（组队）、`send_message`（点对点消息）、`list_agents`（名册快照）、`wait_agent`（等状态/邮箱/任务板变化）、`interrupt_agent`（打断当前轮次）、`team_task_create`（建任务）、`team_task_list`（列任务）、`team_task_get`（读任务）、`team_task_update`（改任务 + CAS）。
- **任务板是唯一任务台账**：`.omx/state/team/{team}/**` 若存在（含旧 `tasks.json` / `inbox.md`）是外部 runner 或旧流程的遗留，omdsh **只读留档、永不写入**。

## Team vs 直接并行

- 任务少、有界、一个 leader 能直接等结果 → 直接多 `subagent` 后台并行（用 ultrawork 纪律）。
- 任务图有依赖、共享文件、跨边界所有权、需要交接/合并、需要持久的任务状态与验证通道 → 用 team（官方团队九工具；未挂载时按下一节降级）。
- 需要常驻 worker（跨轮次收 `send_message`）、共享任务板、`write_scopes` 边界 → 只有 team 原生通道提供；`workflow` 脚本无法跨轮次接收消息。

## 通道选择：团队优先，四级降级

按名册实况逐级下降，先命中即用，不得越级；降级理由写进终验证据。

1. **第 1 级 · 官方团队九工具（首选）**：名册含 `spawn_teammate` / `team_task_create` / `send_message` / `wait_agent` 时 → 走团队原生流程：`spawn_teammate` 组队、`team_task_create` 派任务、`wait_agent` 收证据。
2. **第 2 级 · `workflow` 工具**：官方团队九工具未挂载或被预设停用时 → 用 `workflow` 脚本扇出（parallel/pipeline 阶段编排）。
3. **第 3 级 · `subagent` / `subagent_fork`**：`workflow` 也不可用时 → 直接一对多派一次性子代理，leader 自己串起各阶段。
4. **第 4 级 · 会话内串行**：以上通道都不可用时 → leader 在会话内串行执行，并在正文显式声明「本次落在第 4 级」与原因。

判定依据是**可用性实况**（名册/探测结果），不是任务规模；能建队就必须建队。

### 兜底细则：`workflow` 判定（第 2 级内部）

- 独立切片多、每片是一个 subagent prompt 时：写 workflow 脚本，用 parallel/pipeline 编排阶段（如 实现阶段 → 验证阶段），每阶段声明 phase；
- 需要多阶段流水线且阶段间无屏障时优先 pipeline；阶段需要全体结果汇合才用 parallel；
- 脚本只能协调，文件/网络/实现全由子代理做；任何被误用的钩子都会响亮报错杀死脚本。

## 评审通道（按名册实况）

按 `COND_REVIEW` 阶梯判定（只看**当前名册实况**，不看会话阶段）：

- 名册含 `spawn_teammate` → **团队双通道**：两名 teammate 各担一通道，`wait_agent` 收证据；
- 否则名册含 `subagent` → **子代理双通道**；
- 两者皆无 → 报告 `independent review unavailable`，不批准。

`spawn_teammate` **仅 Lead 可用**：teammate 不能组队、不能再派生 teammate；需要并行时先请 Lead 建队，再由 Lead 派活。

## 启动前（预上下文摄取闸）

1. 提取任务 slug；建/复用 .omx/context/{slug}-{timestamp}.md（任务陈述/期望结果/已知事实/约束/未知项/可能触点）；
2. 歧义仍高 → 先自查棕色地带事实，再 deep-interview --quick 收口；
3. 外部事实依赖 → web_search 证据通道并行/先行；
4. 摄取闸完成前不拆路不派活；紧急推进显式记录风险。

## 拆路协议（Team Big Five，轻量边界清单）

- **单一事实源**：团队任务板（`team_task_create`/`team_task_list`/`team_task_get`/`team_task_update`）是唯一任务台账，`team_task_update` 以 `expected_revision` 做 CAS；旧 `.omx/state/team/{team}/tasks.json` + `inbox.md` 仅审计留档、只读，禁止写入；
- **闭环交接**：交接必须 ACK 回读——用 `send_message` 明确范围、受影响文件、owner、下一步；
- **边界互相监控**：完成前核对上下游契约、共享文件、验证证据；
- **备份/重派**：被阻 worker 报告最小求助/重派请求，并继续安全未阻塞的切片；
- **适应检查点**：假设/依赖/验证结果变化时，先给 leader 简短更新再扩范围；
- **团队导向**：worker 为整体结果优化，报告集成风险、缺失测试与对同侪的影响。

## 拆路规则

- 路之间无共享文件、无依赖才算独立；共享文件/前置依赖 → 串行或分阶段（staged lanes）；
- 每路必须带：验收标准（pass/fail 可测）+ 证据命令（证明完成）+ 预期 owner（创建任务时不传，由 `claim` 落定）；
- **M6 边界语义**：派活时用 `team_task_update(action:'edit', write_scopes:[...])` 登记写入范围；`writeScopes` 只警告不锁不授权——**共享 cwd、无文件锁、只写自己范围**，冲突靠 leader 串行化；
- **claim 取 owner**：teammate 领活前先 `team_task_get` 拿最新 `expected_revision`，再 `team_task_update(action:'claim')`；完成后 `team_task_update(action:'complete')`；
- worker prompt = 角色文本全文 + 任务切片 + 验收标准 + 上下文快照路径（`spawn_teammate` **没有 role/persona 参数**，角色必须写进 prompt 正文）；验证路由 roles/verifier.md；
- **保留一条验证通道**：专人（或最后阶段）对测试、回归覆盖与证据把关，关闭前必须交出验证证据；
- 简单独立扇出保持轻协议；有依赖/共享面/交接/合并/被阻路时启用 Big Five 清单。

## 派活模板与等待纪律

`spawn_teammate` 初始任务模板（角色文本随 prompt 走）：

```text
你是 <角色名>（内联角色纪律全文）。先用 `skill` 加载 <技能名>，再按该技能流程执行。
任务：<lane 目标>；验收标准：<pass/fail 可测>；证据命令：<命令>；
写入范围：<write_scopes，只写这些；共享文件串行>；上下文快照：<路径>。
完成后 send_message 给 lead：status / 文件 / 证据命令与原始输出 / blockers。
```

- **`queued` 不重发**：`send_message` 返回 queued 只表示已持久投递，不要重发同一条消息；
- **`inactive` ≠ 完成**：名册里的 `inactive` 只表示当前没有轮次在执行，不代表成功、失败或已交付；
- **醒来重列**：`wait_agent` 返回后先 `list_agents` + `team_task_list` 再决定下一步；`wait_agent` 只观测调用之后的变更，不会唤醒任何人；
- **就绪不唤醒 owner**：任务依赖就绪不会自动启动 owner，必须 `send_message` 显式叫醒；
- **后台 job 收口**：不再需要的后台 job 用 `job_kill` 停掉，不重复跑同一份工作。

## 技能→teammate 调度矩阵（摘要）

完整 26 行表在 [`references/skill-dispatch.md`](references/skill-dispatch.md)，与本表同源（改一处必须同步另一处）。

| 技能 | 建议角色 | 并行性 | 写入范围策略 | 证据要求 |
|---|---|---|---|---|
| `ai-slop-cleaner` | executor+verifier | staged | 每 lane 独占文件 | `node --test` + 清理前后 diff |
| `aliyun-media` | executor | serial | `skills/aliyun-media/**` | CLI dry-run（零付费） |
| `analyze` | analyst | fan-out | 只读 | file:line 清单 |
| `autopilot` | planner+executor+verifier | staged | 阶段独占、lead 汇总 | 各阶段闸输出 |
| `build-fix` | executor | serial | 受影响模块独占 | 复现命令 + 修复后同命令 |
| `cancel` | lead | lead-only | 状态文件独占 | 终态文件 + `job_list` |
| `code-review` | code-reviewer+architect | fan-out(2 独立) | 只读 | 双通道结论（APPROVE/CLEAR） |
| `deep-interview` | analyst+lead | serial | `.omx/interviews` / `.omx/specs` | 访谈产物 + 歧义评分 |
| `design` | executor+verifier | staged | `DESIGN.md` 独占 | 设计证据清单 |
| `doctor` | verifier | serial | 只读 | 探测输出摘要 |
| `ecomode` | lead | lead-only | 无写入 | 委派计数对比 |
| `git-master` | executor | serial | git 操作单写者 | `git log/show` 回执 |
| `note` | lead | lead-only | `.omx/notepad.md` 独占 | 追加条目 |
| `plan` | planner(+architect+critic) | staged(强制串行评审) | `.omx/plans` | PRD/test-spec |
| `prometheus-strict` | analyst(Metis)+momus+oracle | staged | `.omx/plans/prometheus-strict` | 三声部产物 |
| `ralph` | executor+architect | staged | 每轮独占切片 | 轮次报告 + 复核签字 |
| `ralplan` | planner→architect→critic | staged(强制串行) | `.omx/{plans,specs,context}` | PRD+test-spec+handoff |
| `security-review` | verifier+architect | fan-out | 只读 | 分级发现清单 |
| `skill-authoring` | executor+test-engineer | staged | `skills/<name>/**` 独占（**本轮禁止新增目录**） | 契约测试红→绿 |
| `tdd` | test-engineer+executor | staged | 测试/实现文件分 lane | 红→绿输出 |
| `team` | lead+verifier | fan-out/staged | 每 teammate 独占文件集 | `team_task_list`+`list_agents` 见证 |
| `tencent-media` | executor | serial | `skills/tencent-media/**` | CLI dry-run（零付费） |
| `ultragoal` | lead(目标所有人)+executor lanes | staged | worker 不碰 `.omx/ultragoal` | `ledger.jsonl` + `get_goal` 快照 |
| `ultraqa` | executor+architect | staged 循环 | 每轮独占修复切片 | 场景矩阵 + 退出码 |
| `ultrawork` | executor lanes | fan-out | 每 lane 独占文件 | 验收命令输出 |
| `visual-ralph` | executor+verifier(视觉判分) | staged | 前端文件独占 | `read_image` 判分 JSON |

派活时按行取四项（建议角色 / 并行性 / 写入范围策略 / 证据要求），角色文本内联进 `spawn_teammate` prompt。

## 共享命名空间（M4）

- `.omx/state/team/**` 是与外部 runner **共用**的共享命名空间，已知布局：`manifest.v2.json`（名册/版本）、`dispatch/`（投递）、`workers/`（worker 现场）；
- omdsh 只写自有文件（`.omx/context/**`、终验证据等），**不写不删**外部 runner 布局；需要读取时只做只读探测并标注来源；
- 外部 runner 的现网状态不构成任务态：任务态只认团队任务板。

## 与 Ultragoal 桥接

- 长期目标台账归 ultragoal（goal 工具 + .omx/ultragoal/）；team 只做并行执行、交证据。
- 三层分工：goal 工具 = 目标状态、团队任务板 = 执行任务、`.omx/ultragoal/**` = 审计证据，三层不互相替代。
- worker 不碰目标状态、不建台账、不 checkpoint；leader 用 team 终验证据 + 新鲜 get_goal 快照做 checkpoint 与最终 update_goal。
- team 不自动从 ultragoal 启动；两者叠加只在 leader 显式决策时发生。
- 收口见证：以 `team_task_list`（任务态）与 `list_agents`（名册实况）为准。

## 生命周期

1. **组队**：命名 team，建队即 `team_task_create` 建任务板；`.omx/state/team/{team}/` 若存在（外部 runner 或旧流程遗留，含旧 `tasks.json` / `inbox.md`）**只读留档、不写不删**；
2. **拆路**：按上节拆成 lane 列表，用 `team_task_create` 写入任务板——参数只有 `subject` / `description`（内含验收标准、证据命令、依赖）/ `blocked_by` / `write_scopes`，**建出来是 unowned pending**，owner 不在创建参数里；**禁止写 `tasks.json`**；
3. **派活**：`spawn_teammate` 建 teammate（角色文本进 prompt；`spawn_teammate` 仅 Lead 可用）；执行者 `team_task_get` 取 `expected_revision` 后 `team_task_update(action:'claim')` 才成为 owner；就绪后 `send_message` 唤醒 owner；
4. **编排**：`team_task_list` 观察任务态，`wait_agent` 等状态/邮箱/任务板变化，`list_agents` 核名册；后台任务（构建/测试）用 job 工具，不再需要时 `job_kill`；
5. **汇总**：收集各 lane 证据 → verifier 通道复核 → 合并；
6. **终验**：完整验证证据（测试/构建/清单）→ 交接 ultragoal checkpoint 或用户；
7. **清场**：任务板为唯一任务态；`.omx/**` 任务文件（含旧 `tasks.json` / `inbox.md`）仅审计留档、只读、不删。

## 升级与停止

- **停轮次 vs 停 job**：停 teammate 当前轮次用 `interrupt_agent`（仅 Lead，保留其待处理邮箱）；停后台 job 用 `job_kill`（两者不可互换）；
- **就绪不唤醒 owner**：任务依赖就绪不会自动启动 owner，须 `send_message`；`wait_agent` 只观测变更，不唤醒任何成员；
- **`inactive` ≠ 完成**：名册 `inactive` 只表示当前无轮次执行，不表示任务结果；
- 缺凭证/权限 → 停并报告（不得带伤推进，原有停止条件保留）；
- 名册无团队九工具（或需常驻 worker 而预设停用了团队面）→ 按「通道选择」降级并报告净损失；
- 单 lane 反复失败 3 次 → 报告并请求重派/缩小切片；
- 用户停止/取消 → 保留任务板与审计文件停（不删任务）；
- 不可调和的路间冲突 → 上报用户决策。

## 最终清单

- [ ] 预上下文快照存在
- [ ] 任务板每任务有验收标准 + 证据命令 + owner（owner 由 `claim` 落定、非创建参数；`team_task_list` 见证）
- [ ] `write_scopes` 已登记；独立路才并行，共享文件路串行或分阶段
- [ ] 交接有 ACK 回读记录（`send_message`）
- [ ] 验证通道独立且关闭前交出证据
- [ ] 各 lane 证据汇总并经 verifier 复核
- [ ] 与 ultragoal 叠加时：worker 未碰目标状态，checkpoint 由 leader 用新鲜 get_goal 快照完成
- [ ] 终验证据完整；任务板为唯一任务态，`.omx/**` 任务文件（含旧 `tasks.json`）仅审计留档、只读、不删
