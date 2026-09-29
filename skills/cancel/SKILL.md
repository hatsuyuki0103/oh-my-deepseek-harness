---
name: cancel
description: 停止活动工作流并清理状态：检测本插件各技能的活动状态（.omx/state/）、终止后台任务、暂停/结单 goal，保留进度可续跑。用户说「cancel / stop / 停一下 / 别跑了」时使用。
argument-hint: "[--force]"
---

# Cancel（停止与清理）

> 可选能力：本技能引用的可选工具（DSH 原生 `ralph` 工具、官方团队九工具、`workflow`、`subagent`/`subagent_fork`）可能在当前 profile 未挂载或被预设停用；探测方式与四级降级阶梯见本包根目录 `docs/capability-matrix.md`（技能目录上两级：`../../docs/capability-matrix.md`）。

## 定位

DSH 版 cancel：安全停止本插件工作流（ralph / autopilot / team / ultrawork / ultragoal / ultraqa / ralplan 等）并做状态收尾。**停止 ≠ 删除**：产物（.omx/context、plans、specs、ultragoal 台账）全部保留，只把状态置为终态，保证可续跑。

## 检测

按优先级读 .omx/state/ 下的状态文件，判定哪个工作流活动：

- autopilot-state.json（current_phase 决定停在哪）
- ralph-progress.json
- ultrawork-state.json
- ultragoal 台账（ledger.jsonl 最后一条 + goal 工具活动目标）
- 团队任务板（`team_task_list` 未完成项：pending / in_progress）+ 已知布局探测（`tasks.json` **或** `manifest.v2.json`，只读）
- ralplan 交接记录（consensus_gate.complete:false）

## 停止动作（按依赖顺序）

1. **goal 工具**：活动目标未完成且用户明确要停 → update_goal(action blocked, blocked_reason=用户取消)；只是暂停流程但目标仍要做 → update_goal(action pause)；
2. **teammate**：`list_agents` 找出仍在跑的 teammate → `interrupt_agent`（**仅 Lead 可调用**，只停该 teammate 当前轮次；**不删任务、不解散名册**，待办留在任务板上）；
3. **后台任务**：job_list 列出本工作流相关的运行中 job → job_kill；
4. **动态插件**：本会话为验证起的临时插件（cordis_*）→ cordis_stop；动态插件 API（`cordis_inspect_self`/`cordis_stop`）名册未挂载时以插件页状态替代并标注，否则跳过该步并报告；
5. **状态终态化**（不是删除）：把活动状态文件写成终态——ralph: active:false + current_phase:"cancelled" + completed_at；autopilot: active:false + current_phase:"cancelled"（保留 handoff_artifacts 供续跑）；ultrawork: active:false；团队：任务板只读收尾——对 in_progress 任务先 `team_task_get` 读出当前 `revision`（CAS 前置必读，版本可能已变），再调用 `team_task_update({task_id, expected_revision, action:'release'})` 释放 owner 并记录终态；遇 `TEAM_TASK_STALE_REVISION` 须重新 `team_task_get` 后重试一次，仍失败则在 Cancel Report 中记录（**不得静默跳过**）；**不删任务**；旧任务文件（`inbox.md`/`tasks.json`）仅审计留档、不写不删；**不写不删外部 runner 布局**（`.omx/state/team/**` 是外部 runner 与 omdsh 共用命名空间，布局含 `manifest.v2.json`/`dispatch/`/`workers/`）；
6. **清理范围安全**：只碰当前工作流的状态文件与任务板收尾动作；不删产物、不删任务、不动无关会话状态。

## 参数契约

- 无参数：停当前可证明活动的工作流；
- --force：同范围 + 对仍在跑的 job 强制终止；
- 不支持 --all（工作区级破坏性清理需要另行授权）；未知参数拒绝执行。

## 报告

```
## Cancel Report

Workflow: <检测到的工作流>
Actions:
- goal: <pause/blocked/无>
- teammates interrupted: <名字列表/无（interrupt_agent 仅 Lead）>
- jobs killed: <id 列表>
- task board: <team_task_list 见证 + 已 release 的任务 id/无>
- state finalized: <文件与终态>

Preserved for resume:
- <产物与可续跑说明；旧任务文件仅审计留档，任务板未删任务>
```

## 最终清单

- [ ] 活动工作流已识别（含任务板未完成项与已知布局）
- [ ] goal 按语义 pause/blocked（或确认无活动目标）
- [ ] 活动 teammate 已 `interrupt_agent`（Lead）且未删任何任务
- [ ] 相关后台 job 已终止
- [ ] 状态文件终态化且未删除产物；任务板 in_progress 已 `release` 收尾
- [ ] 未触碰无关范围；未写入/删除外部 runner 布局（`.omx/state/team/**`）
