# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-08-17

首个公开发布版本：OMX 风格工作流技能集，移植自 oh-my-codex（MIT，v0.20.5），全部重写为 DeepSeek Harness 原生机制；不含视觉技能。

### Added

**规划类（4）**

- `deep-interview` — Socratic 深度访谈：逐轮提问 + 歧义评分，收敛为可执行规格
- `plan` — 战略规划：访谈 / 直接 / 共识 / 评审四种模式
- `ralplan` — 共识规划：Planner→Architect→Critic 顺序审查 + RALPLAN-DR 审议 + ADR
- `prometheus-strict` — 严格规划：Metis 澄清 → Momus 挑战 → Oracle 综合自检

**执行类（6）**

- `ralph` — 持久执行闭环（原生 ralph 工具 / 会话内纪律 + 独立架构复核）
- `autopilot` — 严格自主交付循环：deep-interview → ralplan → ultragoal → code-review → ultraqa
- `team` — 协调并行团队（workflow 工具编排 + 共享任务清单 + 验证通道）
- `ultrawork` — 并行执行引擎（验收标准先行 + 双通道 + 轻量验证）
- `ultragoal` — 持久多目标执行（goal 工具聚合目标 + .omx/ultragoal 台账）
- `ultraqa` — 对抗式动态 e2e QA（9 类恶意场景矩阵 + 循环修复）

**质量类（8）**

- `code-review` — 双独立通道评审 + 确定性合入门禁
- `security-review` — 密钥/依赖/注入/认证/配置/网络七面体检
- `analyze` — 只读深度分析（证据/推断/未知三分类）
- `build-fix` — 构建修复（复现 → 根因 → 最小修 → 复验）
- `tdd` — 测试先行（Red-Green-Refactor）
- `ai-slop-cleaner` — 反冗余清理（先锁测试 + 逐气味 + 兜底分类）
- `git-master` — Git 专家（原子提交 / 变基 / 分支管理）
- `design` — DESIGN.md 设计源工作流（文本化）

**运维与自举（5）**

- `cancel` — 停止工作流并清理状态（保留可续）
- `doctor` — DSH 环境诊断（harness/技能/插件/记忆/环境五面）
- `note` — 会话笔记（.omx/notepad.md + 记忆库）
- `skill-authoring` — DSH 技能创作指南（契约/注册/打包/发布）
- `ecomode` — 省 token 纪律

**角色提示词（roles/，10 个，供 subagent 复用）**

planner / architect / critic / analyst(Metis) / momus / oracle / executor / verifier / code-reviewer / test-engineer

**基础设施**

- 包内嵌入式技能提供方（`ctx.skills.registerProvider`，kebab 命名、惰性加载、身份校验）
- 契约测试套件（node --test，23 技能断言，8/8 通过）
- cordis bundle 挂载（`cordis.patch.yml`）+ dshWorkshop 市场元数据
- MIT 许可 + oh-my-codex 署名（NOTICE / THIRD_PARTY_NOTICES.md）

### 已知取舍

- 无视觉模型 → 不含 visual-ralph / visual-verdict / frontend-ui-ux / hud / vision；
- 无 agent_type 角色路由 → 角色 = roles/ 提示词 + subagent 隔离上下文；
- 无 omx CLI / tmux → 状态用 .omx/ 文件约定，团队编排用 workflow 工具。

[1.0.0]: https://github.com/hatsuyuki0103/oh-my-deepseek-harness/releases/tag/v1.0.0
