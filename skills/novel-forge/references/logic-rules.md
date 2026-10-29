# 逻辑规则全表（62 条）

本文件是 `lib/novel-lint.mjs` 导出的 `RULES` 数组的**人类可读全表**，也是「六维逻辑闸」的条款真源。
**契约**：本文件出现的规则 id 集合必须与 `RULES` 的 id 集合**双向等值**——`test/skills.test.mjs` 逐 id 比对，本文件多一条是红，少一条也是红（`deepEqual` + 反例自测）。

> 改规则 = 同一提交内改三处：`RULES`（引擎）/ 本文件 / `test/novel-lint.test.mjs` 的 `COVERED ∪ NOT_YET` 覆盖台账。只改一处视为引入契约漂移。

## 0. 读表约定

### 0.1 级别（severity）

| 文档缩写 | 全称 | 门禁含义 | 退出码影响 |
|---|---|---|---|
| B | `BLOCKER` | 硬矛盾（死人说话、瞬移、道具穿帮、AI 腔门禁失败）：必须当场修 | 非 0（1） |
| M | `MAJOR` | 明显错误但可带病推进；**默认不允许** | 非 0（1） |
| m | `MINOR` | 卫生问题；`--strict` 下才拦 | 仅 `--strict` 时为 1 |
| n | `NIT` | 风格建议，可选修 | 不影响 |
| i | `INFO` | 提示/观察值，供人判断 | 不影响 |

- `RULES[].severity` 与 `Finding.severity` **一律用全称**（`BLOCKER|MAJOR|MINOR|NIT|INFO`），API 中不出现缩写；缩写只在本表与人类报告里使用。
- 退出码总口径：`0` = 无 BLOCKER 且无 MAJOR（`--strict` 时也无 MINOR）；`1` = 门禁失败；`2` = 用法/IO 错误。

### 0.2 修复路由（fixRoute）

| 缩写 | 路由 | 改哪里 | 典型动作 |
|---|---|---|---|
| P | `prose` | 章节正文 / 章节 frontmatter | 改写转场、补时间跳跃、改动作强度、补 `flashback: true` |
| B | `bible` | `bible/*.jsonl`、`bible/space.json`、`project.json` 的注册表 | 补注册角色/地点/事实/伏笔、补硬规则、修账本 JSON |
| O | `outline` | `outline/outline.json` 断言层 | 补场景卡字段、修计划顺序、对齐断言 |
| C | `config` | `project.json` 配置 | 补 `schema`、调阈值、调 `chapterWords`、配 `daylight` |

路由语义：**同一发现的修复只应落在一条路由上**；若一条发现需要同时改两处，按「真源优先」原则先改正文/账本，再让断言层对齐（伏笔维与大纲维各有一条规则专门提示「断言与派生不一致」，见 §8 与 §9 的末条）。

### 0.3 判定顺序（冻结）

```
解析 → 派生 → 规则
解析：读 project.json / 账本 / 章节 frontmatter（YAML-lite 子集）
派生：按 chapter 升序、场景出现顺序 replay → timeline / items / knowledge / injuries / resources / hook 派生状态
规则：structure → space → time → physics → dialogue → character → fact → hook → outline → voice
```

- 解析失败只产出对应的结构类发现（带文件名与行号），**绝不抛异常**；后续维度在缺数据时跳过而不是崩。
- 派生值是一等公民：凡「断言层 vs 派生层」不一致，报告指向断言层（`hooks.jsonl` / `outline.json`），**不覆盖**章节 frontmatter 的事实源地位。

### 0.4 关联字段约定

- `fm` = 章节 `chapters/ch-XXX.md` 的 YAML-lite frontmatter（字段见 `story-state-schema.md`）。
- `fm.scenes[]` 的列表字段：`actions` / `uses` / `knowledge` / `appellations` / `injuries` / `items` / `resources` / `facts` / `hooks_plant` / `hooks_pay` / `violates`。
- 「派生值」= replay 后得到的状态（道具持有者、净伤势、已知事实集合、伏笔埋设/回收章）。
- 时间绝对量 = `(day - 1) * 1440 + clockMinutes`；场景时间窗 = `[start, start + minutes]`。

