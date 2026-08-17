---
name: team
description: 协调多路并行执行：以 workflow 工具编排分阶段并行子代理 + 共享任务清单，leader 持有目标与台账。任务多路、可并行拆分、需要协调交付时使用。
argument-hint: "[N] <任务描述>"
---

# Team（协调并行团队）

## 定位

DSH 版 team = **workflow 工具编排的分阶段并行子代理** + 共享任务清单文件。leader 负责：拆路、派活、整合、终验；worker（subagent 通道）负责：执行切片、报证据。没有 tmux、没有 worker 长生命周期——并行状态写在 .omx/state/team/{team}/ 文件里。

## Team vs 直接并行

- 任务少、有界、一个 leader 能直接等结果 → 直接多 subagent 后台并行（用 ultrawork 纪律）。
- 任务图有依赖、共享文件、跨边界所有权、需要交接/合并、需要持久的任务状态与验证通道 → 用 team（workflow 工具编排）。

## 什么时候用 workflow 工具

- 独立切片多、每片是一个 subagent prompt 时：写 workflow 脚本，用 parallel/pipeline 编排阶段（如 实现阶段 → 验证阶段），每阶段声明 phase；
- 需要多阶段流水线且阶段间无屏障时优先 pipeline；阶段需要全体结果汇合才用 parallel；
- 脚本只能协调，文件/网络/实现全由子代理做；任何被误用的钩子都会响亮报错杀死脚本。

## 启动前（预上下文摄取闸）

1. 提取任务 slug；建/复用 .omx/context/{slug}-{timestamp}.md（任务陈述/期望结果/已知事实/约束/未知项/可能触点）；
2. 歧义仍高 → 先自查棕色地带事实，再 deep-interview --quick 收口；
3. 外部事实依赖 → web_search 证据通道并行/先行；
4. 摄取闸完成前不拆路不派活；紧急推进显式记录风险。

## 拆路协议（Team Big Five，轻量边界清单）

- **单一事实源**：任务 JSON / 收件箱 / 批准交接 / leader 更新是规范来源（.omx/state/team/{team}/tasks.json + inbox.md）；
- **闭环交接**：交接必须 ACK 回读——明确范围、受影响文件、owner、下一步；
- **边界互相监控**：完成前核对上下游契约、共享文件、验证证据；
- **备份/重派**：被阻 worker 报告最小求助/重派请求，并继续安全未阻塞的切片；
- **适应检查点**：假设/依赖/验证结果变化时，先给 leader 简短更新再扩范围；
- **团队导向**：worker 为整体结果优化，报告集成风险、缺失测试与对同侪的影响。

## 拆路规则

- 路之间无共享文件、无依赖才算独立；共享文件/前置依赖 → 串行或分阶段（staged lanes）；
- 每路必须带：验收标准（pass/fail 可测）+ 证据命令（证明完成）+ owner；
- worker prompt = roles/executor.md（或对应角色）全文 + 任务切片 + 验收标准 + 上下文快照路径；验证路由 roles/verifier.md；
- **保留一条验证通道**：专人（或最后阶段）对测试、回归覆盖与证据把关，关闭前必须交出验证证据；
- 简单独立扇出保持轻协议；有依赖/共享面/交接/合并/被阻路时启用 Big Five 清单。

## 与 Ultragoal 桥接

- 长期目标台账归 ultragoal（goal 工具 + .omx/ultragoal/）；team 只做并行执行、交证据。
- worker 不碰目标状态、不建台账、不 checkpoint；leader 用 team 终验证据 + 新鲜 get_goal 快照做 checkpoint 与最终 update_goal。
- team 不自动从 ultragoal 启动；两者叠加只在 leader 显式决策时发生。

## 生命周期

1. **组队**：命名 team（任务文本清洗而来），建 .omx/state/team/{team}/（tasks.json、inbox.md）；
2. **拆路**：按上节拆成 lane 列表，写 tasks.json（lane id / 目标 / 验收 / 证据命令 / owner / 依赖）；
3. **编排**：workflow 脚本并行/流水线执行各 lane（每 lane 一个 subagent prompt）；后台任务（构建/测试）用 job 工具；
4. **汇总**：收集各 lane 证据 → verifier 通道复核 → 合并；
5. **终验**：完整验证证据（测试/构建/清单）→ 交接 ultragoal checkpoint 或用户；
6. **清场**：状态文件保留为审计记录（不删除 tasks.json/inbox.md）；临时工件清理。

## 升级与停止

- 缺凭证/权限、tmux 类需求（DSH 无此运行时）→ 停并报告；
- 单 lane 反复失败 3 次 → 报告并请求重派/缩小切片；
- 用户停止/取消 → 保留状态停；
- 不可调和的路间冲突 → 上报用户决策。

## 最终清单

- [ ] 预上下文快照存在
- [ ] tasks.json 每路有验收标准 + 证据命令 + owner
- [ ] 独立路才并行；共享文件路串行或分阶段
- [ ] 交接有 ACK 回读记录（inbox.md）
- [ ] 验证通道独立且关闭前交出证据
- [ ] 各 lane 证据汇总并经 verifier 复核
- [ ] 与 ultragoal 叠加时：worker 未碰目标状态，checkpoint 由 leader 用新鲜 get_goal 快照完成
- [ ] 终验证据完整，状态文件保留为审计记录
