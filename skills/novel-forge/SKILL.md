---
name: novel-forge
description: 长篇小说工坊：立意 → 世界观/人物/大纲 → 逐章成稿，用状态账本 + 六维逻辑闸（台词/空间/物理/时间/人物/因果伏笔）+ 反 AI 腔体检兜住长篇一致性，每章过闸才进下一章；也能对既有稿件做逻辑审计与去 AI 味。写小说、续写章节、搭世界观人物、查小说逻辑硬伤、去 AI 味时使用。
argument-hint: "[new|write|audit|repair|export] [--project <dir>] [--chapter <n>] [--strict]"
---

# 小说工坊（novel-forge）

> 可选能力：本技能引用的可选工具（DSH 原生 `ralph` 工具、官方团队九工具、`workflow`、`subagent`/`subagent_fork`）可能在当前 profile 未挂载或被预设停用；探测方式与四级降级阶梯见本包根目录 `docs/capability-matrix.md`（技能目录上两级：`../../docs/capability-matrix.md`）。

## 目的

把长篇写作当成**可校验的工程**，而不是一次性的灵感输出：

- **状态账本**（`.omx/novel/<slug>/`）记住世界规则、人物、空间、时间、知识、道具、伏笔——跨章一致性靠账本，不靠模型记忆；
- **62 条确定性规则**（`lib/novel-lint.mjs`）把「台词越界 / 空间瞬移 / 物理不守恒 / 时间倒退 / 死者复活 / 伏笔乱序」变成**带 rule id 与严重度的发现**，而不是让模型自己说「我检查过了」；
- **反 AI 腔体检分**把「一看就是 AI 写的」变成可复跑的数字与可执行的改写动作；
- **章门禁**：不过闸不得进下一章（吸收 Iron Law）；每章交付必须附命令与退出码。

## 何时用

- 要**从零写一篇小说/长篇连载**（中文或英文），需要世界观、人物、大纲到逐章成稿的完整流水线；
- 要**续写已有项目**，但担心几十章后设定漂移、时间线打架、人物前后不一；
- 已有一批稿件，要**审计逻辑硬伤**（「他第 2 章就知道的事，第 5 章才被告知」这类）；
- 稿子通顺但**读起来像 AI**，需要量化体检 + 定点改写；
- 要写**短篇**：可以只走轻模式（正文 → `prose` 体检 → 人工复核），不建模账本。

## 何时不用

- 只要一个故事梗概/点子（直接用对话回答，不必建项目）；
- 写剧本/分镜/短视频脚本（本技能面向散文体小说；分镜类请用对应技能）；
- 期待「一键生成 100 万字」：本技能是纪律层 + 校验层，正文质量取决于会话模型。它能把**可机器判定的**设定/时间/空间/道具/知识/伏笔矛盾变成门禁证据，并对反 AI 腔给出可量化分数；语义层（正文与标注是否一致、人物声音、动机）仍需语义审校与人工复核——它不承诺「保证不犯硬伤」；
- 需要出版排版（EPUB/DOCX/封面）或投稿信：v1.0 不含；
- 只想要「语法/错别字」检查：用编辑器或通用校对，不必建账本。

## 前置检查（开工前 30 秒）

1. **引擎定位**（三级解析，按序）：
   1. 环境变量 `NOVEL_LINT`（显式路径）；
   2. `<技能目录>/../../lib/novel-lint.mjs`（DSH 加载技能时给出的 Base directory，`../../` = 技能目录上两级，与降级指针同约定）；
   3. `./lib/novel-lint.mjs`（当前目录 = 插件包检出的开发者路径）。
   验证：`node "<引擎路径>" rules --json` 能输出 62 条规则。
2. **Node 版本**：`^22.19.0 || >=24.0.0`（与包 `engines` 一致）。低版本 → 报告并降级。
3. **项目定位**：项目根 = `<你的小说目录>/.omx/novel/<slug>/`，**相对你的 cwd**；所有命令显式传项目目录，禁止依赖隐式路径。不在插件包检出内 `init`（demo/证据放到小说目录或临时目录）。
4. **降级口径（引擎不可用）**：不得假装跑过门禁。必须：
   - 写 `reports/gate-degraded.md`：列出检查过的路径、Node 版本、本次用人工清单覆盖了哪些维度；
   - 按 [`references/logic-rules.md`](references/logic-rules.md) 逐条人工核对，报告里标明「脚本不可用 → 人工规则校验（N 条已查 / M 条未覆盖）」；
   - 交付结论时明确说这是**降级结论**。