### 0.5 `lintChapterText` / `prose` 的规则面（冻结）

无项目上下文的命令只可能产出三类：**结构维的解析/字数三条**（frontmatter 解析、空正文、字数偏离）与**声音维全部**。其余 **48 条**（62 − 3 − 11）依赖项目账本与派生状态，`prose` 命令不跑、也不会误报。

### 0.6 `--chapter N` 作用域（v1.5 冻结 / v1.7 细化）

`lint --chapter N` 的 `findings` = **本章文件**（`chapters/ch-NNN.md`）的 findings **∪ 全部非章节文件**（`bible/**`、`outline/**`、`project.json`、`summaries.md`）的 findings（全局 findings），**但排除计划型断言规则**（见下）。理由：章门禁承诺「不过闸不进下一章」，若账本/大纲级 BLOCKER 被章节过滤掉，门禁就能被无限推进。

**计划型断言豁免（v1.7 冻结，修 B2-F1）**：`PLAN_PROGRESS_RULES = ['OUT-003', 'FACT-004']` 属**计划/进度型**——`OUT-003`（outline 有卡、章节未写）与 `FACT-004`（`hooks.pay` / `facts.revealAt` 指向计划章）在「先建大纲、再逐章写」的合法流程里必然为真，因此**不并入 `--chapter` 章门禁**。草稿期逐章推进时，**全量 `lint` 仍照常报**这两条（属预期），写完对应章节后自然消失。其余全局 findings（如 DOC-002 账本损坏、CHAR-005、HOOK-001）**仍拦章门禁**。

注意派生仍跨全项目 replay：回改旧章时，单章门禁**不会**报告「该修改对后续章的影响」，终稿前必须用全量 `lint`（不带 `--chapter`）复核。

---

## 1. 结构维 structure（8 条）

结构维管「项目形状」：配置能不能读、章节文件命不命得中、frontmatter 能不能解析、正文是不是空的、字数够不够。这一维不过，后面所有派生都不可信。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| DOC-001 | BLOCKER | `project.json` 缺失，或 `schema` ≠ `novel-forge/v1`（文件存在但 JSON 坏归下一条「账本解析失败」） | config | `project.json.schema`、项目根 |
| DOC-002 | BLOCKER | 任一 JSON/JSONL 账本解析失败（`characters` / `space` / `facts` / `hooks` / `outline` / `reports` / `exemptions`），报告带文件名与行号 | bible | 全部账本文件 |
| DOC-003 | MAJOR | `chapters/` 下章节文件名不匹配 `^ch-(\d{3})\.md$`（如 `ch-1.md`、`第3章.md`） | prose | `chapters/` 目录项 |
| DOC-004 | MAJOR | 章节序号不连续：`1..max` 有缺口（有第 1、3 章但没有第 2 章） | prose | `fm.chapter`、文件名序号 |
| DOC-005 | BLOCKER | 章节 frontmatter 缺失、无法按 YAML-lite 子集解析，或缺少必填 `chapter` | prose | `fm` 整体、YAML-lite 子集契约 |
| DOC-006 | BLOCKER | 章节正文（去掉 frontmatter 再去空白）为空 | prose | frontmatter 之后的正文 |
| DOC-007 | MINOR | 章节字数偏离 `chapterWords` 超过 `chapterWordsTolerance`（默认 3000 字 ±20%） | prose | `project.chapterWords`、`project.chapterWordsTolerance`、正文 |
| DOC-008 | MINOR | `summaries.md` 存在，但缺某章摘要小节（`## ch-00N 标题`） | prose | `summaries.md` |

**判例一（配置缺失）**：新项目目录里只有 `bible/`，用户直接跑 `lint`。期望：本维第 1 条命中，BLOCKER，路由 config；处理不是手工编一份 `project.json`，而是 `init` 补齐（`init` 只创建缺失文件，不覆盖已有文件）后重跑。若用户自己写了 `project.json` 但写成 `"schema": "novel-forge/v2"`，同样命中，改的是 `schema` 值不是跑别的命令。

