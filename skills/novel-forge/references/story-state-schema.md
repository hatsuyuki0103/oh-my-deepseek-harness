# 故事状态 schema 落地手册

> 本手册是 PRD §3（项目布局）与 §4（冻结 schema）的**操作版**：写项目、填 frontmatter、配阈值都照这里做。
> 铁律：**章节 frontmatter 是唯一事实源**；`bible/hooks.jsonl` 与 `outline/outline.json` 只是断言（写作前的计划）；世界层注册表（人物/地点/事实/硬规则）是**引用白名单**——正文只能引用，不能自创。

## 1. 项目目录树（冻结）

默认根：`.omx/novel/<slug>/`，**相对用户 cwd**。所有命令显式接收项目目录，不做隐式默认猜测。

```
project.json                 # 配置 + 世界硬规则（§2）
bible/world.md               # 世界观散文（人读，不参与校验）
bible/characters.jsonl       # 人物卡，一行一个角色（§3）
bible/space.json             # 地点图（§4）
bible/facts.jsonl            # 事实注册表（§5）
bible/hooks.jsonl            # 伏笔注册表：问题 + 状态覆盖位（§6，断言层）
outline/outline.json         # 卷章/场景卡计划（§7，断言层）
chapters/ch-001.md …         # 章节：YAML-lite frontmatter + 正文（§8）
summaries.md                 # 每章摘要（上下文打包用，§10）
style/style.md               # 文风指南（人读；阈值在 project.json）
reports/last.json            # 最近一次 lint 的机器报告（默认产物，无时间戳）
reports/last.md              # 最近一次 lint 的人读报告（默认产物，无时间戳）
reports/exemptions.json      # 豁免（可选；§12）
exports/manuscript.md        # 导出合并稿（export 产出）
```

**事实源优先级（冻结）**

1. 章节 frontmatter = **唯一事实源**：时间线、在场、道具、知识、伤势、资源、场景级伏笔埋设/回收，全部由 frontmatter 按章节序 replay 派生。
2. `hooks.jsonl` / `outline.json` = **断言层**：写作前的计划与问题注册。与派生值不一致 → 提示改断言（不覆盖真源）。
3. 世界层注册表 = **白名单**：正文标注引用它们；未注册的实体由规则直接拦下。

**标注不是让用户填表**：标注由写作 Agent 在写章时填写；长篇每 5 章做一次**反向抽取复核**（独立上下文从正文反抽场景元信息，与 frontmatter 对比，差异必裁定，留 `reports/audit-ch-XXX.md`）。零标注路径同样存在：`prose` 命令只读正文即可给反 AI 腔体检分 + 元信息卫生，不需要项目结构。

## 2. `project.json`

### 2.1 全字段

| 字段 | 类型 | 必填 | 消费规则 | 说明 |
|---|---|---|---|---|
| `schema` | string | 是 | 结构维 | 必须 `novel-forge/v1`；否则阻塞 |
| `title` | string | 是 | 报告标题 | 书名 |
| `slug` | string | 否 | — | 目录/导出标识，kebab |
| `lang` | string | 否 | 词表选择 | `zh-CN`（默认）/`en`；`en` 用英文套话表 |
| `genre` | string[] | 否 | 上下文包 | 类型标签 |
| `audience` | string | 否 | 上下文包 | 目标读者 |
| `viewpoint` | object | 否 | 声音维 | `{character, mode, tense}`；仅 `character` 被消费（POV 越界检察），`mode`/`tense` 是 metadata-only |
| `chapterWords` | int | 否 | 结构维（字数） | 默认 3000 |
| `chapterWordsTolerance` | number | 否 | 结构维（字数） | 默认 0.2（±20%） |
| `staleHookChapters` | int | 否 | 伏笔维 | 默认 5；`hook.staleAfter` 为 null 时的缺省 |
| `storyYear` | int | 否 | 时间维（年龄） | 当代叙事年份 |
| `daylight` | object | 否 | 时间维（光照） | `{sunrise, sunset}`，`"HH:MM"` |
| `hardRules` | array | 否 | 物理维 | `[{id, statement, scope}]`；`id` 自定义（本文用 `hr1`） |
| `envRules` | array | 否 | 物理维 | `[{env, requiresAny[], message}]` |
| `style.forbiddenWords` | string[] | 否 | 声音维 | 命中权重 1.0（见 `anti-ai-voice.md`） |
| `style.thresholds` | object | 否 | 声音维 | 6 个阈值键（§11） |

