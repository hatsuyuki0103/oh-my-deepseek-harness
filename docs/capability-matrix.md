# 可选能力与降级矩阵（capability matrix）

> 适用版本：`DSH 0.2.0-rc.1`（兼容清单同时保留 `0.1.0-rc.6`）。本文件是 `skills/*/SKILL.md` 与 `roles/*.md` 指针行引用的**唯一降级真源**：任何对「官方团队九工具 / `ralph` 工具 / `workflow` / `subagent`/`subagent_fork` / goal 工具 / 动态插件 API」的可用性声明，都必须按本矩阵给出条件，不得当作无条件可用（团队双通道 = `spawn_teammate` + `wait_agent` 收证据）。

## 1. 四级降级阶梯（团队优先）

1. **官方团队九工具**：`spawn_teammate` / `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` / `team_task_create` / `team_task_list` / `team_task_get` / `team_task_update` —— 首选；共享任务板是唯一任务台账。
2. `workflow`：团队面未挂载时用脚本扇出子代理（无任务板、无 `wait_agent` 收证据）。
3. `subagent` + `subagent_fork`：一次性子代理通道；团队双通道（`spawn_teammate` + `wait_agent` 收证据）不可用时的替代，只传 prompt 与回执。
4. 会话内串行：前三层全不可用时，主上下文自己做 + 后台任务 + 收口验证。

## 2. 能力矩阵

| 能力 | 探测方式 | 已挂载时 | 未挂载时降级 | 判别陷阱 |
|---|---|---|---|---|
| 团队九工具 | `cordis_inspect_query({platform:'host',provider:'Tool',method:'listTools'})` 比对九名；`Config.listConfigs` 看预设作用域 | 派活走 `spawn_teammate` + 共享任务板（`team_task_create` / `team_task_list` / `team_task_update`），收证据用 `wait_agent` | `workflow` 扇出；再不可用则会话内串行分批（见四级阶梯） | 工具出现 ≠ 团队成员：只有被判为团队成员才拿得到九工具；父级 preset revision 与技能目录才会继承 |
| 控制面身份判别（三控制面：`send_message` / `list_agents` / `interrupt_agent`） | 只按参数形态判（不看工具名）：团队面 = `send_message{target}` + `list_agents`（无参数）+ `interrupt_agent{target}`；旧全局面 = `send_message{agent_id}` + `list_agents{scope}` + `interrupt_agent{agent_id}` | 团队面：`send_message({target, message})` 投递给 teammate；`list_agents` 无参列出成员；`interrupt_agent({target})` 停当前轮次；`queued` 只是已持久化的排队回执 | 旧全局面按 `agent_id` / `scope` 操作；两者皆不可用时改走团队双通道（`spawn_teammate` + `wait_agent` 收证据）或 `subagent` 回执并标注 | 工具名相同、schema 不同：按参数判别，禁止按名字推断身份；`queued` 绝不重发；`inactive` 只表示当前没有 turn 在执行 |
| `ralph` 工具 | `cordis_inspect_query(...listTools)` 查名册是否含 `ralph` | 每轮开全新子代理 + 共享工作区作长期记忆 + 轮次间只传结构化报告 | 会话内 Ralph 纪律（todo 清单 + 后台任务 + 新鲜验证 + 独立复核）；本 profile 的 live preset 实测**未挂载**该工具 | 「技能正文提到 `ralph`」不等于「名册已挂载」；用户点名才用，缺省走会话内纪律 |
| `subagent` + `subagent_fork` | `cordis_inspect_query(...listTools)` 查 `subagent` / `subagent_fork`（预设可停用） | 一次性子代理通道（`subagent_fork` 继承父级上下文） | 「团队双通道」（`spawn_teammate` + `wait_agent` 收证据）/ `workflow` 扇出 | 一次性子代理看不到任务板（`team_task_list` 只对团队成员开放）；也扛不住持久多轮 |
| `workflow` | `cordis_inspect_query(...listTools)` 查 `workflow` | 脚本扇出多个子代理（`parallel` / `pipeline`），阶段间可加 barrier | 会话内串行分批执行，逐批留存证据 | 无任务板、无 `wait_agent`；不得用 `parallel` 冒充团队并行 |
| goal 三工具（`create_goal` / `get_goal` / `update_goal`） | `cordis_inspect_query(...listTools)` 查三实名 | goal 工具是唯一目标状态接口；故事与检查点落 `.omx/ultragoal/**` | 用 `.omx/**` 台账文件记录目标状态，并在报告中标注「非 goal 工具」 | 目标状态 ≠ 任务状态：任务态只经 `team_task_update`，不得绕过目标态 |
| `read_image` | `cordis_inspect_query(...listTools)` 查 `read_image` | 视觉判分由会话视觉模型 + `read_image` 完成 | 由用户提供参考图并人工确认（会话模型不支持图像输入时报告用户并转人工视觉确认） | 无 `read_image` 时不得假装已做视觉裁决 |
| 动态插件 API（`cordis_inspect_self` / `cordis_stop`） | 动态插件 API 用 `cordis_inspect_self` 列本会话插件；配置面用 `cordis_inspect_query` + `Config.listConfigs` | 按 inspect 输出核对残留与失败 Run，必要时 `cordis_stop` 收口 | 本会话动态插件 API 不可用时 → 以插件页状态替代并标注，否则跳过该步并报告 | 它本身就是本会话能力而非常驻工具；跳过必须显式标注，不得静默略过 |
| `subagent_codex` / `subagent_claude_code` | `cordis_inspect_query(...listTools)` 查两名（报告行） | 只登记已挂载状态，本包 0 处引用，不自动启用 | 无降级路径（无引用即无依赖）；报告「未挂载」即可，不阻断流程 | 未挂载不等于能力缺失；不得因报告项缺失而中止主流程 |
| 旧委派四行（`tool-subagent-control` / `tool-subagent-list-agents` / `tool-subagent` / `tool-subagent-fork`） | `dsh --profile web --dump-config` 看 `disabled: true` 落点（重启后生效） | 与团队面并存时优先团队双通道（`spawn_teammate` + `wait_agent` 收证据） | 预设停用旧四行后 → 团队双通道（`spawn_teammate` + `wait_agent` 收证据）/ `workflow` 扇出 | id 实值就是这四个（`tool-subagent-control/list-agents` 是包名，不是 id）；停用需重启才生效 |