**判例二（字数门禁的豁免路径）**：某章是刻意的短章（过场 800 字），`chapterWords=3000`、容差 20%。期望：本维第 7 条命中，MINOR，路由 prose。正确处理是**调项目阈值**（该卷把 `chapterWords` 降到 1500）或接受 MINOR（非 `--strict` 不拦），**不是**在正文里灌水；灌水会连带触发声音维节奏与模板项。

---

## 2. 空间维 space（5 条）

空间维回答「人在不在该在的地方、来不来得及、道具/事实的归属地对不对」。最短通行耗时由地点图 `space.edges` 的 `minutes` 与 `bidirectional` 决定（同地点 = 0，BFS/Dijkstra）。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| SPACE-001 | BLOCKER | 场景 `place` 未在 `space.json.places[].id` 注册 | bible | `fm.scenes[].place`、`space.places[].id` |
| SPACE-002 | BLOCKER | 相邻场景异地，但地点图无连通路径（取最短通行耗时判定不可达） | outline | `space.edges`、`fm.scenes[].place` |
| SPACE-003 | BLOCKER | 相邻场景异地且时间差 < 最短通行耗时 | prose | `fm.scenes[].day/clock/minutes`、`space.edges[].minutes` |
| SPACE-004 | BLOCKER | 同一角色在同一时间窗出现在两个不同地点 | prose | `fm.scenes[].cast/place/day/clock/minutes` |
| SPACE-005 | BLOCKER | 场景内 `actions/uses/knowledge/appellations/items/resources/injuries` 中的 `who`/`from`/`to` 不在该场景 `cast` 中 | prose | `fm.scenes[].cast` 与六个场景列表 |

**判例一（瞬移）**：第 3 章场景一在三号仓三层，场景二在七号码头，`clock` 只差 5 分钟，而 `space.edges` 里这条边 `minutes: 12`。期望：本维第 3 条命中，BLOCKER，路由 prose。修法三选一（改文优先于改设定）：加时间跳跃（`clock` 改到 22:00）、改地点（下一场仍留仓库）、或补一条更快的交通方式（新增边 `mode: drive, minutes: 5` 并说明车从哪来）。

**判例二（幽灵动作）**：场景 `cast: [lin-jin]`，但 `items` 里写了 `{id: item-compass, op: transfer, from: xu-an, to: lin-jin}`——徐岸不在场却完成移交。期望：本维第 5 条命中，BLOCKER，路由 prose。要么把徐岸加进 `cast`（正文也要真出现），要么改成本场道具是林烬自己从抽屉取出（`op: find`，`place: warehouse-3f`）。

---

## 3. 时间维 time（7 条）

时间维管「时间轴单调性与光照自洽」。`flashback: true` 是唯一合法的时间倒流出口，但**标了 flashback 不豁免空间维**（回忆里的人也要在场、地点也要注册）。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| TIME-001 | BLOCKER | 同章场景起始时间倒退（非 flashback） | prose | `fm.scenes[].day/clock/minutes`、`flashback` |
| TIME-002 | BLOCKER | 跨章时间倒退：本章首场景起始 < 上章末场景结束（非 flashback） | prose | 相邻两章 `fm.scenes`、`flashback` |
| TIME-003 | MAJOR | 场景时间窗与上一场景重叠且地点不同（非 flashback） | prose | `fm.scenes[].minutes`、`place` |
| TIME-004 | MINOR | 场景 `light` 与 `clock` + `project.daylight` 矛盾（如 21:40 标 `day`、09:00 标 `night`） | prose | `fm.scenes[].light/clock`、`project.daylight` |
| TIME-005 | MAJOR | `age` ≠ `storyYear - birthYear`（三者齐备时，容差 1） | bible | `characters.age/birthYear`、`project.storyYear` |
| TIME-006 | MINOR | 章节级 `day` 与首个场景 `day` 不一致 | prose | `fm.day`、`fm.scenes[0].day` |
| TIME-007 | MAJOR | 场景时间早于上一场景且未标 `flashback: true`（与同章倒退同源时两条都记，修法相同） | prose | `fm.scenes[].day/clock`、`flashback` |