- `init` 写入上表全部字段；`lint` 对缺失字段用同值默认，**不报错**；未知字段忽略。
- `schema` 不是 `novel-forge/v1` → 结构维阻塞。

### 2.2 完整示例（「雨停之前」）

```json
{
  "schema": "novel-forge/v1",
  "title": "雨停之前",
  "slug": "yu-ting-zhi-qian",
  "lang": "zh-CN",
  "genre": ["悬疑"],
  "audience": "网文读者",
  "viewpoint": { "character": "lin-jin", "mode": "third-limited", "tense": "past" },
  "chapterWords": 3000,
  "chapterWordsTolerance": 0.2,
  "staleHookChapters": 5,
  "storyYear": 2026,
  "daylight": { "sunrise": "06:30", "sunset": "18:00" },
  "hardRules": [
    { "id": "hr1", "statement": "本世界没有超自然力量，一切异常必须有物理解释", "scope": "world" }
  ],
  "envRules": [
    { "env": "underwater", "requiresAny": ["scuba", "水肺"], "message": "水下场景需要装备或能力声明" }
  ],
  "style": {
    "forbiddenWords": [],
    "thresholds": {
      "maxWeightedClichesPer1000": 1.5,
      "minVoiceScore": 60,
      "minSentenceLengthCV": 0.35,
      "maxDialogueTagRatio": 0.7,
      "maxEmotionPer1000": 1.2,
      "maxTemplateHits": 3
    }
  }
}
```

## 3. `bible/characters.jsonl`

**一行一个角色，严格 JSONL**（不许一行多对象、不许尾逗号、不许注释）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | kebab、唯一、必填；这是所有 frontmatter 引用的唯一键 |
| `name` | string | 必填；正文点名的主要写法 |
| `aliases` | string[] | 别名/尊称，用于死者提及审计与称谓判定 |
| `status` | enum | `alive`（默认）/`dead`/`missing`/`absent` |
| `role` / `age` / `birthYear` | — | 角色定位与年龄；`age = storyYear - birthYear`（容差 1） |
| `goal` / `fear` | string | 欲望与恐惧；长篇完整性检查项 |
| `voice` | object | `{sentence, tics[], taboo[]}` 声纹；缺 → 完整性提示 |
| `appellations` | object | `{<speakerId>: [允许称谓]}`；称谓白名单 |
| `abilities` / `limits` | string[] | 能力/短板；`actions[].ability` 必须命中 `abilities` |
| `resources` | object | `{<kind>: <初始值>}`；**只统计声明过的 kind** |
| `knowledgeDefault` | string[] | 开局就知道的 fact id |
| `diedAt` | int/null | 死亡发生章（背景死亡可 null 并在 notes 说明） |
| `notes` | string | 自由备注 |

示例：

```jsonl
{"id":"lin-jin","name":"林烬","aliases":["林队"],"status":"alive","role":"主角","age":34,"birthYear":1992,"goal":"查清父亲失踪真相","fear":"重蹈父亲覆辙","voice":{"sentence":"短句为主","tics":["啧"],"taboo":["求人"]},"appellations":{"xu-an":["阿烬"]},"abilities":["刑侦推理"],"limits":["不擅长格斗"],"resources":{"ammo":6,"money":1200},"knowledgeDefault":["f1"],"diedAt":null,"notes":"前刑警"}
{"id":"xu-an","name":"徐岸","aliases":["小徐"],"status":"alive","role":"对手","age":29,"birthYear":1997,"goal":"掩盖父亲旧案","fear":"身份暴露","voice":{"sentence":"绕圈子","tics":["笑"],"taboo":["父亲"]},"appellations":{"lin-jin":["林队"]},"abilities":["开锁"],"limits":["怕水"],"resources":{},"knowledgeDefault":[],"diedAt":null,"notes":""}
{"id":"lin-cheng","name":"林承","aliases":["老林"],"status":"dead","role":"父亲","age":null,"birthYear":null,"goal":"守住码头旧账","fear":"连累家人","voice":{"sentence":"少言","tics":[],"taboo":["账本"]},"appellations":{"lin-jin":["爸"]},"abilities":[],"limits":[],"resources":{},"knowledgeDefault":[],"diedAt":null,"notes":"2019 年失踪，背景死亡"}
```