```sh
# 推荐：把引擎路径固定成变量（跨平台示例，路径按实际加载结果替换）
NOVEL_LINT="<技能目录>/../../lib/novel-lint.mjs"
node "$NOVEL_LINT" rules --json | head -c 200
# PowerShell
$NOVEL_LINT = "<技能目录>/../../lib/novel-lint.mjs"; node $NOVEL_LINT rules --json
```

## 铁律（任何情况下不绕过）

1. **状态先于正文**：世界规则/人物/空间/事实没进 `bible/`，不许在正文里自创；场景的时间/地点/在场/知识/道具没进 frontmatter，不算写完。
2. **一章一交付**：一次只写一章，禁止一次连写多章（跨章一致性会在连写时崩）；写完必须过闸。
3. **门禁不过不进下一章**：`lint` 退出码非 0（存在 BLOCKER/MAJOR）时，唯一合法动作是修复本章；不得手改报告、不得「先写着后面再修」。
4. **正文零元信息**：正文不得出现 `[说明]`、`（注：）`、`TODO`、`作者按`、推理过程、角色定位标注——出现即 P0 重写（VOICE-001）。
5. **反 AI 腔不达标不交稿**：体检分低于阈值（默认 60）即 MAJOR；例外只能走「三步调参出口」并留痕。
6. **改设定必须三处同步**：`project.json`/`bible/*` + `outline/outline.json` + 受影响章节 frontmatter，三处一起改；只改一处 = 引入矛盾，门禁一定会红。

## 项目布局与事实源优先级

```
.omx/novel/<slug>/
  project.json            # 配置 + 世界硬规则（chapterWords/thresholds/hardRules/envRules）
  bible/world.md          # 世界观散文（人读）
  bible/characters.jsonl  # 人物卡（含 voice 说话指纹、appellations 称谓白名单、abilities/limits/resources）
  bible/space.json        # 地点图（places + edges: 通行分钟数）
  bible/facts.jsonl       # 事实注册表（public / truth / revealAt）
  bible/hooks.jsonl       # 伏笔注册表（问题 + 状态覆盖位；埋设/回收真源在章节 frontmatter）
  outline/outline.json    # 写作前计划：章节 → 场景卡（goal/conflict/outcome/cast/place/hooks）
  chapters/ch-001.md      # 章节 = YAML frontmatter（场景元信息）+ 正文
  summaries.md            # 每章 1-3 句摘要（上下文打包用）
  style/style.md          # 文风指南（人读；数值阈值在 project.json）
  reports/last.json|md    # 最近一次门禁报告（lint 默认产物）
  reports/exemptions.json # 豁免（可选，必填 reason）
  exports/manuscript.md   # 导出合并稿
```

**事实源优先级（判定冲突时按此）**：
1. **章节 frontmatter = 唯一事实源**：时间线/在场/道具/知识/伤势/资源/伏笔埋设与回收，全部由 frontmatter 按章节序 replay 派生。
2. `bible/hooks.jsonl` 与 `outline/outline.json` = **断言（计划）**：与派生值不一致 → `HOOK-006`/`OUT-005` 报告（提示改计划，不用计划覆盖真源）。
3. `bible/` 世界层注册表 = **引用白名单**：正文标注只能引用，不能自创。

## 工作流

### 1 立项（`new`）

产出 `project.json` + `bible/world.md` 骨架。开工前先确认五要素（缺项给 2-3 个推荐选项让用户选，不假设）：

- **目标读者与渠道**（网文/出版/自娱）、**题材与基线风格**（悬疑/都市/奇幻/言情/硬汉派…）、**核心禁区**（不写什么/雷点）、**自动化等级**（每章确认 / 每 5 章确认 / 全自动）、**目标规模**（总字数、单章字数、卷数）。

落盘：`project.json` 的 `genre/audience/chapterWords/daylight`；`hardRules` 至少 3 条（世界的最硬约束，后续正文违反必须走 `violates`+`justification`）。

