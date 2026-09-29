---
name: doctor
description: DSH 环境诊断：harness/技能/插件/配置/环境逐项体检，给出结论与修复建议。用户说「doctor / 诊断环境 / 为什么技能没出现 / 插件没生效」时使用。
argument-hint: "[--skills|--plugins|--capabilities|--all]"
---

# Doctor（DSH 环境诊断）

> 可选能力：本技能引用的可选工具（DSH 原生 `ralph` 工具、官方团队九工具、`workflow`、`subagent`/`subagent_fork`）可能在当前 profile 未挂载或被预设停用；探测方式与四级降级阶梯见本包根目录 `docs/capability-matrix.md`（技能目录上两级：`../../docs/capability-matrix.md`）。

## 定位

诊断 DeepSeek Harness 环境与 oh-my-deepseek-harness 插件自身的健康状况。只读诊断 + 修复建议；修复动作经用户确认后走对应通道。

## 体检项

1. **Harness 运行时**
   - 当前会话 runtime 上下文：文件策略、审批开关、技能目录快照。
2. **技能系统（--skills）**
   - 会话目录里本包技能是否齐全（应含 10+：deep-interview / plan / ralplan / prometheus-strict / ralph / autopilot / team / ultrawork / ultragoal / ultraqa / code-review / security-review / analyze / build-fix / tdd / ai-slop-cleaner / git-master / design / cancel / doctor / note / skill-authoring）；
   - 用 skill 工具逐个抽检能否加载正文；缺失/加载失败 → 检查插件包是否安装进 profile（dsh plugin --profile web add oh-my-deepseek-harness）、bundle 是否在 dsh.profile.bundles、是否需要重启 dsh web；
   - frontmatter 契约：name/description 非空、kebab 唯一（可跑包内 node --test test/ 验证）。
3. **插件与 profile（--plugins）**
   - profile package.json 依赖与 bundles 一致性（dsh plugin add 会自动 reconcile；不一致看依赖是否声明了 dsh.bundle.patch）；
   - 插件目录 junction 是否指向正确路径；
   - 本会话动态插件（cordis_inspect_self 列表）是否有残留/失败 Run；动态插件 API（`cordis_inspect_self`/`cordis_stop`）名册未挂载时以插件页状态替代并标注，否则跳过该步并报告。
4. **环境**
   - node 版本（^22.19 || >=24）、pnpm 可用、dsh CLI 版本；
   - 工作区可写性（临时文件试写）；pwsh 沙箱模式与文件策略。
5. **可选能力探测（--capabilities）**
   - 方法：`cordis_inspect_query({platform:'host',provider:'Tool',method:'listTools'})` 读当前会话的真实工具名册（不猜、不靠文档），配置面再用 `Config.listConfigs` 对照 profile / preset 实况；
   - 逐项报告状态：官方团队九工具（`spawn_teammate` / `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` / `team_task_create` / `team_task_get` / `team_task_list` / `team_task_update`）、`ralph` 工具（名册未挂载时标注为不可用并给降级路径）、`subagent`+`subagent_fork`、`workflow`、动态插件 API（`cordis_inspect_self`/`cordis_stop`）、`subagent_codex`+`subagent_claude_code`（本包零引用，只报状态）；
   - **两种停用要分开报告**：① 宿主层未挂载/停用 = 名册里根本没有该工具（宿主 `inactive`，整包未装或被 profile 关闭）；② 预设作用域停用 = 工具在名册中可见，但被 preset 覆盖重挂载为 `disabled: true`，本会话不可调用；两者修复路径不同（前者装包/开插件，后者改 preset 或换会话）；
   - **「工具出现 ≠ 团队成员」**：团队九工具只发给被判为 Team member 的 agent（Lead 与 teammate）；未建队 / 未入队时名册可能不含九工具，属正常而非故障；
   - 每项结论给出降级路径，口径统一见 `docs/capability-matrix.md`（本包根目录；技能目录上两级 `../../docs/capability-matrix.md`）。

## 输出契约

```
## Doctor Report

Harness: <运行时状态>
Skills: <应有多少/实际多少 + 抽检结果>
Plugins: <profile 一致性 + junction>
Capabilities: <九工具 / ralph / subagent 系 / workflow / 动态插件 API / codex 系 逐项：已挂载 | 未挂载 | 预设作用域停用>
Env: <node/pnpm/dsh 版本 + 沙箱>

Issues (severity):
- [HIGH] ... — 修复建议
- [LOW] ...

Next steps:
- <按严重度排序的修复动作>
```

## 最终清单

- [ ] 五个体检面都跑过（不适用显式 N/A）
- [ ] 可选能力探测用 `cordis_inspect_query` 读真实名册，并区分两种停用
- [ ] 技能抽检用 skill 工具真实加载
- [ ] 每个问题带严重度与修复建议
- [ ] 修复动作未擅自执行（除无害的验证性检查）