## 4. `bible/space.json`

```json
{
  "places": [
    { "id": "warehouse-3f", "name": "三号仓三层", "region": "港区", "aliases": ["3号仓"], "light": "dim" },
    { "id": "pier-7", "name": "七号码头", "region": "港区", "aliases": ["七号"], "light": "dim" },
    { "id": "lin-home", "name": "林烬家", "region": "老城区", "aliases": [], "light": "day" }
  ],
  "edges": [
    { "from": "warehouse-3f", "to": "pier-7", "mode": "walk", "minutes": 12, "bidirectional": true },
    { "from": "warehouse-3f", "to": "lin-home", "mode": "drive", "minutes": 25, "bidirectional": true }
  ]
}
```

- `edges[].minutes` 是**最短通行耗时**的输入；`bidirectional: false` 表示单向（如单行隧道、上锁的门）。
- 无连通路径 + 相邻场景异地 = 空间维阻塞；通行耗时判定优先于「文学上说得通」。
- 同地点 = 0 分钟；不写边也能同地点连场（这是合法的）。

## 5. `bible/facts.jsonl`

```jsonl
{"id":"f1","statement":"父亲的怀表停在 3:17","public":false,"truth":true,"revealAt":null}
{"id":"f2","statement":"三号仓在 2019 年后归港务局代管","public":true,"truth":true,"revealAt":null}
{"id":"f3","statement":"徐岸的父亲 2019 年死在七号码头","public":false,"truth":true,"revealAt":3}
{"id":"f4","statement":"怀表是林烬父亲留给他的唯一遗物","public":false,"truth":true,"revealAt":null}
```

- `public: true` = 世界公开事实，所有人默认知道（台词维的合法路径之一）。
- `truth: false` = 书中人物信以为真但实际为假（反转素材；不影响知识判定）。
- `revealAt` = 计划揭示章（断言）；指向不存在的章 → 事实维 MAJOR。
- `statement` 是**一句话事实**，不是描述文；同一 id 不许两种说法。

## 6. `bible/hooks.jsonl`（断言层）

```jsonl
{"id":"h1","question":"谁调换了怀表","plant":1,"pay":3,"status":"PAID","staleAfter":null,"notes":"第 3 章收回"}
{"id":"h2","question":"徐岸那晚为什么去三号仓","plant":3,"pay":null,"status":"OPEN","staleAfter":null,"notes":"第二卷前回收"}
```

- `plant` / `pay` 是**断言值**（真源在章节 frontmatter）：只在计划层声明「打算第几章埋、第几章收」。
- `status ∈ OPEN | PAID | BROKEN | DEFERRED`，缺省 `OPEN`；显式 `BROKEN/DEFERRED` 但正文仍回收 → 伏笔维 MAJOR。
- `staleAfter` 缺省取 `project.staleHookChapters`；`当前最大章 - plant > staleAfter` 且仍 `OPEN` → 超期。
- `pay: null` 是合法值（未回收），不是错误。

## 7. `outline/outline.json`（断言层）

```json
{
  "chapters": [
    {
      "chapter": 3,
      "title": "雨停之前",
      "scenes": [
        {
          "id": "ch3-s1",
          "place": "warehouse-3f",
          "cast": ["lin-jin", "xu-an"],
          "goal": "逼问怀表下落",
          "conflict": "徐岸撒谎",
          "outcome": "林烬夺走怀表，徐岸逃走",
          "hooks_plant": ["h2"],
          "hooks_pay": ["h1"]
        }
      ]
    }
  ]
}
```

- 场景卡必须齐 `goal` / `conflict` / `outcome`（缺任一 → 大纲维 MINOR）。
- 卡里的 `place`/`cast`/`hooks_*` 是引用白名单：未注册实体 → 大纲维阻塞。
- 正文写歪了以正文为准（改大纲断言）；计划引用了不存在的章节 → 大纲维 MAJOR。