```sh
node "$NOVEL_LINT" init ".omx/novel/<slug>" --title "<标题>" --genre "<题材>"
```

### 2 建世界（硬规则先行）

写 `bible/world.md`（散文）+ `project.json.hardRules`（编号规则 R-001…）。**硬规则必须可判定**（「没有超自然力量，一切异常需物理解释」），不要写「文风要高级」这类审美要求（那是 `style/style.md` 的事）。有特殊环境（水下/真空/高原/极寒）→ 写 `envRules` 并要求装备或能力声明。

### 3 建人物

写 `bible/characters.jsonl`。每张卡必须有：`goal`（想要什么）、`fear`（怕什么）、`voice`（句长/口头禅/禁忌词）、`appellations`（谁可以怎么称呼他）、`abilities`/`limits`（能力边界）、`resources`（需追踪的资源初始值）。死人写 `status: dead` + `diedAt`；「暂时离场」写 `absent`。

### 4 大纲与场景卡

写 `outline/outline.json`：每章拆 1-4 个场景卡，每卡必须有 `goal`（本场目标）/`conflict`（阻力）/`outcome`（结果，且结果要留下可追踪的状态变化）。伏笔在埋设场景写 `hooks_plant`，回收场景写 `hooks_pay`。**大纲只写计划，不写正文**。可以一次先建多章计划卡再逐章写——此时全量 `lint` 会对「计划章未写」报 `OUT-003`、对「伏笔回收指向计划章」报 `FACT-004`，**属草稿期预期**；这两条是「计划型断言」，不拦 `--chapter` 章门禁，写完对应章节后自然消失。

### 5 写章闭环（`write`，核心）

每章固定 8 步（见下节「写章闭环」）。

### 6 审校既有稿（`audit`）

已有稿件（没有 frontmatter）→ 先做**反向建模**：从正文反抽每章的场景元信息（地点/时间/在场/知识使用/道具），写入 frontmatter（这是 Agent 的活，不是用户的活），再 `lint`。报告按六维分组输出：机器已判 + 需人工/语义判的清单。

### 7 修复（`repair`）

按 `fixRoute` 分流：`prose` 改正文 → `bible` 改注册表 → `outline` 改大纲 → `config` 改配置。**只改被点名的位置**；改设定时按铁律 6 三处同步。修完重跑 `lint`，直到退出码 0。

### 8 导出（`export`）

合并 `chapters/*.md` 正文（去 frontmatter）为 `exports/manuscript.md`，附目录与字数统计；可选按卷分文件。导出前必须最后一次 `lint` 干净。

## 写章闭环（8 步，缺一不算写完）

1. **上下文包**：`node "$NOVEL_LINT" context "<项目>" --chapter <N> --json` → 拿大纲卡 + 上一章摘要 + cast 人物卡 + 未回收伏笔 + 已知事实/地点索引（facts/places 为**全量索引**，按本章用途自行裁剪）；**写前只读 ≤5 个文件**（project.json + 本章大纲卡 + 上一章摘要 + cast 人物卡 + 相关 bible 片段），禁止把全库读进上下文。`context` 不要求本章文件已存在——**先取上下文包，再写章**。
2. **章节计划**：声明本章档位（慢档/中档/快档）、本章目标、要推进/回收的伏笔、必须发生的状态变化。快档章后下一章必须是慢档或中档缓冲。
3. **草稿**：只写**一章**；正文纯净（无元信息）；每个角色只能用「他此刻已知」的信息说话。
4. **frontmatter 落账**：把场景元信息写全（时间/地点/在场/actions/uses/knowledge/items/resources/injuries/facts/hooks）；这是门禁的输入，不是可选项。
5. **六维逻辑闸**：`node "$NOVEL_LINT" lint "<项目>" --chapter <N> --json --report "<项目>/reports/gate-ch-<N>.md"`，逐条修复。
6. **反 AI 腔**：同一份报告里的 `stats.aiVoice.score`；不达标 → 定点改写（见下节）→ **重扫**；改写不得改变事实（改了事实必须回写 frontmatter 并重跑门禁）。
7. **门禁判定**：退出码 0 才算过；MAJOR/BLOCKER 必须清零，MINOR 记录并择机修（`--strict` 时 MINOR 也阻塞）。
8. **摘要与移交**：往 `summaries.md` 追加本章 3 句摘要（含结尾悬念），更新 `outline` 状态，向用户报「本章过闸证据 + 下一章钩子」。