**判例一（回忆里的车祸）**：第 5 章开场写 6 年前的雨夜，`day: 3`、`clock: "21:40"`，没标 flashback。期望：本维第 1 条与第 7 条同时命中（时间倒退 / 早于上一场景），路由 prose。修法：该场景标 `flashback: true`，并把 `day` 改回叙事层时间或保留独立时间轴——**标记后引擎不再报时间倒退**，但正文必须给出进入回忆的信号（一句话过渡即可）。

**判例二（光照穿帮）**：`project.daylight: {sunrise: "06:30", sunset: "18:00"}`，某场景 `clock: "19:10"` 却写 `light: day`。期望：本维第 4 条命中，MINOR，路由 prose。改 `light: dusk`（或 `night`）即可；本条不拦门禁，但会出现在报告里，属于「读者能一眼看出的错」。

---

## 4. 物理维 physics（7 条）

物理维是「身体与物品守恒」：伤没伤、东西在谁手上、水下有没有装备、硬规则有没有被违反。道具状态机为 `{holder, place, status}`，`create/transfer/destroy/lose/find` 五个操作只有一种合法语义。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| PHYS-001 | MAJOR | 某部位净伤势 ≥ 2 的角色仍执行 `intensity ≥ 2` 的动作 | prose | `fm.scenes[].injuries` 派生、`fm.scenes[].actions.intensity` |
| PHYS-002 | BLOCKER | 已 `destroy` / `lose` 的道具再次出现（`transfer`/`find`/`create` 或作为持有者使用） | prose | `fm.scenes[].items` 派生状态 |
| PHYS-003 | BLOCKER | 道具 `transfer` 的 `from` ≠ 当前持有者 | prose | `fm.scenes[].items` 派生 holder |
| PHYS-004 | MAJOR | 道具 `transfer` / `destroy` 时无人持有 | prose | `fm.scenes[].items` 派生 holder |
| PHYS-005 | BLOCKER | 角色卡声明过的 `resources.<kind>` 累加后 < 0 | prose | `characters.resources`、`fm.scenes[].resources` |
| PHYS-006 | MAJOR | 场景 `env` 命中 `envRules`，但 cast 无人 `abilities` 含 `requiresAny` 任一值 | prose | `project.envRules`、`fm.scenes[].env`、`characters.abilities` |
| PHYS-007 | BLOCKER | `violates[]` 引用未注册硬规则，或违反已注册规则但 `justification` 为空 | bible | `project.hardRules`、`fm.scenes[].violates/justification` |

**判例一（资源负数）**：林烬角色卡写 `resources: {"ammo": 6}`，第 3 章场景一 `resources: [{who: lin-jin, kind: ammo, delta: -2}]`，场景二又 `-5`。期望：派生到场景二时 ammo = -1，本维第 5 条命中，BLOCKER，路由 prose。修法：补一次补给（`delta: +3` 并在正文写出来源），或把第二场改成 `-1`。**只有角色卡声明过的 kind 才统计**：若角色卡没有 `money`，`resources: [{kind: money, delta: -100}]` 不报（未声明即未建模）。

**判例二（硬规则豁免）**：世界硬规则「本世界没有超自然力量」，某场景写「林烬凭直觉听见墙后的心跳」，`violates: [hr1]`、`justification: ""`。期望：本维第 7 条命中，BLOCKER，路由 bible。两条合法路径：删掉违规描写；或填 `justification: "刑侦经验+老楼传声，属物理解释"` 并**同步把解释写进正文**——只填标注不写正文等于自欺，反向抽取复核对账时会抓出来。

---

## 5. 台词维 dialogue（3 条）

台词维管「角色说不说自己知道的话、叫不叫不该叫的称呼、说的人存不存在」。这是用户提的「台词逻辑」的机器可判部分；潜台词与新意由语义 rubric 兜。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| DLG-001 | BLOCKER | 场景 `uses[].fact` 未被该角色在此前获知（`knowledgeDefault` / `public: true` 的事实 / 前序 `knowledge` 三条路径均不成立） | prose | `fm.scenes[].uses`、`characters.knowledgeDefault`、`facts.public`、派生 knowledge |
| DLG-002 | BLOCKER | `uses` / `knowledge` / `appellations` 的 `who`/`from`/`to` 未在 characters 注册 | bible | `fm.scenes[]` 三个列表、`bible/characters.jsonl` |
| DLG-003 | MINOR | `appellations.as` 不在对方角色 `appellations[speaker]` ∪ `[name]` ∪ `aliases` 中 | prose | `fm.scenes[].appellations`、`characters.appellations/name/aliases` |

