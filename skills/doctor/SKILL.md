---
name: doctor
description: DSH 环境诊断：harness/记忆/技能/插件/配置/环境逐项体检，给出结论与修复建议。用户说「doctor / 诊断环境 / 为什么技能没出现 / 插件没生效」时使用。
argument-hint: "[--skills|--plugins|--memory|--all]"
---

# Doctor（DSH 环境诊断）

## 定位

诊断 DeepSeek Harness 环境与 oh-my-deepseek-harness 插件自身的健康状况。只读诊断 + 修复建议；修复动作经用户确认后走对应通道。

## 体检项

1. **Harness 运行时**
   - `hindsight_diagnose`（可用时）：bank/workspace/harness/配置位置/API 端点/非敏感环境变量；
   - 当前会话 runtime 上下文：文件策略、审批开关、技能目录快照。
2. **技能系统（--skills）**
   - 会话目录里本包技能是否齐全（应含 10+：deep-interview / plan / ralplan / prometheus-strict / ralph / autopilot / team / ultrawork / ultragoal / ultraqa / code-review / security-review / analyze / build-fix / tdd / ai-slop-cleaner / git-master / design / cancel / doctor / note / skill-authoring）；
   - 用 skill 工具逐个抽检能否加载正文；缺失/加载失败 → 检查插件包是否安装进 profile（dsh plugin --profile web add oh-my-deepseek-harness）、bundle 是否在 dsh.profile.bundles、是否需要重启 dsh web；
   - frontmatter 契约：name/description 非空、kebab 唯一（可跑包内 node --test test/ 验证）。
3. **插件与 profile（--plugins）**
   - profile package.json 依赖与 bundles 一致性（dsh plugin add 会自动 reconcile；不一致看依赖是否声明了 dsh.bundle.patch）；
   - 插件目录 junction 是否指向正确路径；
   - 本会话动态插件（cordis_inspect_self 列表）是否有残留/失败 Run。
4. **记忆（--memory）**
   - Hindsight 工具是否可用（list/search 调用）；401/无 API key 时报告「记忆服务未配置，不影响其他功能」。
5. **环境**
   - node 版本（^22.19 || >=24）、pnpm 可用、dsh CLI 版本；
   - 工作区可写性（临时文件试写）；pwsh 沙箱模式与文件策略。

## 输出契约

```
## Doctor Report

Harness: <运行时状态>
Skills: <应有多少/实际多少 + 抽检结果>
Plugins: <profile 一致性 + junction>
Memory: <可用/未配置>
Env: <node/pnpm/dsh 版本 + 沙箱>

Issues (severity):
- [HIGH] ... — 修复建议
- [LOW] ...

Next steps:
- <按严重度排序的修复动作>
```

## 最终清单

- [ ] 五个体检面都跑过（不适用显式 N/A）
- [ ] 技能抽检用 skill 工具真实加载
- [ ] 每个问题带严重度与修复建议
- [ ] 修复动作未擅自执行（除无害的验证性检查）