## 六维逻辑闸

每条都分两层：**机器已判**（`lint` 规则，可复跑）+ **语义还要查**（LLM 判，见「语义审校」）。修复路由决定改哪一处。

### 1 台词逻辑（dialogue）

- **机器**：`DLG-001` 知识越界（角色在 `uses` 里用了尚未获知的事实）、`DLG-002` 说话人未注册、`DLG-003` 称谓越界（`appellations` 白名单）；`SPACE-005` 说话人不在场。
- **语义**：意图-回应是否对得上（他在回避什么？对方为什么问这句？）；每个角色的**说话指纹**（句长/用词/口头禅）是否区分得开；有没有「为了讲设定而对话」（As-you-know-Bob）；潜台词是否被写成了明话。
- **路由**：改文。若是「他确实应该知道」→ 补前序 `knowledge` 场景（改文 + 记账），不是删台词。

### 2 空间逻辑（space）

- **机器**：`SPACE-001` 地点未注册、`SPACE-002` 无通路、`SPACE-003` 通行时间不足（瞬移）、`SPACE-004` 同一时刻两地、`SPACE-005` 不在场却动作。
- **语义**：视线/听觉可达性（角落里的第三人能不能看见）、门/楼层/掩体是否自洽、转场是否有方向感（读者知道人物在哪）。
- **路由**：改文（补转场/加时间跳跃）；地点不存在就改 `bible/space.json` 加节点与边（改设定 → 三处同步）。

### 3 物理逻辑（physics）

- **机器**：`PHYS-001` 重伤未愈做高强度动作、`PHYS-002` 已销毁/丢失道具重现、`PHYS-003` 道具转手来源不符、`PHYS-004` 无主道具被使用、`PHYS-005` 资源为负、`PHYS-006` 环境需装备未声明、`PHYS-007` 硬规则被违反且无 justification。
- **语义**：守恒直觉（时间/体力/伤害/弹药/金钱）、伤势的持续后果、环境对身体的影响（冷、热、缺氧、疲劳）、战斗回合与距离。
- **路由**：改文（补过程/降强度/加损耗）；资源与道具规则有错 → 改 `bible` + 回写 frontmatter。

### 4 时间逻辑（time）

- **机器**：`TIME-001/002` 同章/跨章时间倒退、`TIME-003` 场景重叠、`TIME-004` 天色与时刻矛盾、`TIME-005` 年龄不符、`TIME-006` 章节 day 不一致、`TIME-007` 倒叙未标记。
- **语义**：因果顺序（先因后果）、同时性叙述是否标清、季节/月相/天色推进、倒叙与插叙的边界提示。
- **路由**：改文；若确为倒叙 → 标 `flashback: true` 并给读者信号。

### 5 人物逻辑（character）

- **机器**：`CHAR-001` 未注册角色、`CHAR-002` 死者/失踪者当场复活（除非 flashback）、`CHAR-003` 能力越界、`CHAR-004` 人物卡缺 goal/voice、`CHAR-005` 状态非法、`CHAR-006` 正文出现死者姓名但本章 `mentions` 未登记（防「真复活」漏检）。
- **语义**：动机-行为一致（他为什么这么做？他怕的东西有没有被触发？）、底线是否被遵守、弧光是否有变化、关系变化有无铺垫。
- **路由**：改文；若人物设定本身矛盾 → 改 `bible/characters.jsonl` 并检查前序章节。

### 6 因果与伏笔（causality & hooks）

- **机器**：`HOOK-001` 回收早于埋设、`HOOK-002` 超期未回收、`HOOK-003` 已作废却回收、`HOOK-004` 回收未注册伏笔、`HOOK-005` 场景卡缺因果三元组、`HOOK-006` 计划与正文派生不一致；`FACT-001..004` 事实冲突/未注册/章节不存在。
- **语义**：每个结果是「挣来的」吗（巧合需要前置铺垫）、伏笔是否有人记得、有没有 deus ex machina、章末悬念是否具体。
- **路由**：改大纲（补铺垫）或改文（补因果链）；已作废伏笔 → 改 `bible/hooks.jsonl` 状态并说明。