## 8. 章节 frontmatter（冻结）

### 8.1 章节级字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `chapter` | int | 是 | 章序号；缺 → 解析类阻塞 |
| `title` | string | 否 | 章名 |
| `pov` | string | 否 | 视角角色 id |
| `day` | int | 否 | 章节级叙事日；应与首个场景 `day` 一致 |
| `mentions` | string[] | 否 | 本章正文**被提及/被回忆**的死者 id 白名单；**不代表在场**。正文出现死者姓名/别名而未登记 → 人物维 MINOR；登记后不再报，也不会把死者拉进 `cast` |

### 8.2 场景级字段

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `id` | string | 必填 | 场景 id（建议 `ch<N>-s<M>`），与大纲卡对齐 |
| `place` | string | 必填 | 地点 id（必须已注册） |
| `day` / `clock` | int / `"HH:MM"` | — | 叙事日与钟点；时间绝对量 = `(day-1)*1440 + clockMinutes` |
| `minutes` | int | 0 | 场景时长；时间窗 = `[start, start+minutes]` |
| `cast` | string[] | — | 在场角色；场景内所有 `who` 必须在此 |
| `light` | enum | — | `dawn|day|dusk|night|dim`，与 `clock`+`daylight` 对照 |
| `flashback` | bool | false | 回忆场景的唯一合法时间倒流出口 |
| `env` | string | — | 特殊环境（匹配 `envRules.env`，如 `underwater`） |
| `actions` | array | — | `[{who, kind, intensity?, ability?}]`；`kind ∈ search|run|climb|fight|swim|lift|drive|talk|observe|use|other`，`intensity 0-3`（默认 1） |
| `uses` | array | — | `[{who, fact}]` **对话/决策中实际使用**的事实 → 知识边界（最容易与 `knowledge` 混） |
| `knowledge` | array | — | `[{who, fact, source?}]` 本场景**新获知**；机器只判「证据在不在」：fact 不在本场景 `facts[]` **且** `source` 为空/缺省 → 来源不可追溯（MAJOR，见 `logic-rules.md` 事实维）；与角色是否首次出场无关 |
| `appellations` | array | — | `[{from, to, as}]` 称谓；`as` 必须在对方白名单 ∪ 姓名 ∪ 别名 |
| `injuries` | array | — | `[{who, part, delta}]`；负=受伤，正=愈合；按 (who, part) 累加净伤势 |
| `items` | array | — | `[{id, op, from?, to?, name?, place?}]`；`op ∈ create|transfer|destroy|lose|find` |
| `resources` | array | — | `[{who, kind, delta}]`；**只统计角色卡声明过的 kind** |
| `facts` | string[] | — | 场景引用的已注册事实 |
| `hooks_plant` / `hooks_pay` | string[] | — | 场景级伏笔埋设/回收（真源） |
| `violates` | string[] | — | 违反的硬规则 id；非空时 `justification` 必须非空 |
| `justification` | string | "" | 与 `violates` **成对**；非空才解除物理维硬规则阻塞 |

### 8.3 完整示例：`chapters/ch-003.md`

```markdown
---
chapter: 3
title: 雨停之前
pov: lin-jin
day: 3
mentions: [lin-cheng]
scenes:
  - id: ch3-s1
    place: warehouse-3f
    day: 3
    clock: "21:40"
    minutes: 20
    cast: [lin-jin, xu-an]
    light: night
    actions:
      - {who: lin-jin, kind: search, intensity: 1}
    uses:
      - {who: lin-jin, fact: f1}
    knowledge:
      - {who: lin-jin, fact: f3, source: 徐岸说漏嘴}
    appellations:
      - {from: xu-an, to: lin-jin, as: 林队}
    injuries:
      - {who: xu-an, part: left-arm, delta: -2}
    items:
      - {id: item-compass, op: transfer, from: xu-an, to: lin-jin}
    resources:
      - {who: lin-jin, kind: ammo, delta: -2}
    facts: [f2]
    hooks_plant: [h2]
    hooks_pay: [h1]
    violates: []
    justification: ""
    flashback: false
---
雨在九点四十分停了一下，又下起来。

林烬推开门的时候，徐岸正坐在货架底下。铜壳怀表在他手边，表盖开着。
「林队。」徐岸说，声音有点干，「你也来了。」
林烬没答。他把手电横在掌心，光压低，照着徐岸的左臂。袖子上有血，凝成一条。
「林承当年也来过这里。」徐岸说，「你爹的账，不止你一个人在查。」
林烬把怀表拿起来。表针停在三点十七。
```

