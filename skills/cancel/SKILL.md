---
name: cancel
description: 停止活动工作流并清理状态：检测本插件各技能的活动状态（.omx/state/）、终止后台任务、暂停/结单 goal，保留进度可续跑。用户说「cancel / stop / 停一下 / 别跑了」时使用。
argument-hint: "[--force]"
---

# Cancel（停止与清理）

## 定位

DSH 版 cancel：安全停止本插件工作流（ralph / autopilot / team / ultrawork / ultragoal / ultraqa / ralplan 等）并做状态收尾。**停止 ≠ 删除**：产物（.omx/context、plans、specs、ultragoal 台账）全部保留，只把状态置为终态，保证可续跑。

## 检测

按优先级读 .omx/state/ 下的状态文件，判定哪个工作流活动：

- autopilot-state.json（current_phase 决定停在哪）
- ralph-progress.json
- ultrawork-state.json
- ultragoal 台账（ledger.jsonl 最后一条 + goal 工具活动目标）
- team/{name}/tasks.json（未完成 lane）
- ralplan 交接记录（consensus_gate.complete:false）

## 停止动作（按依赖顺序）

1. **goal 工具**：活动目标未完成且用户明确要停 → update_goal(action blocked, blocked_reason=用户取消)；只是暂停流程但目标仍要做 → update_goal(action pause)；
2. **后台任务**：job_list 列出本工作流相关的运行中 job → job_kill；
3. **动态插件**：本会话为验证起的临时插件（cordis_*）→ cordis_stop；
4. **状态终态化**（不是删除）：把活动状态文件写成终态——ralph: active:false + current_phase:"cancelled" + completed_at；autopilot: active:false + current_phase:"cancelled"（保留 handoff_artifacts 供续跑）；ultrawork: active:false；team: 在 inbox.md 写 shutdown 通知，tasks.json 保留；
5. **清理范围安全**：只碰当前工作流的状态文件；不删产物、不动无关会话状态。

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
- jobs killed: <id 列表>
- state finalized: <文件与终态>

Preserved for resume:
- <产物与可续跑说明>
```

## 最终清单

- [ ] 活动工作流已识别
- [ ] goal 按语义 pause/blocked（或确认无活动目标）
- [ ] 相关后台 job 已终止
- [ ] 状态文件终态化且未删除产物
- [ ] 未触碰无关范围