## 语义审校（LLM 层，机器判不了的部分）

`lint` 只保证「可判定的那半」。每章过闸后，按下列 rubric 做一次语义审读（写入 `reports/semantic-ch-<N>.md`）：

1. **意图-回应**：每段对话，问「这句话在推进什么/回避什么」，答不上来就是废对话；
2. **信息边界**：谁还不知道什么？有没有角色表现得「未卜先知」；
3. **show vs tell**：情绪是不是被直接命名（「他很愤怒」）而不是被行为外化；
4. **场景因果**：场景结束时的状态与开始时不同吗？不同在哪（必须能写成 frontmatter 变化）；
5. **声音区分**：遮住说话人名字，能否靠用词/句长认出是谁；
6. **视角一致**：POV 角色感知不到的信息有没有漏进叙述；
7. **节奏**：本章有没有「档位」？A/B/C 配额（主线实质推进/关系决定性升级/核心秘密揭露）是否超过 1 项？

**反向抽取复核（长篇必做，每 5 章或每卷）**：用独立上下文（`spawn_teammate`/`subagent`；名册皆无则本会话另起一轮并标注「非独立」）**只读正文**，反抽「场景 id/地点/时间/在场/知识使用/道具」，与 frontmatter 对比；差异 → 人工裁定（改文或改标注），写 `reports/audit-ch-XXX.md`。目的：防止「填表自洽」掩盖正文真实矛盾。

## 反 AI 腔（不能让人一眼看出是 AI 写的）

### 体检分

`lint`/`prose` 输出 `stats.aiVoice`：`score`(0-100) / `weightedHitsPer1000` / `hitsPer1000` / `strongHits` / `weakHits` / `templateHits` / `rhythmCV` / `paragraphCV` / `tagRatio` / `emotionPer1000` / `translationese` / `summaryEndings` / `lineRefs`。

- 默认阈值（`project.json.style.thresholds`，可按文体调整）：`minVoiceScore: 60`、`maxWeightedClichesPer1000: 1.5`、`minSentenceLengthCV: 0.35`、`maxDialogueTagRatio: 0.7`、`maxEmotionPer1000: 1.2`、`maxTemplateHits: 3`。默认值面向中文长篇常见密度；**真实人类语料基线校准**登记为 v1.1 follow-up（正文「不误杀」以人类负控流程为准，不做绝对承诺）。
- 规则：`VOICE-002` 词密度超限、`VOICE-003` 句式模板、`VOICE-004` 句长节奏过匀、`VOICE-005` 段落长度过匀、`VOICE-006` 对话标签单一、`VOICE-007` 情绪直给、`VOICE-008` 段末升华、`VOICE-009` 翻译腔、`VOICE-010` POV 疑似越界、`VOICE-011` 综合分不达标。
- **fail-closed**：体检内部异常时按 `score = 0` 处理并产出 `VOICE-011 MAJOR`（不存在「分析失败 = 满分放行」）；遇到时把异常信息贴进报告，不要重试到通过。
- 英文项目（`lang: en`）：基础强/弱/模板词表可用，但 `VOICE-006/007/008/009` 的英文词表尚不完整（登记 v1.1），英文稿建议以人类负控 + 语义 7 查为主。

### 机器层抓什么

强信号套话（`嘴角勾起`、`闪过一丝`、`瞳孔骤缩`、`深吸一口气`、`空气仿佛凝固`、`心中一沉`、`说不清道不明`…）、弱信号（`突然`、`瞬间`、`仿佛`、`某种`、`意识到`、`缓缓`…）、句式模板（`不是……而是……`、`这一刻`、`就在这时`…）、翻译腔正则、情绪直给词、段末升华句、对话标签单一。全表与权重见 [`references/anti-ai-voice.md`](references/anti-ai-voice.md)。

### 语义层还要查（7 查）