> 上面只是**片段**：真实一章正文至少 2400 字（`chapterWords` 3000 ± 20%），否则结构维会报字数偏离。片段的用途是展示 frontmatter 与正文的对应关系——正文里出现的「林承」必须在 `mentions` 登记，这就是 v1.2 的死者提及审计。

### 8.4 前两章 frontmatter（对齐示例）

```markdown
---
chapter: 1
title: 父亲的怀表
pov: lin-jin
day: 1
mentions: [lin-cheng]
scenes:
  - id: ch1-s1
    place: lin-home
    day: 1
    clock: "09:00"
    minutes: 40
    cast: [lin-jin]
    light: day
    actions:
      - {who: lin-jin, kind: search, intensity: 1}
    uses:
      - {who: lin-jin, fact: f1}
    hooks_plant: [h1]
    violates: []
    justification: ""
---
```

```markdown
---
chapter: 2
title: 码头
pov: lin-jin
day: 2
scenes:
  - id: ch2-s1
    place: pier-7
    day: 2
    clock: "20:00"
    minutes: 30
    cast: [lin-jin, xu-an]
    light: night
    actions:
      - {who: lin-jin, kind: talk, intensity: 1}
    items:
      - {id: item-compass, op: create, to: xu-an, name: 铜壳怀表}
    hooks_plant: []
    hooks_pay: []
    violates: []
    justification: ""
---
```

**一致性自查**：第 2 章首次让徐岸出场（`cast` 有戏）；第 2 章 `create` 把怀表交给徐岸持有，第 3 章才能 `transfer from: xu-an`；第 3 章 `knowledge` 的每条要么带非空 `source`（本例「徐岸说漏嘴」）、要么 fact 在本场景 `facts[]` 声明；第 1 章埋的伏笔第 3 章回收（`pay ≥ plant`）。

## 9. YAML-lite 子集（frontmatter 解析契约）

**支持且仅支持**：

- 首行 `---`，单独一行 `---` 结束；之后为正文。输入先归一化 `\r\n|\r → \n`。
- 键值 `key: value`；值 ∈ 整数 / 浮点 / `true|false|null` / 裸字符串 / `"双引号"` / `'单引号'`。**引号内可含 `:`**。
- 行内数组 `[a, b, "c"]`（含空 `[]`）；行内对象 `{k: v, k2: "v2"}`。
- 嵌套：2 空格缩进的 map 或 `- ` 列表；列表项可为标量、`- key: value` 开头的 map（后续缩进行补键）、或行内对象。
- 整行注释（trim 后以 `#` 开头）忽略；空行忽略。
- 重复键：后者覆盖，产生 INFO 提示（不单独成规则）。
- 嵌套深度上限 **6**；超出、tab 缩进、块标量 `|`/`>`、锚点 `&`/`*`、多文档 `---` 块 → 解析类**阻塞**发现（带行号），**不抛异常**。

### 9.1 正例（14 条，全部可解析）

```yaml
chapter: 3                              # 整数
title: 雨停之前                          # 裸中文串
title: "雨停之前: 第一幕"                # 双引号，内含冒号
title: '雨停之前'                        # 单引号
clock: "21:40"                          # 引号内冒号（最常见的坑）
mentions: [lin-cheng, xu-an]            # 行内数组
mentions: []                            # 空数组
minimap: {who: lin-jin, kind: search, intensity: 1}   # 行内对象
flashback: false                        # 布尔
justification: ""                       # 空字符串
nested:                                 # 嵌套 map（2 空格）
  a: 1
  b:
    - x
    - y
# 整行注释：忽略
```