## 3. 必读事实清单（判别陷阱）

- `wait_agent` 超时窗口为 10000–3600000 ms；`wait_agent` **不会唤醒** inactive 的 teammate，醒来后必须自己重新 `list_agents` + `team_task_list`。
- `inactive` 只表示「当前没有 turn 在执行」，**不等于**完成 / 失败 / 等待中。
- `queued` 是**已持久化**的投递回执，绝不重发（重发会产生重复投递）。
- `write_scopes` **只警告不锁定**（advisory）：同一文件绝不并发写，写前先读、遇 FS 冲突重新读再改。
- `team_task_update` 以 `expected_revision` 做 CAS；版本不符必须重新 `team_task_get` 再改。
- 团队名额上限 = `maxMembers`（live 生效值 **8**；**仅计 teammate**、Lead 不计入；插件默认 16，实测第 9 名 teammate 创建被拒；名额含既有非活跃成员也占位——不要指望靠等成员结束来腾位）；任务上限 `maxTasks: 256` 沿用假设 A1，schema 变更需复核本矩阵。
- 一次性子代理看不到任务板；**工具出现 ≠ 团队成员**。
- 本 profile 的 live preset 实测未挂载 `ralph` 工具，且团队九工具与旧全局委派面在重启前并存。

## 4. 身份判别规则（按参数形态，不看工具名）

| 名册实况 | `send_message` | `list_agents` | `interrupt_agent` | 判定 |
|---|---|---|---|---|
| 团队面（团队成员：Lead 或 teammate） | `target` | 无参数 | `target` | 可对 teammate 派活/收证据，团队任务板可见 |
| 旧全局面（非团队成员，如一次性子代理） | `agent_id` | `scope`（`children` / `descendants`） | `agent_id` | 看不到团队任务板，只有旧全局委派 |
| 两者皆无 | — | — | — | 无委派控制面，只剩 `workflow` / 会话内串行 |

- **成员资格**：注册面在每个成员作用域（Lead 与 teammate）都列出同样九个工具（teammate 名册同样含 `spawn_teammate`）；`spawn_teammate` 的 Lead-only 限制在**调用时**强制（`TEAM_LEAD_REQUIRED`），不是名册缺席——teammate 需先请 Lead 建队才能派活。身份只按上表三个控制面的**参数形态**判别，与工具名是否出现无关。
- 本会话实证（两面并存）：Lead 作用域 = 团队形态（`.omx/evidence/lead-roster-20260929.md` §1）；一次性子代理作用域 = 旧全局形态（`.omx/evidence/tool-roster-probe-20260929.md`）。
- 同名 scoped 注册会覆盖全局注册 → 只有实际列出的 schema 算数，禁止按工具名是否出现推断身份。

## 5. 评审双通道（重启前 / 重启后）

- **重启前（本会话）**：预设覆盖尚未生效，团队面与旧全局委派并存 → 评审优先团队双通道（两名 teammate 各担一通道，`wait_agent` 收证据）。
- **重启后**：旧委派四行被预设停用，`subagent` 面不再默认可用 → 默认走团队双通道（`spawn_teammate` 两名各担一通道，`wait_agent` 收证据）；仅当名册仍有 `subagent`（如其它 profile）时才退回子代理双通道；两者皆无 → 报告 `independent review unavailable`，**不批准**，不得降级为单通道自审。

## 6. 与预设停用的关系

- 宿主层停用（`inactive`）或预设作用域重挂载都会让工具从名册消失；两者都按本矩阵的「未挂载时降级」列处理。
- 预设覆盖是整份 `config` 覆盖：DSH 升级新增的预设行会被遮蔽 → 升级后必须复跑 `dsh --profile web --dump-config` 并同步覆盖层。