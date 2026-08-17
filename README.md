# oh-my-deepseek-harness

OMX 风格的工作流技能集，为 [DeepSeek Harness](https://www.deepseekharness.com) 重写。

移植自 [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex)（MIT 许可）的技能设计，并针对 DeepSeek Harness 的原生能力全面重写：

- `omx question` → `ask_user_question`（结构化逐轮提问）
- Codex goal mode → DSH `create_goal` / `get_goal` / `update_goal`
- 原生子代理角色路由 → `subagent` / `subagent_fork` + 角色提示词
- tmux 团队编排 → `workflow` 工具 + 后台任务
- `omx ralph` CLI → DSH 原生 `ralph` 工具
- `.omx/` 工作区约定（context / interviews / specs / plans）保留

**视觉相关技能不做**（DeepSeek 无视觉）：visual-ralph、visual-verdict、frontend-ui-ux、hud、vision。

## 已收录技能

**规划类**

| 技能 | 说明 |
|---|---|
| `deep-interview` | Socratic 深度访谈：逐轮提问 + 歧义评分，收敛为可执行规格 |
| `plan` | 战略规划：访谈 / 直接 / 共识 / 评审四种模式 |
| `ralplan` | 共识规划：Planner→Architect→Critic 顺序审查 + RALPLAN-DR 审议 + ADR |
| `prometheus-strict` | 严格规划：Metis 澄清 → Momus 挑战 → Oracle 综合自检 |

**执行类**

| 技能 | 说明 |
|---|---|
| `ralph` | 持久执行闭环：原生 ralph 工具 / 会话内纪律 + 独立架构复核 |
| `autopilot` | 严格自主交付循环：deep-interview → ralplan → ultragoal → code-review → ultraqa |
| `team` | 协调并行团队：workflow 工具编排 + 共享任务清单 + 验证通道 |
| `ultrawork` | 并行执行引擎：验收标准先行 + 直接/证据双通道 + 轻量验证 |
| `ultragoal` | 持久多目标执行：goal 工具聚合目标 + .omx/ultragoal 台账 + 最终评审闸 |
| `ultraqa` | 对抗式动态 e2e QA：9 类恶意场景矩阵 + 测试-诊断-修复循环 |

**质量类**

| 技能 | 说明 |
|---|---|
| `code-review` | 全面代码评审：code-reviewer + architect 双独立通道 + 确定性合入门禁 |
| `security-review` | 安全审查：密钥/依赖/注入/认证/配置/网络七面体检 |
| `analyze` | 只读深度分析：证据/推断/未知三分类 + 排序解释 |
| `build-fix` | 构建修复：复现 → 根因 → 最小修 → 全量复验 |
| `tdd` | 测试先行：Red-Green-Refactor 铁律 |
| `ai-slop-cleaner` | 反冗余清理：先锁测试 + 逐气味清理 + 兜底分类 |
| `git-master` | Git 专家：原子提交 / 变基 / 分支管理（Conventional Commit） |
| `design` | DESIGN.md 设计源工作流（文本化，无视觉依赖） |

**运维与自举**

| 技能 | 说明 |
|---|---|
| `cancel` | 停止工作流：goal 结单 + 后台任务终止 + 状态终态化（保留可续） |
| `doctor` | DSH 环境诊断：harness / 技能 / 插件 / 记忆 / 环境五面体检 |
| `note` | 会话笔记：.omx/notepad.md + hindsight 记忆库 |
| `skill-authoring` | DSH 技能创作指南：契约 / 注册 / 打包 / 发布全流程 |
| `ecomode` | 省 token 纪律：自做优先 / 合并委派 / 后台收口 |

配套角色提示词（`roles/`，供 subagent 复用）：planner / architect / critic / analyst(Metis) / momus / oracle / executor / verifier / code-reviewer / test-engineer。

（v0.1.0 试点 + P1 规划类 + P2 执行类 + P3 质量类 + P4 运维自举，共 23 技能；发布（npm + awesome-dsh-plugin + dshmarket）在路线图中。）

## 安装

```sh
dsh plugin --profile web add oh-my-deepseek-harness
```

重启 `dsh web` 后，会话技能目录中出现本包技能，模型通过 `skill` 工具按名加载。

## 触发方式

在对话中说出触发词即可（无需特殊前缀，技能目录会提示模型）：

- 「deep interview」「访谈我」「别假设」→ `deep-interview`
- 也可以直接说「用 deep-interview 技能」

## 开发

```sh
node --test test/*.test.mjs   # 提供方契约测试
```

新增技能 = 在 `skills/<name>/SKILL.md` 写 frontmatter（`name` + `description` 必填，`argument-hint` 可选）+ 正文，无需改任何代码。

## 许可证

MIT · 技能工作流设计源自 oh-my-codex（MIT），见 NOTICE 与 THIRD_PARTY_NOTICES.md。