**判例一（说漏嘴）**：事实「父亲的怀表停在 3:17」是 `public: false`、`revealAt: null`，林烬此前没在任何场景获知；第 3 章他开口「表停在三点十七」，且 `uses: [{who: lin-jin, fact: f1}]`。期望：本维第 1 条命中，BLOCKER，路由 prose。合法修法：在本场之前加一个获知场景（`knowledge: [{who: lin-jin, fact: f1, source: 亲眼所见}]`），或把台词改成推测口径（「表针像是被人拨过」）并去掉 `uses`。

**判例二（称呼越界）**：徐岸叫林烬「阿烬」，但徐岸角色卡的 `appellations` 只有 `{"lin-jin": ["林队"]}`，林烬的 `name` 是「林烬」、`aliases` 是「林队」。期望：本维第 3 条命中，MINOR，路由 prose。修法：在徐岸的 `appellations.lin-jin` 里加「阿烬」（并在正文补一句关系说明），或台词改口叫「林队」——取决于两人关系到哪一步。

---

## 6. 人物维 character（6 条）

人物维管「谁存在、谁活着、谁会什么、有没有声纹」。v1.2 起新增「死者被提及必须登记」：`mentions[]` 是**审计痕迹**，不是在场证明；不登记就等于把「真复活」的漏检口留着。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| CHAR-001 | BLOCKER | 场景 `cast` / `actions` / `knowledge` / `injuries` 引用未注册角色 | bible | `fm.scenes[]` 四处、`bible/characters.jsonl.id` |
| CHAR-002 | BLOCKER | `status=dead|missing` 的角色出现在 `cast` 或 `actions[].who`，且场景 `flashback !== true` | prose | `characters.status`、`fm.scenes[].cast/actions/flashback` |
| CHAR-003 | BLOCKER | `actions[].ability` 不在该角色 `abilities` 中（能力越界） | prose | `characters.abilities`、`fm.scenes[].actions.ability` |
| CHAR-004 | MINOR | 角色卡缺 `goal` 或 `voice`（长篇完整性；单章试写可放行） | bible | `characters.goal/voice` |
| CHAR-005 | BLOCKER | `status` 非法值 / `id` 非 kebab / `id` 重复 | bible | `characters.status/id` |
| CHAR-006 | MINOR | 正文出现 `status=dead|missing` 角色的姓名或别名，但该章 `mentions[]` 未登记 | prose | `characters.status/name/aliases`、`fm.mentions`、正文 |

**判例一（真复活 vs 回忆）**：徐岸 `status: dead`、`diedAt: 7`，第 9 章场景 `cast: [lin-jin, xu-an]` 且没标 flashback。期望：本维第 2 条命中，BLOCKER，路由 prose。若这是回忆，标 `flashback: true`；若是「假死反转」，先把角色卡改成 `missing` 并在正文给出证据，再重跑——**不许靠删规则过门禁**。

**判例二（v1.2 的 mentions 审计）**：第 10 章正文写「徐岸的警号还挂在墙上」，但该章 `mentions: []`。期望：本维第 6 条命中，MINOR，路由 prose。修法：`mentions: [xu-an]`。注意 `mentions` 只表示「被提及/被回忆」，**不**把死者拉进 `cast`；因此它不会误触本维第 2 条。反向操作（只加 mentions 却让死者真的说话）会被第 2 条抓。

---

## 7. 因果事实维 fact（4 条）

