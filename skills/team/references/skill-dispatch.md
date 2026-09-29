# 技能 → teammate 调度矩阵（26/26 全表）

> `team` 技能的调度真源：`skills/team/SKILL.md` 的「技能→teammate 调度矩阵（摘要）」与本表**同源**，改一处必须同步另一处。
> 并行性取值：serial | fan-out | staged | lead-only（不新增第 5 种取值）。
> 写入范围策略里的路径是**登记用建议值**，不是锁；`writeScopes` 只警告不授权，共享 cwd 无文件锁。
> 可选能力（官方团队九工具 / `subagent` / `workflow` / `ralph` 工具）以名册实况为准，未挂载或被预设停用时的降级阶梯与探测规则见 `docs/capability-matrix.md`。

## 全表（26 行 = `skills/` 目录集合）

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

## 怎么用这张表

1. **取行**：按 lane 所属技能取「建议角色 / 并行性 / 写入范围策略 / 证据要求」四项；
2. **拆 lane**：`fan-out` 的 lane 之间必须无共享文件；`serial` 单写者；`staged` 阶段间有屏障，前一阶段证据到手才进下一阶段；`lead-only` 不派活，由 lead 亲自做；
3. **登记**：`team_task_create` 建任务，参数只有 `subject` / `description`（内含验收标准、证据命令、依赖）/ `blocked_by` / `write_scopes`——**建出来是 unowned pending**，owner 不在创建参数里；写入范围变更用 `team_task_update(action:'edit', write_scopes:[...])` 登记；
4. **派活**：`spawn_teammate` 建 teammate（**仅 Lead 可用**），角色文本**内联进 prompt**（`spawn_teammate` 没有 role/persona 参数）；执行者 `team_task_get` 取 `expected_revision` 后 `team_task_update(action:'claim')` 才成为 owner。

### `spawn_teammate` 初始任务模板

```text
你是 <角色名>（内联角色纪律全文）。先用 `skill` 加载 <技能名>，再按该技能流程执行。
任务：<lane 目标>；验收标准：<pass/fail 可测>；证据命令：<命令>；
写入范围：<write_scopes，只写这些；共享文件串行>；上下文快照：<路径>。
完成后 send_message 给 lead：status / 文件 / 证据命令与原始输出 / blockers。
```

## 两条硬纪律

- **共享文件必须串行**：任何两个 lane 的写入范围若有交集（同一文件、同一目录树、同一生成物），必须串行或分阶段，禁止并行写；`writeScopes` 重叠只是**警告**，不会加锁。
- **证据要求即验收**：每行「证据要求」列给出的是最低证据形态；没有原始命令输出（退出码 / pass-fail 计数 / diff）不算完成，禁止 `pass >= N` 之类放宽口径。
- **任务态只认任务板**：`team_task_create` / `team_task_list` / `team_task_update` 是唯一任务台账；`.omx/**` 下的旧任务文件（含旧 `tasks.json`、`inbox.md`）一律只读留档、只作审计，永不写入。
