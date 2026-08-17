---
name: prometheus-strict
description: 严格规划：Metis 澄清需求、Momus 对抗挑战、Oracle 综合并自检，产出交接就绪的规划产物。任务重要到浅计划会做错事、验收/边界/风险/验证不全时使用。
argument-hint: "<目标或问题陈述>"
---

# Prometheus Strict（严格规划）

## 目的

在歧义仍有风险时，用三声部严格规划代替直接执行：**Metis 澄清**（需求缺口）、**Momus 挑战**（假设与验证缺口）、**Oracle 综合**（交接就绪的最终计划）。产物是纯规划工件，交接给 goal 工具（长期目标）或 workflow 团队（并行通道）。

理念源自 OMO Prometheus（code-yeongyu/oh-my-openagent），本技能按 DSH 原生机制重新实现。

## 何时使用 / 何时不用

使用：任务重要到浅计划会做错事；需求半知半解、验收/边界/风险/验证不全；用户要严格访谈后再动手；后续要立长期目标需要持久范围与测试规格；团队拆分前通道还不安全。

不用：清晰低风险改动要直接实现；只是仓库查询/解释（用 analyze）；代码改完需要对抗式 QA（用 ultraqa）；用户要的是钩子/外部自动化（明确非目标）。

## 三声部协议（DSH 版）

角色 = 本插件 `roles/` 目录（本技能目录上两级 `../../roles/`）下的提示词 + subagent 工具的隔离上下文：

- **Metis** = `roles/analyst.md`（澄清与缺口分析，只读）
- **Momus** = `roles/momus.md`（对抗批评，只读）
- **Oracle** = `roles/oracle.md`（综合 + 自检）

有 subagent 工具时用独立子代理承担各声部（prompt = 角色文件全文 + 任务陈述 + 上下文快照 + 产物路径）；无子代理面时按同角色在主上下文内执行，但**评审声部（Momus）不得由起草者自演**——至少用 subagent 隔离一次。

## 结构化提问（ask_user_question）

- **批量提问是默认**：范围、约束、非目标、交付物、安全边界、验收标准互相独立时，一次 ask_user_question 调用带多个 question（一个面板答完）；只有后一题依赖前一题答案的依赖链才一问一轮。
- 每轮答案回来后必须做**两遍补缺**：Pass 1 把回答并入清单（只把 USER_ANSWERED / ABSORBED_WITH_CITATION / INFERRED_FROM_SPEC 标 YES）；Pass 2 用仓库上下文、先前轮次、web_search 证据与保守可逆默认值吸收非 CRITICAL 残余缺口，只留 CRITICAL 阻塞。
- **最少两轮**：只要发过第一轮问题，处理完 Round 2 之前不交接；零问题但清单全 YES 可直接交接。
- 拒绝式回答（一两字符、"随便/你定"、脏话、上轮被打断）使该轮答案无效：不推进任何清单项，立即退出访谈循环，把缺口路由为静默吸收（用户明确放手）或上报（愤怒/打断）。
- 上限 5 轮：未清关就把剩余 UNKNOWN 项作为显式 `<unresolved_blocker>` 移交 Oracle。

## 六项清单清关（确定性判据）

每轮结束必须精确判定，禁止"我觉得差不多了"：

1. objective（目标明确）
2. scope IN+OUT（范围与非目标明确）
3. acceptance（验收可测）
4. test strategy（测试策略明确）
5. handoff target（交接目标明确）
6. no outstanding CRITICAL（无遗留关键缺口）

全部 YES 才清关。

## 步骤

1. **摄取与安全边界**：重述目标结果、已知约束、交付物、验证期望与停止条件；破坏性/凭证门控/外部生产/实质改范围的决定一律留给用户显式确认。
2. **Metis 访谈循环**：识别当前 UNKNOWN 清单项与 CRITICAL 问题 → 批量提问 → 两遍补缺 → 评估六项清单 → 未清关回环（上限 5 轮，超限移交 `<unresolved_blocker>`）。第一轮提问前对非平凡意图做研究扇出（仓库事实自查 + 外部事实 web_search），提问只问残留的 CRITICAL 缺口。
3. **Momus 挑战**：用 `roles/momus.md` 挑战欠定义的验收、不安全假设、隐藏破坏步骤、过宽范围、缺失验证、所有权冲突、交接歧义。
4. **Oracle 综合（两遍）**：Pass 1 综合（目标/范围/假设/已解批评/步骤与 owner/验证矩阵/回滚/交接）；Pass 2 自检（见 roles/oracle.md 断言清单），失败回 Pass 1，上限 3 循环，超限带标注产出并上报。
5. **Momus→Oracle 有界复验**：Oracle 综合后重新让 Momus 核验没有引入新风险（范围加了验证没加、通道拆分产生依赖环、安全加固与停止条件矛盾）；最多 3 次复综合，仍有阻断项则标注 carried-forward 进终稿。
6. **后计划 Metis 复查**：终稿渲染后再用 Metis 扫一遍「只有计划成型后才暴露的歧义」（通道重叠、停止条件与验收矛盾等）；有阻断缺口回步骤 4 Pass 1，否则继续。
7. **交接**：默认推荐 DSH goal 工具（create_goal 承接长期目标，验收后 update_goal 标 complete）；并行通道安全时才推荐 workflow 团队；ralph 工具只在用户点名时用。**用户未明确授权不启动任何执行通道。**

## 产物

需要持久工件时写 `.omx/plans/prometheus-strict/{slug}.md`：

```
## Prometheus Strict Plan

### Target Result
- <一句话目标>

### Clarified Requirements (Metis)
- <需求 / 验收标准>

### Critique Resolved (Momus)
- <风险或异议> -> <解决方案>

### Oracle Execution Plan
1. <排序步骤或通道>

### Verification Matrix
| Claim | Required evidence | Owner/lane |
| --- | --- | --- |
| <声明> | <测试/构建/lint/e2e/文档证据> | <owner> |

### Handoff
- Recommended next workflow: <goal / workflow / ralph / none>
- Stop condition: <什么证明计划就绪或为何受阻>

### Credit
Inspired by OMO Prometheus (code-yeongyu/oh-my-openagent), reimplemented for DeepSeek Harness.
```

纯内联计划可把路径标为 `N/A - inline plan only`。

## 失败与升级

必要答案无法安全推断、下一步破坏性/凭证门控、仓库上下文缺失、用户要求非目标行为时——升级上报，不硬规划。

## 最终清单

- [ ] 目标结果显式
- [ ] 范围与非目标显式
- [ ] 验收标准可测量
- [ ] Metis 循环：每轮答案后两遍补缺；发出过问题则至少两轮；否则 5 轮上限带 `<unresolved_blocker>` 移交
- [ ] Momus 异议已解决或显式 carried-forward（复综合最多 3 次）
- [ ] Oracle 计划含验证矩阵
- [ ] Oracle Pass 2 自检完成，每条断言通过或标注 carried-forward
- [ ] 后计划 Metis 复查无阻断异议（或全部 carried-forward）
- [ ] 交接只推荐 goal 工具 / workflow / ralph，且未经用户授权未启动
- [ ] 署名完整