事实维管「世界的事实注册表」：同一代号不许两种说法、引用必须注册、获知要有来源、断言不能指向不存在的章节。**v1.3 修订（demo 回归闭环）**：`knowledge` 来源可追溯只看「证据在不在」——该 fact 是否在**本场景** `facts[]` 里声明，或 `source` 是否非空；与「角色是否第一次出场」无关。v1.2 的「获知者此前从未出现在任何场景 `cast`」口径会在任何角色首章获知时误报（demo ch-001 实测），已废弃。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| FACT-001 | MAJOR | 同一 fact `id` 在 `facts.jsonl` 重复且 `statement` 不一致 | bible | `bible/facts.jsonl.id/statement` |
| FACT-002 | BLOCKER | 场景 `facts` / `knowledge` / `uses` 引用未注册 fact | bible | `fm.scenes[]` 三处、`bible/facts.jsonl.id` |
| FACT-003 | MAJOR | `knowledge` 来源不可追溯：该 fact 既不在**本场景** `facts[]` 中声明，且 `source` 为空字符串或缺省（只看证据在不在，不看角色是否首次出场；v1.3 口径） | prose | `fm.scenes[].knowledge`、`fm.scenes[].facts`、`knowledge.source` |
| FACT-004 | MAJOR | `facts.revealAt` 或 `hooks.plant/pay`（断言层）指向不存在的章节（属计划型断言：章门禁不阻塞，见 §0.6；全量 `lint` 仍报） | bible | `facts.revealAt`、`hooks.plant/pay`、章节文件集合 |

**判例一（来源不可追溯 = 证据在不在）**：**反例（命中）**：场景里 `knowledge: [{who: lin-jin, fact: f-002}]`，f-002 既不在本场景 `facts[]` 中声明，也没有写 `source`。期望：本维第 3 条命中，MAJOR，路由 prose。**正例（不命中）**：同一行改成 `knowledge: [{who: lin-jin, fact: f-001, source: 亲眼所见}]`（`source` 非空），或把 `facts: [f-001]` 写进本场景（证据在场景内声明）——两条路径任选其一即合法。注意判定与「林烬是不是第一次出场」无关：首章首次出场也可以合法获知，只要带上证据（v1.2 的「此前从未出场」口径正是因此被 demo 回归废弃的）。

**判例二（断言指向计划章 / 计划型断言）**：`hooks.jsonl` 里写 `pay: 12`，但项目目前只写到第 10 章（第 11–12 章还在大纲里）。期望：本维第 4 条命中，MAJOR，路由 bible；**它是计划型断言**——全量 `lint` 会报（草稿期属预期），但 `--chapter 10` 的章门禁不并入它，写完第 11–12 章后提示自然消失。若这条 pay 只是远期设想，就置 `null`（未回收，合法值，不报错）；**不要**为了消提示去删掉正确的大纲计划。

---

## 8. 伏笔维 hook（6 条）

伏笔维管「问题-回收」生命周期。`hooks.jsonl` 是**断言层**，真源是章节 frontmatter 的 `hooks_plant` / `hooks_pay`；两者不一致只提示改断言，不改正文。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| HOOK-001 | BLOCKER | 伏笔回收章早于埋设章（以章节 frontmatter 派生值为准） | outline | `fm.scenes[].hooks_plant/hooks_pay` 派生、`bible/hooks.jsonl` |
| HOOK-002 | MAJOR | 派生状态 OPEN 且 `当前最大章 - plant > staleAfter`（缺省 `project.staleHookChapters`，默认 5） | bible | 派生 hook 状态、`hooks.staleAfter`、`project.staleHookChapters` |
| HOOK-003 | MAJOR | 显式 `status=BROKEN/DEFERRED` 但存在 `hooks_pay` 场景 | bible | `hooks.status`、`fm.scenes[].hooks_pay` |
| HOOK-004 | BLOCKER | 场景 `hooks_plant` / `hooks_pay` 引用未注册伏笔 | bible | `fm.scenes[]` 两个列表、`hooks.jsonl.id` |
| HOOK-005 | MINOR | 大纲场景卡缺 `goal` / `conflict` / `outcome` 任一 | outline | `outline.chapters[].scenes[]` |
| HOOK-006 | MINOR | `hooks.jsonl` 的 `plant/pay` 断言与 frontmatter 派生值不一致 | bible | `hooks.plant/pay` vs 派生值 |

