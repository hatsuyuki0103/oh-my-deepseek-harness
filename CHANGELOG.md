# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.2] - 2026-08-17

### Fixed

- **登录小黑窗（uv.exe 黑色控制台）的根治**：根因是 Win11 默认终端为 Windows Terminal 时，CUI（控制台子系统）进程链在"父进程无控制台"时新建的**可见**控制台会被 WT 拉出窗口。两条罪魁链都已封死：
  - **API daemon 自拉链**（黑窗主犯）：hindsight-embed 在本地无 hindsight-api 二进制时回退 `uvx hindsight-api@… --daemon`，且用 `DETACHED_PROCESS` spawn → uvx/uv 全程无控制台 → **uv 新建可见控制台（窗口标题 = uv.exe）**。修复：daemon_embed_manager.py 本地补丁改用 `powershell -WindowStyle Hidden` 包装（powershell 自建并隐藏控制台，uvx→uv→python 全链继承这一个隐藏控制台；stdout/stderr 句柄保留，daemon 日志捕获不丢）。
  - **守护拉起链**（daemon-start.js）：`windowsHide:true`（CREATE_NO_WINDOW）同样导致 uv 新建可见控制台。修复：win32 + daemon.start 时改经 `wscript.exe hindsight-daemon.vbs wait`（SW_HIDE 隐藏控制台 + 同步退出码）。
  - 顶层登录链统一为：Startup shim VBS → `~/.dsh/autostart/hindsight-daemon.vbs`（唯一真源，支持 wait 参数）→ `hindsight-daemon-launch.ps1`（隐藏控制台 + `exit $LASTEXITCODE` + `%TEMP%\hindsight-daemon-autostart.log`）。
- **编码连环坑的根治（替代 1.1.1 的 PYTHONUTF8 方案）**：真正的数据源污染是 hindsight-embed 的 profile env 模板与 `coding-agent.env` 里 5 处 UTF-8 em dash `—`（15 个非 ASCII 字节）——Python 默认 GBK 读取必然崩溃；而 `PYTHONUTF8=1` 只是压住了读文件这一头，反而把 daemon stop 的 netstat 输出（GBK）强制按 UTF-8 解码弄崩（`AttributeError: 'NoneType' object has no attribute 'splitlines'`）。修复：
  - uv 缓存中 `env.example` 模板与 `~/.hindsight/profiles/coding-agent.env` 全部 ASCII 化（em dash → 连字符）；
  - 守护 spawn 不再注入 `PYTHONUTF8`/`PYTHONIOENCODING`（用户环境持久化项亦已移除）；
  - 结论：GBK 读取崩溃的源头是数据文件而非代码，数据源干净后默认编码即可。

### Notes

- 补丁矩阵（升级会被覆盖，重打 SOP 见 .omx 上下文快照）：`dist/daemon-start.js`（wscript 路由）、`hindsight_embed/daemon_embed_manager.py`（powershell 隐藏包装）、`dist/dsh.js`（自动拉起补丁，v1.1.0 起）。
- 若日后重新安装/升级 hindsight-embed，需重打模板 ASCII 化补丁。

[1.1.2]: https://github.com/hatsuyuki0103/oh-my-deepseek-harness/releases/tag/v1.1.2

## [1.1.1] - 2026-08-17

### Fixed

- **中文 Windows 上 daemon 自动拉起失败的编码根因**：hindsight-embed 的 profile env 模板含 UTF-8 中文注释，Python 默认 GBK 读取时 `UnicodeDecodeError` 崩溃，导致 VBS/插件补丁/守护全部启动路径静默失败（此前手动启动成功是因为手工加了 PYTHONUTF8=1）。修复：守护 spawn 显式注入 `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8`；用户环境亦已持久化（重启/登录路径同样覆盖）。

[1.1.1]: https://github.com/hatsuyuki0103/oh-my-deepseek-harness/releases/tag/v1.1.1

## [1.1.0] - 2026-08-17

### Added

- **Hindsight 本地 daemon 守护**（升级免疫兜底）：插件 apply 时检查 `~/.hindsight/coding-agent.json`（daemon 模式才守护）→ 探活 9077 `/health` → 未健康则静默拉起 `node <hindsight>/dist/daemon-start.js --harness dsh`（detached + windowsHide + NO_PROXY/HF_ENDPOINT 环境）。与 Hindsight 插件自身的自动拉起补丁同一条启动链，幂等由 daemon-start.js 健康自守卫背书。
- `lib/watchdog.mjs`：三态决策纯函数（shouldWatch / isDaemonHealthy / resolveDaemonStartPath / makeSpawnDaemon / runWatchdog），可通过 cordis 行配置关闭（`enableHindsightWatchdog: false`）或指定 `daemonStartPath`。
- 契约测试：`test/watchdog.test.mjs`（5 项：配置判定、健康探活、路径解析、spawn 形状、三态端到端）。

### Notes

- Hindsight 插件 dsh 适配器不自动拉起 daemon 的根因侧补丁（dist/dsh.js 本地补丁：重加被 tree-shake 的 startDaemonDetached + apply 时 daemon 模式健康检查后启动），补丁重打说明见 .omx 上下文快照。

[1.1.0]: https://github.com/hatsuyuki0103/oh-my-deepseek-harness/releases/tag/v1.1.0

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