1. **翻译腔**：「在……的过程中」「对于……来说」这类英文句法残留；
2. **过度解释**：把读者能推出来的东西再解释一遍；
3. **情绪直给**：用「愤怒/悲伤」代替动作与生理反应；
4. **对话同质**：所有角色一个腔调、每句都完整工整；
5. **万能过渡**：「与此同时」「与此同时另一边」式平推；
6. **模板结尾**：每段/每章都升华、都点题；
7. **叙述视角滑动**：为了抒情滑进全能视角。

### 改写协议（定点改，不整章重写）

1. 只看 `lineRefs` 点名的行，一次改 3-5 处；
2. **保留事实**：人物/地点/时间/因果/信息量不许变；必须变 → 回写 frontmatter 并重跑门禁；
3. 三种常用手法：**动作外化**（把「他很愤怒」改成手上的动作/呼吸/声音）、**删解释**（删掉读者已经能懂的那句）、**改节奏**（长句拆短、短句间插一个长句，打破均匀感）；
4. 改完**重扫**，直到 `score ≥ minVoiceScore` 且 `strongHits = 0`；
5. 报告里贴「改前/改后分数 + 改了哪几行」，禁止口述「已去掉 AI 味」。

### 人类负控（防误杀，必做一次）

拿 **≥2 段公认的人类写作**（不同作者 / 不同文体，各 ≥500 字）跑 `prose`：每段 **≥70 分且 `strongHits = 0`** 才算阈值安全。不达标 → 说明阈值过严，报告并给出调参建议；禁止为了「让 AI 腔样例更低分」而把好文误杀。注意：负控样本必须是**真实人类写作**（已出版/公版/用户旧稿），不要用自己现场仿写的段落充当负控。

### 三步调参出口（误报时按序）

1. 调 `project.json.style.thresholds`（记录原因与前后值）；
2. 用 `reports/exemptions.json` 定点豁免（**必填 `reason`**；`--strict` 下 BLOCKER/MAJOR 不可豁免）；
3. 仍误报 → 报告用户裁定；**禁止**静默改引擎默认词表（那会让所有项目一起失真）。

## 严重度与门禁

| 级别 | 含义 | 门禁 |
|---|---|---|
| `BLOCKER` | 硬矛盾（空间/时间/物理/知识/死者/元信息） | 必须清零 |
| `MAJOR` | 逻辑弱化或体验硬伤（伏笔超期/字数偏离/反 AI 腔超标） | 必须清零 |
| `MINOR` | 局部问题（称谓/节奏/章级不一致） | 记录，`--strict` 时清零 |
| `NIT` | 风格建议（段落均匀度） | 记录 |
| `INFO` | 提示（POV 疑似、metadata-only） | 记录 |

**门禁判定 = 命令 + 退出码 + 报告文件，三者缺一不算过**：

```sh
node "$NOVEL_LINT" lint "<项目>" --chapter <N> --json --report "<项目>/reports/gate-ch-<N>.md"
echo "exit=$?"   # 0 = 过闸；1 = 未过；2 = 用法/IO 错误
```

- **`--chapter N` 作用域**：findings = 本章文件 + **全部全局（`bible/**`、`outline/**`、`project.json`）级发现**——账本/大纲级 BLOCKER 同样拦本章门禁（不会「章内干净就放行」）；**例外**：计划型断言 `OUT-003`/`FACT-004`（大纲已建计划但章节未写 / 伏笔回收指向计划章）不并入章门禁（全量 `lint` 仍报，写完即消）。
- **报告写盘失败 → 退出码 2 + stderr**（不得静默 PASS）：退出码 0 且 `reports/gate-ch-<N>.md` 存在 → 本章过闸；
- 退出码 1 → 按 `fixRoute` 修复后重跑（同一章最多 3 轮；3 轮不过 → 报告用户并停，不得绕过）；
- `--strict` 用于终稿/投稿前的全量体检（MINOR 也阻塞）。

## 上下文预算

- **写前 ≤5 个文件**：`project.json`、本章大纲卡、上一章摘要、cast 人物卡、相关 bible 片段；不要读全库。
- 每 10 章做一次深度压缩：更新 `summaries.md`、合并 `style/style.md` 的风格结论、检查已回收伏笔清单。
- 需要更多上下文 → 用 `context` 命令生成结构化包，而不是把 `chapters/` 全读进来。
- 长篇（>20 章）建议用 goal 工具建一个聚合目标（`create_goal`），每章过闸后 checkpoint；或按 `team` 技能派独立 verifier 通道（名册可用时）。