**判例一（未回收超期）**：伏笔「谁调换了怀表」在第 1 章埋设，当前写到第 8 章仍 OPEN，`staleAfter` 为 null、`project.staleHookChapters = 5`。期望：`8 - 1 > 5`，本维第 2 条命中，MAJOR，路由 bible。修法只有两条：排进最近章节回收（改大纲断言），或显式 `status: DEFERRED` 并写明「压到第二卷」——**不许假装忘了**，超期目的是逼作者做决定。

**判例二（作废了却回收）**：某伏笔标 `status: BROKEN`（换设定作废），但第 6 章 `hooks_pay` 里又回收了它。期望：本维第 3 条命中，MAJOR，路由 bible。改设定三处同步铁律在此生效：`hooks.jsonl` 的 status、outline 的 `hooks_pay`、第 6 章 frontmatter 的 `hooks_pay` 必须同批修改；只改一处就等着这维持续报。

---

## 9. 大纲维 outline（5 条）

大纲维管「计划与成品的对齐」。`outline.json` 同样是断言层：章节正文写歪了以正文为准，提示作者改大纲；但**计划里引用了不存在的东西**（未注册地点/角色/伏笔）是硬错。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| OUT-001 | MAJOR | 存在章节文件但 `outline.json` 无对应章 | outline | `chapters/` 文件集合、`outline.chapters[].chapter` |
| OUT-002 | BLOCKER | 场景卡 `place` / `cast` / `hooks_*` 引用未注册实体 | outline | `outline.chapters[].scenes[]`、`space/characters/hooks` 注册表 |
| OUT-003 | MAJOR | 场景卡 `chapter` 无对应章节文件（计划写了第 12 章，文件只到 10）（属计划型断言：章门禁不阻塞，见 §0.6；全量 `lint` 仍报） | outline | `outline.chapters[].chapter`、`chapters/` |
| OUT-004 | MAJOR | 章节 frontmatter 场景 id 集合与大纲卡不一致（数量或 id） | prose | `fm.scenes[].id`、`outline.chapters[].scenes[].id` |
| OUT-005 | MINOR | 大纲场景卡 `place`/`cast`/`hooks_*` 与 frontmatter 不一致（计划与成品漂移） | outline | 场景卡与 `fm.scenes[]` 对照 |

**判例一（场景 id 漂移）**：大纲第 3 章写了 `ch3-s1`、`ch3-s2`，成品 frontmatter 只有 `ch3-s1`（作者把两场并成一场）。期望：本维第 4 条命中，MAJOR，路由 prose：要么拆回两场，要么改大纲卡片同步合并——推荐后者（正文已成立），并在改完后重跑确认渲染。

**判例二（计划引用未注册实体）**：大纲第 5 章场景卡 `cast: ["wen-qing"]`，人物表里没有温晴。期望：本维第 2 条命中，BLOCKER，路由 outline。修法：先补人物卡（`bible/characters.jsonl`）再保留大纲——写大纲时「先建世界、再排场景」，这一条就是防止大纲凭空造人。

---

## 10. 声音维 voice（11 条）

声音维管「像不像人写的」。评分由 `analyzeVoice(text)` 产出（公式与全词表见 `anti-ai-voice.md`）；这一维同时含 BLOCKER（元信息泄漏）与 MAJOR（陈词超标、体检分不达标）级规则。

尤其 `score` 低于 `minVoiceScore` 记 **MAJOR**（与 `RULES`/PRD 一致），默认拦门禁，且不允许靠豁免混过 `--strict`。