### 9.2 反例（6 条 → 解析类阻塞，带行号，不抛异常）

| # | 反例 | 原因 |
|---|---|---|
| 1 | `\tplace: warehouse-3f` | tab 缩进（只允许 2 空格） |
| 2 | `justification: \|` + 缩进正文 | 块标量不支持 |
| 3 | `title: &anchor 雨停之前` | 锚点不支持 |
| 4 | 只有开头 `---` 没有结束 `---` | frontmatter 未闭合，正文被吞 |
| 5 | 七层嵌套 `a: b: c: …` | 嵌套深度 > 6 |
| 6 | 结束 `---` 之后又出现单独 `---` 分隔 | 多文档块不支持 |

### 9.3 常见填错（与解析无关的语义错）

| 现象 | 错在哪 | 正确做法 |
|---|---|---|
| 死者出现在 `cast` | 把「被提及」当「在场」 | 用 `mentions`；真需要出场标 `flashback: true` |
| `uses` 里写新获知事实 | 知识与使用混用 | 新获知进 `knowledge`，之后场景才能 `uses` |
| `knowledge` 没写 `source`，fact 又不在本场景 `facts[]` | 来源不可追溯（v1.3 口径；旧「没出过场」判法已废弃） | 补 `source`（如「亲眼所见」），或把 fact 加进本场景 `facts[]` |
| `violates: [hr1]` 但 `justification: ""` | 成对字段只填一半 | 要么删违规描写，要么补理由并写进正文 |
| `resources` 扣了未声明的 kind | 角色卡没建模这个资源 | 先在角色卡 `resources` 声明初始值 |
| `items` 的 `transfer` 来源不对 | `from` ≠ 当前持有者 | 先 `create`/`find` 设定持有者，再 `transfer` |
| `chapter: ch-003` | 字段要整数不是文件名 | `chapter: 3` |
| `id` 用中文或驼峰 | 人物 id 必须 kebab | `lin-jin` / `xu-an` |
| `light: dark` | 枚举固定 5 值 | `dawn|day|dusk|night|dim` |
| `kind: fight` 但角色 `abilities` 没有格斗 | 能力越界 | 补 `abilities` 或改 `kind`/`intensity` |
| 章节 `day: 3` 但首场景 `day: 2` | 章节级与场景级不一致 | 统一到场景值 |
| `day：3`（全角冒号） | YAML-lite 只认半角冒号 | 改半角 `:` |
| 行内对象用中文逗号 `{who：lin-jin，kind：search}` | 同上 | 半角 `,` 与 `:` |
| JSONL 一行两个对象 | 每行必须恰一个 JSON 对象 | 一行一个 |
| JSON 尾逗号 `{"a":1,}` | 非法 JSON | 删尾逗号 |

## 10. `summaries.md`

格式：每章一个小节 + 1–3 句摘要，供下一章上下文打包。

```markdown
## ch-001 父亲的怀表
林烬在旧屋收拾遗物，怀表不见，只留下空表盒。他在盒底发现一张 2019 年的码头收据。

## ch-002 码头
林烬到七号码头打听，徐岸首次出现并承认见过怀表，随后带走一只铜壳怀表。

## ch-003 雨停之前
林烬在三号仓逼问徐岸，夺回停走的怀表；徐岸受伤逃走，透露林承当年也来过这里。
```

缺章摘要 → 结构维 MINOR（不拦门禁，但上下文包会缺料）。

## 11. `init` 模板与阈值调节

### 11.1 `init` 语义（冻结）

```sh
node "$NOVEL_LINT" init <dir> --title "雨停之前" [--slug yu-ting-zhi-qian] [--lang zh-CN] [--genre 悬疑] [--force]
```

`$NOVEL_LINT` 按 SKILL.md 前置检查**三级解析**：`$NOVEL_LINT` 环境变量 → `<技能目录>/../../lib/novel-lint.mjs`（技能目录上两级）→ `./lib/novel-lint.mjs`。外部用户 cwd 是小说目录，裸相对路径 `lib/…` 必然失败；本书其余命令同此约定。