## 命令速查

```sh
# 0) 引擎规则表（自检）
node "$NOVEL_LINT" rules --json

# 1) 建项目
node "$NOVEL_LINT" init "<项目目录>" --title "雨停之前" --genre 悬疑

# 2) 门禁（每章必跑；默认写 <项目>/reports/last.json + last.md）
node "$NOVEL_LINT" lint "<项目目录>" --chapter 3 --json --report "<项目目录>/reports/gate-ch-3.md"
node "$NOVEL_LINT" lint "<项目目录>" --strict          # 终稿全量体检

# 3) 状态 / 下一章上下文包（context 不要求本章文件已存在）
node "$NOVEL_LINT" status "<项目目录>" --json
node "$NOVEL_LINT" context "<项目目录>" --chapter 4 --json

# 4) 独立正文体检（不需要项目结构；用来试算 AI 腔与元信息）
node "$NOVEL_LINT" prose "<项目目录>/chapters/ch-003.md" --json
```

退出码：`0` 过（无 BLOCKER/MAJOR；`--strict` 时也无 MINOR）｜`1` 未过｜`2` 用法/IO 错误。

## 输出契约

每次给用户交付时必须包含：

1. **本章交付**：章节路径 + 字数 + 档位 + 本章推进/回收的伏笔；
2. **门禁证据**：实际执行的命令、退出码、`reports/gate-ch-<N>.md` 路径，以及各级别计数（BLOCKER/MAJOR/MINOR/NIT）；
3. **发现清单**：按六维分组，每条给 `rule id + 位置 + 一句人话说明 + 修复路由`；不得只说「已检查」；
4. **反 AI 腔**：`score` 改前/改后、命中词条（带行号）、改写了哪几行；
5. **账本变更**：新增/变更的 fact、hook 状态、人物状态（谁受伤/谁拿到什么/谁知道了什么）；
6. **下一章钩子**：一句悬念 + 下一章场景卡草案。
7. **降级声明**（若发生）：引擎不可用/人工校验/未覆盖维度，必须显式写。

## 最终清单

- [ ] 前置检查通过（引擎路径解析 + node 版本 + 项目定位），或已按降级口径留痕
- [ ] 五要素确认（读者/风格/禁区/自动化/规模）已写进 `project.json`
- [ ] `hardRules` ≥3 条且可判定；`bible/characters.jsonl` 每卡含 goal/voice/abilities/limits
- [ ] 本章大纲卡存在且含 goal/conflict/outcome
- [ ] 只写了**一章**；正文无元信息；每个角色只用「此刻已知」
- [ ] 场景 frontmatter 完整（时间/地点/在场/actions/uses/knowledge/items/hooks）
- [ ] `lint --chapter N` 退出码 0；报告已落盘；BLOCKER/MAJOR 清零
- [ ] 反 AI 腔 `score ≥ minVoiceScore` 且 `strongHits = 0`；人类负控（**≥2 段真实人类写作**）已验证过（首次）
- [ ] 语义审校 7 条已过；长篇已做反向抽取复核（每 5 章/每卷）
- [ ] `summaries.md` 已追加本章摘要；账本（fact/hook/人物状态）已更新
- [ ] 交付含命令 + 退出码 + 计数 + 下一章钩子（不得口述「已通过」）

## 参考文档导航

| 你想… | 读 |
|---|---|
| 查某条规则的判定/修复路由/判例 | [`references/logic-rules.md`](references/logic-rules.md) |
| 填 frontmatter / 建 bible / YAML 写法 | [`references/story-state-schema.md`](references/story-state-schema.md) |
| 去 AI 味 / 词表 / 评分公式 / 改写样例 | [`references/anti-ai-voice.md`](references/anti-ai-voice.md) |
| 结构模板 / 场景卡 / 伏笔 / 对话 / 与同类工具对比 | [`references/craft-patterns.md`](references/craft-patterns.md) |
| 可选能力（团队/子代理）降级 | 本包 `docs/capability-matrix.md` |