| ID | 级别 | 触发条件 | 修复路由 | 关联字段 |
|---|---|---|---|---|
| VOICE-001 | BLOCKER | 正文含元信息标记：`[说明]`、`（注：`、`【写作`、`TODO`、`作者按`、`[AI addition` | prose | 正文、`project.style.forbiddenWords` |
| VOICE-002 | MAJOR | `weightedHitsPer1000` > `maxWeightedClichesPer1000`（默认 1.5） | prose | 正文、`style.thresholds` |
| VOICE-003 | MINOR | `templateHits` > `maxTemplateHits`（默认 3） | prose | 正文、`style.thresholds` |
| VOICE-004 | MINOR | `rhythmCV !== null` 且 < `minSentenceLengthCV`（默认 0.35） | prose | 正文、`style.thresholds` |
| VOICE-005 | NIT | `paragraphCV !== null` 且 < 0.30（段落长度过于均匀） | prose | 正文 |
| VOICE-006 | MINOR | 对话标签 top 占比 > `maxDialogueTagRatio`（默认 0.7）且 `tagTotal ≥ 6` | prose | 正文中 `说道/问道/笑道` 类标签 |
| VOICE-007 | MINOR | `emotionPer1000` > `maxEmotionPer1000`（默认 1.2） | prose | 正文、`style.thresholds` |
| VOICE-008 | MINOR | `summaryEndings ≥ 3`（段末升华句过多） | prose | 正文段落尾句 |
| VOICE-009 | MINOR | `translationese ≥ 2`（翻译腔正则命中数） | prose | 正文 |
| VOICE-010 | INFO | POV 疑似越界：非 POV 角色句中含 心想/心里/暗想/暗自（`viewpoint.character` 非空时才执行） | prose | `project.viewpoint.character`、正文 |
| VOICE-011 | MAJOR | `analyzeVoice(text).score` < `minVoiceScore`（默认 60） | prose | 全文、`style.thresholds.minVoiceScore` |

**判例一（短文本不误判）**：`prose` 跑一段 300 字的章节钩子：`unit < 500` → `rhythmCV`/`paragraphCV` 为 `null`，节奏与段落两项扣分按 0 计。期望：不因短文本命中第 4、5 条（这两条的门槛是「非 null 且低于阈值」）；其余项照算。这保证了「短章/试写片段」不会因为统计样本不足被判死。

**判例二（门禁级 vs 建议级）**：某章 `score = 64`（高于默认 60），但 `weightedHitsPer1000 = 1.6`（超过默认 1.5）。期望：第 2 条命中，MAJOR → 退出码 1，章门禁不过；第 11 条不命中。也就是说「总分过线」不等于「能交稿」——高频陈词是定点改写的强信号，改写后重扫直到第 2 条也干净。反之若 `score = 58` 但陈词不超标，命中的是第 11 条，改的方向是节奏与情绪浓度而不是批量删词。

---

## 11. 修复路由速查

| 症状 | 先改哪里 | 再改哪里 | 不要做什么 |
|---|---|---|---|
| 时间/空间矛盾 | 正文与 frontmatter（真源） | 断言层（大纲） | 加 `flashback: true` 却不写过渡 |
| 角色死了又说话 | 确认是真复活还是回忆 | 角色卡 `status` / `diedAt` | 删 `cast` 假装没写 |
| 道具穿帮 | 场景 `items` 操作链 | 大纲场景卡 | 改引擎规则 |
| 硬规则越界 | 正文或 `justification` + 正文解释 | `hardRules` | 只填 justification 不写正文 |
| 伏笔超期 | 排回收章 | `hooks.jsonl` 状态 | 默默把 `staleAfter` 调大 |
| AI 腔超标 | 定点改写（见 `anti-ai-voice.md`） | 项目阈值（记录原因） | 静默改引擎默认词表 |
| 大纲漂移 | 以正文为准改大纲 | 重跑 lint | 为对齐大纲删正文 |

## 12. 维护纪律

1. **规则只增不改语义**：`id` 是长期契约，一旦发布不可复用/改判据；语义要变就新建 id 并废弃旧条（在 CHANGELOG 说明）。
2. **三处同步**：`RULES`、本文件、覆盖台账；缺一处即测试红。
3. **级别只能通过 PRD/评审升级**：不要为了过门禁把 BLOCKER 降级；用户可控的出口是阈值与豁免（带 reason），不是改级别。
4. **文档与引擎的计数必须一致**：本文件表格行数 = `RULES.length` = 62；任何「约/左右」都不允许出现在条数描述里。
5. **发现必须可复跑**：每条规则都要能被一个夹具稳定命中（`rule` + `severity` 双断言），复现不了的规则等于没实现。