- **只创建缺失文件，绝不覆盖已存在文件**。返回 `{ok, dir, created[], skipped[], reason}`。
- 空目录 → 退出码 0，按 §1 布局生成全部脚手架 + `project.json` 全字段。
- 非空目录且无 `--force` → **不写任何文件**、退出码 2。
- `--force` = 补缺失项（`created[]` 只含补齐项，`skipped[]` 列出已存在项）；**已有文件字节不变**（丢稿回归的验收点）。
- 不得在插件包检出内跑 `init`；demo 在会话工作区或用户小说目录里做。

### 11.2 阈值调节（配置消费规则）

| `project.json` 键 | 默认 | 消费者 | 什么时候调 |
|---|---|---|---|
| `chapterWords` / `chapterWordsTolerance` | 3000 / 0.2 | 结构维字数 | 本书章长规划不同（短章集/长卷） |
| `staleHookChapters` | 5 | 伏笔超期 | 慢热长篇允许更久不收 |
| `storyYear` | 当前年 | 年龄一致性 | 年代剧必须显式写 |
| `daylight` | 06:30 / 18:00 | 光照一致性 | 不同纬度/季节/异世界 |
| `maxWeightedClichesPer1000` | 1.5 | 声音维陈词 | 文体适配（见 `anti-ai-voice.md` §9）；默认值上调以降低中文叙事弱信号误杀 |
| `maxTemplateHits` | 3 | 声音维模板 | 同上 |
| `minSentenceLengthCV` | 0.35 | 声音维节奏 | 短句文体（硬汉派）可降到 0.30 |
| `maxDialogueTagRatio` | 0.7 | 声音维标签 | 对话密集文体可放宽 |
| `maxEmotionPer1000` | 1.2 | 声音维情绪 | 言情可略放宽 |
| `minVoiceScore` | 60 | 声音维总分 | 先跑人类负控再决定，不许拍脑袋 |

调参纪律：**先调阈值并记录原因 → 再考虑豁免 → 仍误报交用户裁定**；禁止静默改引擎默认词表。记录写 `reports/style-tuning.md`（模板见 `anti-ai-voice.md` §9.4）。默认值可用 `project.json.style.thresholds` 调整；**真实人类语料基线校准登记为 v1.1 follow-up**。

## 12. 豁免文件 `reports/exemptions.json`（可选）

```json
{
  "exemptions": [
    {
      "rule": "VOICE-004",
      "locator": "ch3-s1",
      "messageIncludes": "句长",
      "reason": "硬汉派短句，作者确认",
      "scope": "ch3"
    }
  ]
}
```

- `rule` 必等；`locator` 缺省匹配任意，否则必须相等；`messageIncludes` 缺省任意，否则 finding 说明必须包含该子串；`scope` 缺省/章号/locator 前缀，命中任一即匹配。
- `reason` **必填**；缺 reason 整条无效，计入「跳过」。
- `--strict` 下 BLOCKER/MAJOR **不可豁免**（跳过并计数）。
- 豁免只对可协商项使用；拿豁免当门禁橡皮擦 = 自欺。

## 13. 交付前自查

- [ ] `project.json.schema` 正确；所有账本 JSONL 一行一对象、可解析；
- [ ] 章节文件名 `ch-001.md` 形式、序号连续；
- [ ] 每个场景的 `who` 都在 `cast`；`cast` 里的人当场真有戏；
- [ ] 时间单调（回忆标 `flashback`）；地点已注册且通行耗时够；
- [ ] 道具操作链完整（create/find → transfer → destroy/lose）；
- [ ] `resources` 只动已声明的 kind；伤势与动作强度匹配；
- [ ] 每句关键台词用到的 fact 都「此前已获知」；
- [ ] 每条 `knowledge` 要么带非空 `source`，要么 fact 在本场景 `facts[]` 声明；
- [ ] 死者出现只走 `mentions` 或 `flashback`；
- [ ] `hooks_plant/pay` 与 `hooks.jsonl` 断言一致且回收章 ≥ 埋设章；
- [ ] 大纲场景卡三字段齐全，与 frontmatter 场景 id 对齐；
- [ ] 每 5 章做一次反向抽取复核并留 `reports/audit-ch-XXX.md`。
