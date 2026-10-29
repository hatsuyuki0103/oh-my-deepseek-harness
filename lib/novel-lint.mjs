// SPDX-License-Identifier: MIT
// lib/novel-lint.mjs — novel-forge 确定性校验引擎（零依赖 ESM、无网络）。
//
// 真源：`.omx/plans/prd-novel-forge.md` v1.2 §4（schema/YAML-lite）+ §5（§5.1 CLI、
// §5.2 Report/豁免、§5.3 反 AI 腔、§5.4 62 条规则、§5.5 运行时契约、§5.6 派生）。
//
// 设计约束（冻结）：
// - 单文件 ESM、仅 node: 内置模块、无网络；
// - 任何解析/IO 失败都转成 findings，绝不抛异常；只有 CLI 用法错误返回 2；
// - `lintChapterText` 只可能产出 DOC-005/006/007 + VOICE-001..011；
// - `RULES` 恰 62 条，severity 一律全称 BLOCKER|MAJOR|MINOR|NIT|INFO（API 禁止缩写）。

import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// 1. 常量
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 'novel-forge/v1'
export const VERSION = '1.0.0'

const SEVERITIES = ['BLOCKER', 'MAJOR', 'MINOR', 'NIT', 'INFO']
const DIMENSION_ORDER = ['structure', 'space', 'time', 'physics', 'dialogue', 'character', 'fact', 'hook', 'outline', 'voice']
const DIMENSION_INDEX = new Map(DIMENSION_ORDER.map((d, i) => [d, i]))
const FIX_ROUTES = ['prose', 'bible', 'outline', 'config']

/** 62 条规则（PRD §5.4 冻结表；顺序与表格一致）。 */
const RULE_DEFS = [
  // ---- structure ----
  { id: 'DOC-001', dimension: 'structure', severity: 'BLOCKER', fixRoute: 'config', title: 'project.json 缺失或 schema 不是 novel-forge/v1' },
  { id: 'DOC-002', dimension: 'structure', severity: 'BLOCKER', fixRoute: 'bible', title: 'JSON/JSONL 账本解析失败' },
  { id: 'DOC-003', dimension: 'structure', severity: 'MAJOR', fixRoute: 'prose', title: '章节文件名不符合 ch-NNN.md' },
  { id: 'DOC-004', dimension: 'structure', severity: 'MAJOR', fixRoute: 'prose', title: '章节序号不连续（1..max 有缺口）' },
  { id: 'DOC-005', dimension: 'structure', severity: 'BLOCKER', fixRoute: 'prose', title: '章节 frontmatter 缺失或无法按 YAML-lite 解析' },
  { id: 'DOC-006', dimension: 'structure', severity: 'BLOCKER', fixRoute: 'prose', title: '章节正文去空白后为空' },
  { id: 'DOC-007', dimension: 'structure', severity: 'MINOR', fixRoute: 'prose', title: '章节字数偏离目标超出容差' },
  { id: 'DOC-008', dimension: 'structure', severity: 'MINOR', fixRoute: 'prose', title: 'summaries.md 缺某章摘要小节' },
  // ---- space ----
  { id: 'SPACE-001', dimension: 'space', severity: 'BLOCKER', fixRoute: 'bible', title: '场景地点未在 space.json 注册' },
  { id: 'SPACE-002', dimension: 'space', severity: 'BLOCKER', fixRoute: 'outline', title: '相邻场景异地且地点图无连通路径' },
  { id: 'SPACE-003', dimension: 'space', severity: 'BLOCKER', fixRoute: 'prose', title: '相邻场景异地但时间差小于最短通行耗时' },
  { id: 'SPACE-004', dimension: 'space', severity: 'BLOCKER', fixRoute: 'prose', title: '同一角色在同一时间窗出现在两个不同地点' },
  { id: 'SPACE-005', dimension: 'space', severity: 'BLOCKER', fixRoute: 'prose', title: '场景内的 who 不在该场景 cast 中' },
  // ---- time ----
  { id: 'TIME-001', dimension: 'time', severity: 'BLOCKER', fixRoute: 'prose', title: '同章场景起始时间倒退（非 flashback）' },
  { id: 'TIME-002', dimension: 'time', severity: 'BLOCKER', fixRoute: 'prose', title: '跨章时间倒退（非 flashback）' },
  { id: 'TIME-003', dimension: 'time', severity: 'MAJOR', fixRoute: 'prose', title: '场景时间窗与上一场景重叠且地点不同' },
  { id: 'TIME-004', dimension: 'time', severity: 'MINOR', fixRoute: 'prose', title: '场景 light 与 clock + daylight 矛盾' },
  { id: 'TIME-005', dimension: 'time', severity: 'MAJOR', fixRoute: 'bible', title: 'age 与 storyYear - birthYear 不一致（容差 1）' },
  { id: 'TIME-006', dimension: 'time', severity: 'MINOR', fixRoute: 'prose', title: '章节级 day 与首个场景 day 不一致' },
  { id: 'TIME-007', dimension: 'time', severity: 'MAJOR', fixRoute: 'prose', title: '场景时间早于上一场景且未标 flashback: true' },
  // ---- physics ----
  { id: 'PHYS-001', dimension: 'physics', severity: 'MAJOR', fixRoute: 'prose', title: '重伤部位存在时执行 intensity ≥ 2 动作' },
  { id: 'PHYS-002', dimension: 'physics', severity: 'BLOCKER', fixRoute: 'prose', title: '已 destroy/lose 的道具再次出现' },
  { id: 'PHYS-003', dimension: 'physics', severity: 'BLOCKER', fixRoute: 'prose', title: '道具 transfer 的 from 与当前持有者不符' },
  { id: 'PHYS-004', dimension: 'physics', severity: 'MAJOR', fixRoute: 'prose', title: '道具 transfer/destroy 时无人持有' },
  { id: 'PHYS-005', dimension: 'physics', severity: 'BLOCKER', fixRoute: 'prose', title: '角色已声明资源累加后为负' },
  { id: 'PHYS-006', dimension: 'physics', severity: 'MAJOR', fixRoute: 'prose', title: '场景 env 命中 envRules 但 cast 无人具备要求能力' },
  { id: 'PHYS-007', dimension: 'physics', severity: 'BLOCKER', fixRoute: 'bible', title: 'violates 引用未注册硬规则或违反后 justification 为空' },
  // ---- dialogue ----
  { id: 'DLG-001', dimension: 'dialogue', severity: 'BLOCKER', fixRoute: 'prose', title: '使用了角色此前未获知的事实' },
  { id: 'DLG-002', dimension: 'dialogue', severity: 'BLOCKER', fixRoute: 'bible', title: 'uses/knowledge/appellations 的说话人未注册' },
  { id: 'DLG-003', dimension: 'dialogue', severity: 'MINOR', fixRoute: 'prose', title: '称谓不在对象角色允许清单内' },
  // ---- character ----
  { id: 'CHAR-001', dimension: 'character', severity: 'BLOCKER', fixRoute: 'bible', title: '场景 cast/actions/knowledge/injuries 引用未注册角色' },
  { id: 'CHAR-002', dimension: 'character', severity: 'BLOCKER', fixRoute: 'prose', title: 'status=dead|missing 角色在非回忆场景出场' },
  { id: 'CHAR-003', dimension: 'character', severity: 'BLOCKER', fixRoute: 'prose', title: 'actions.ability 不在该角色 abilities 中' },
  { id: 'CHAR-004', dimension: 'character', severity: 'MINOR', fixRoute: 'bible', title: '角色卡缺 goal 或 voice' },
  { id: 'CHAR-005', dimension: 'character', severity: 'BLOCKER', fixRoute: 'bible', title: '角色 status 非法 / id 非 kebab / id 重复' },
  { id: 'CHAR-006', dimension: 'character', severity: 'MINOR', fixRoute: 'prose', title: '正文出现死者姓名/别名但该章 mentions 未登记' },
  // ---- fact ----
  { id: 'FACT-001', dimension: 'fact', severity: 'MAJOR', fixRoute: 'bible', title: '同一 fact id 重复且 statement 不一致' },
  { id: 'FACT-002', dimension: 'fact', severity: 'BLOCKER', fixRoute: 'bible', title: '场景 facts/knowledge/uses 引用未注册 fact' },
  { id: 'FACT-003', dimension: 'fact', severity: 'MAJOR', fixRoute: 'prose', title: 'knowledge 来源不可追溯（未在本场景 facts 声明且无 source）' },
  { id: 'FACT-004', dimension: 'fact', severity: 'MAJOR', fixRoute: 'bible', title: 'facts.revealAt / hooks.plant/pay 指向不存在章节' },
  // ---- hook ----
  { id: 'HOOK-001', dimension: 'hook', severity: 'BLOCKER', fixRoute: 'outline', title: '伏笔回收章早于埋设章（frontmatter 派生）' },
  { id: 'HOOK-002', dimension: 'hook', severity: 'MAJOR', fixRoute: 'bible', title: '派生状态 OPEN 且超过 staleAfter 未回收' },
  { id: 'HOOK-003', dimension: 'hook', severity: 'MAJOR', fixRoute: 'bible', title: '显式 status=BROKEN/DEFERRED 但存在 hooks_pay 场景' },
  { id: 'HOOK-004', dimension: 'hook', severity: 'BLOCKER', fixRoute: 'bible', title: '场景 hooks_plant/hooks_pay 引用未注册伏笔' },
  { id: 'HOOK-005', dimension: 'hook', severity: 'MINOR', fixRoute: 'outline', title: '大纲场景卡缺 goal/conflict/outcome' },
  { id: 'HOOK-006', dimension: 'hook', severity: 'MINOR', fixRoute: 'bible', title: 'hooks.jsonl 断言与 frontmatter 派生值不一致' },
  // ---- outline ----
  { id: 'OUT-001', dimension: 'outline', severity: 'MAJOR', fixRoute: 'outline', title: '存在章节文件但 outline.json 无对应章' },
  { id: 'OUT-002', dimension: 'outline', severity: 'BLOCKER', fixRoute: 'outline', title: '大纲场景卡 place/cast/hooks_* 引用未注册实体' },
  { id: 'OUT-003', dimension: 'outline', severity: 'MAJOR', fixRoute: 'outline', title: '大纲场景卡 chapter 无对应章节文件' },
  { id: 'OUT-004', dimension: 'outline', severity: 'MAJOR', fixRoute: 'prose', title: '章节 frontmatter 场景 id 集合与大纲卡不一致' },
  { id: 'OUT-005', dimension: 'outline', severity: 'MINOR', fixRoute: 'outline', title: '大纲场景卡 place/cast/hooks_* 与 frontmatter 不一致' },
  // ---- voice ----
  { id: 'VOICE-001', dimension: 'voice', severity: 'BLOCKER', fixRoute: 'prose', title: '正文含元信息（[说明]/（注：/【写作/TODO/作者按/[AI addition）' },
  { id: 'VOICE-002', dimension: 'voice', severity: 'MAJOR', fixRoute: 'prose', title: 'weightedHitsPer1000 超过 maxWeightedClichesPer1000' },
  { id: 'VOICE-003', dimension: 'voice', severity: 'MINOR', fixRoute: 'prose', title: 'templateHits 超过 maxTemplateHits' },
  { id: 'VOICE-004', dimension: 'voice', severity: 'MINOR', fixRoute: 'prose', title: 'rhythmCV 低于 minSentenceLengthCV' },
  { id: 'VOICE-005', dimension: 'voice', severity: 'NIT', fixRoute: 'prose', title: 'paragraphCV 低于 0.30' },
  { id: 'VOICE-006', dimension: 'voice', severity: 'MINOR', fixRoute: 'prose', title: '对话标签 top 占比超过 maxDialogueTagRatio 且 tagTotal ≥ 6' },
  { id: 'VOICE-007', dimension: 'voice', severity: 'MINOR', fixRoute: 'prose', title: 'emotionPer1000 超过 maxEmotionPer1000' },
  { id: 'VOICE-008', dimension: 'voice', severity: 'MINOR', fixRoute: 'prose', title: 'summaryEndings ≥ 3' },
  { id: 'VOICE-009', dimension: 'voice', severity: 'MINOR', fixRoute: 'prose', title: 'translationese ≥ 2' },
  { id: 'VOICE-010', dimension: 'voice', severity: 'INFO', fixRoute: 'prose', title: 'POV 疑似越界（非 POV 角色句中含心想/心里/暗想/暗自）' },
  { id: 'VOICE-011', dimension: 'voice', severity: 'MAJOR', fixRoute: 'prose', title: '反 AI 腔体检分低于 minVoiceScore' },
]

/** 规则表（冻结导出；`RULES[].severity` 一律全称）。 */
export const RULES = RULE_DEFS.map((r) => ({
  id: r.id,
  dimension: r.dimension,
  severity: r.severity,
  title: r.title,
  fixRoute: r.fixRoute,
}))

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]))

/** 每规则的修复提示（Finding.hint；不参与规则表冻结形状）。 */
const RULE_HINTS = {
  'DOC-001': '补齐 project.json 并把 schema 写为 novel-forge/v1',
  'DOC-002': '按报错行号修复 JSON/JSONL；每行一个对象，不要注释',
  'DOC-003': '章节文件统一命名为 chapters/ch-<三位序号>.md',
  'DOC-004': '补齐缺失章节或修正章节序号，保证 1..max 连续',
  'DOC-005': '按 YAML-lite 子集重写 frontmatter：2 空格缩进、首尾 --- 成对',
  'DOC-006': '补写章节正文；空章不得进门禁',
  'DOC-007': '调整章节字数，或改 project.json.chapterWords / chapterWordsTolerance',
  'DOC-008': '在 summaries.md 补 `## ch-<序号> 标题` + 1-3 句摘要',
  'SPACE-001': '在 bible/space.json.places 注册该地点，或改场景 place',
  'SPACE-002': '在地点图补路径（edges），或改场景地点/补转场',
  'SPACE-003': '改写转场：加时间跳跃、改地点，或补交通方式与耗时',
  'SPACE-004': '检查两个场景的时间窗/在场名单，删除分身或改时间',
  'SPACE-005': '把该角色加入本场景 cast，或改 who',
  'TIME-001': '调整同章场景顺序或 clock；确属回忆请标 flashback: true',
  'TIME-002': '检查跨章时间线；确属回忆请标 flashback: true',
  'TIME-003': '拉开两个场景的时间窗，或改成同一地点',
  'TIME-004': '修正 light 或 clock，或调 project.json.daylight',
  'TIME-005': '修正 age / birthYear / storyYear 三者之一',
  'TIME-006': '统一章节级 day 与首个场景 day',
  'TIME-007': '标 flashback: true 或修正场景时间',
  'PHYS-001': '降低动作 intensity 或调整伤势/时间线',
  'PHYS-002': '删除重现，或补合理的重新获得（create/find 并说明来源）',
  'PHYS-003': '修正 transfer.from 为当前持有者，或先补持有事件',
  'PHYS-004': '先写持有/创建事件，再 transfer/destroy',
  'PHYS-005': '补资源获取，或调整 delta / 角色卡初始 resources',
  'PHYS-006': '给 cast 补 abilities，或补 envRules 例外说明',
  'PHYS-007': '在 violates 只引用已注册硬规则，且非空 justification 才能豁免',
  'DLG-001': '补前序 knowledge/公开事实，或改台词不依赖该事实',
  'DLG-002': '在 bible/characters.jsonl 注册说话人或纠正 id',
  'DLG-003': '在对象角色 appellations.<speaker> 中登记该称谓，或改用 name/aliases',
  'CHAR-001': '在 bible/characters.jsonl 注册该角色',
  'CHAR-002': '标 flashback: true，或改 cast/改角色 status',
  'CHAR-003': '补角色 abilities，或换动作描述',
  'CHAR-004': '补 goal 与 voice.sentence/tics',
  'CHAR-005': 'id 用 kebab-case 且唯一；status 仅 alive/dead/missing/absent',
  'CHAR-006': '在该章 mentions 登记该死者 id（提及须留审计痕迹）',
  'FACT-001': '合并重复 fact id，保留一致的 statement',
  'FACT-002': '在 bible/facts.jsonl 注册该 fact',
  'FACT-003': '补 knowledge.source，或把该 fact 加入本场景 facts[]',
  'FACT-004': '修正 revealAt / plant / pay 为存在的章节号',
  'HOOK-001': '调整 hooks_plant/hooks_pay 章序',
  'HOOK-002': '尽快回收伏笔，或调 staleAfter / project.staleHookChapters',
  'HOOK-003': '删除 hooks_pay 场景，或把 status 改回 OPEN/PAID',
  'HOOK-004': '在 bible/hooks.jsonl 注册该伏笔',
  'HOOK-005': '补场景卡 goal/conflict/outcome',
  'HOOK-006': '以 frontmatter 派生值为准修正 hooks.jsonl 断言',
  'OUT-001': '在 outline/outline.json 补该章卡，或删除多余章节文件',
  'OUT-002': '在 bible 注册 place/cast/hooks 后再引用',
  'OUT-003': '补写该章章节文件，或删除大纲卡',
  'OUT-004': '让章节 scenes[].id 与大纲卡一致',
  'OUT-005': '对齐大纲卡与 frontmatter 的 place/cast/hooks',
  'VOICE-001': '删除正文中的元信息/草稿标记',
  'VOICE-002': '按 references/anti-ai-voice.md 做定点改写，再重扫',
  'VOICE-003': '拆掉「不是…而是…」等模板句',
  'VOICE-004': '长短句交错，提高句长变化',
  'VOICE-005': '调整段落长度分布',
  'VOICE-006': '替换单一对话标签（道/说），用动作句代替',
  'VOICE-007': '把情绪直给改为动作/细节呈现',
  'VOICE-008': '删掉段末升华句',
  'VOICE-009': '去掉翻译腔结构（对于…来说/在…的情况下等）',
  'VOICE-010': '把心理活动限定在 POV 角色',
  'VOICE-011': '按体检分定位改写，或按三步调参出口处理',
}

const DEFAULT_THRESHOLDS = {
  maxWeightedClichesPer1000: 1.5,
  minVoiceScore: 60,
  minSentenceLengthCV: 0.35,
  maxDialogueTagRatio: 0.7,
  maxEmotionPer1000: 1.2,
  maxTemplateHits: 3,
}
const DEFAULT_DAYLIGHT = { sunrise: '06:30', sunset: '18:00' }
const DEFAULT_VIEWPOINT = { character: '', mode: 'third-limited', tense: 'past' }
const LIGHT_VALUES = new Set(['dawn', 'day', 'dusk', 'night', 'dim'])
const STATUS_VALUES = new Set(['alive', 'dead', 'missing', 'absent'])
const ITEM_OPS = new Set(['create', 'transfer', 'destroy', 'lose', 'find'])
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CHAPTER_FILE_RE = /^ch-(\d{3})\.md$/

/** 计划/进度型断言规则（PRD §5.5 v1.7，修 B2-F1）：全量 lint 照常报，但不并入 `--chapter` 章门禁。 */
const PLAN_PROGRESS_RULES = ['OUT-003', 'FACT-004']

// ---------------------------------------------------------------------------
// 2. 基础工具
// ---------------------------------------------------------------------------

function normText(value) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n')
}

function pad3(n) {
  return String(n).padStart(3, '0')
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function round2(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function round4(n) {
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function stringArray(value) {
  return toArray(value)
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
}

function coerceInt(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10)
  return null
}

function coerceNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function unique(arr) {
  return [...new Set(arr)]
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countCjkChars(text) {
  const m = String(text == null ? '' : text).match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g)
  return m ? m.length : 0
}

function countLatinWords(text) {
  const m = String(text == null ? '' : text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)
  return m ? m.length : 0
}

/** 字数单位（冻结）：CJK 字符数 + 拉丁单词数。 */
function countWords(text) {
  return countCjkChars(text) + countLatinWords(text)
}

function parseClock(value) {
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

function absMinutes(day, clockMinutes) {
  if (!Number.isFinite(day) || !Number.isFinite(clockMinutes)) return null
  return (day - 1) * 1440 + clockMinutes
}

function meanAndCv(values) {
  if (!values.length) return { mean: 0, cv: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean <= 0) return { mean, cv: 0 }
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length
  return { mean, cv: Math.sqrt(variance) / mean }
}

function lineResolver(src) {
  const newlines = []
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) newlines.push(i)
  return function lineAt(pos) {
    let lo = 0
    let hi = newlines.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (newlines[mid] < pos) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }
}

function makeFinding(ruleId, detail = {}) {
  const rule = RULE_BY_ID.get(ruleId) || { dimension: 'structure', severity: 'INFO', fixRoute: 'prose' }
  const file = typeof detail.file === 'string' ? detail.file : ''
  return {
    rule: ruleId,
    dimension: rule.dimension,
    severity: rule.severity,
    message: typeof detail.message === 'string' ? detail.message : ruleId,
    file,
    line: Number.isInteger(detail.line) && detail.line > 0 ? detail.line : 1,
    locator: typeof detail.locator === 'string' ? detail.locator : '',
    fixRoute: rule.fixRoute,
    hint: typeof detail.hint === 'string' && detail.hint ? detail.hint : RULE_HINTS[ruleId] || `按 ${rule.fixRoute} 路由修复`,
  }
}

function sortFindings(findings) {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const da = DIMENSION_INDEX.has(a.f.dimension) ? DIMENSION_INDEX.get(a.f.dimension) : 99
      const db = DIMENSION_INDEX.has(b.f.dimension) ? DIMENSION_INDEX.get(b.f.dimension) : 99
      if (da !== db) return da - db
      return a.i - b.i
    })
    .map((x) => x.f)
}

function dedupeFindings(findings) {
  const seen = new Set()
  const out = []
  for (const f of findings) {
    const key = `${f.rule}|${f.file}|${f.line}|${f.locator}|${f.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

async function isDirectoryPath(target) {
  try {
    const info = await stat(target)
    return info.isDirectory()
  } catch {
    return false
  }
}

async function isFilePath(target) {
  try {
    const info = await stat(target)
    return info.isFile()
  } catch {
    return false
  }
}

/** 递归列出一个目录下的普通文件（返回相对 root 的 posix 路径，稳定排序）。 */
async function listRelativeFiles(root, base = root) {
  const out = []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const abs = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await listRelativeFiles(abs, base)))
    else if (entry.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'))
  }
  return out.sort()
}

/**
 * 读文件；ENOENT 视为「缺失」（返回 text:null 且无 error），其余 IO 失败返回 error。
 */
async function readOptional(file) {
  try {
    const text = await readFile(file, 'utf8')
    return { text }
  } catch (err) {
    if (err && err.code === 'ENOENT') return { text: null }
    return { text: null, error: err }
  }
}

function parseJsonMeta(text) {
  try {
    return { value: JSON.parse(text) }
  } catch (err) {
    const message = String((err && err.message) || err)
    let line = 1
    const pm = /position (\d+)/.exec(message)
    const lm = /line (\d+)/.exec(message)
    if (pm) {
      const pos = Math.min(Number(pm[1]), text.length)
      for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) line++
    } else if (lm) {
      line = Number(lm[1])
    }
    return { error: { message }, line }
  }
}

function parseJsonlMeta(text) {
  const entries = []
  const errors = []
  const lines = normText(text).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (raw === '') continue
    try {
      entries.push({ value: JSON.parse(raw), line: i + 1 })
    } catch (err) {
      errors.push({ line: i + 1, message: `第 ${i + 1} 行 JSON 解析失败：${(err && err.message) || err}` })
    }
  }
  return { entries, errors }
}

function normalizeThresholds(raw) {
  const merged = { ...DEFAULT_THRESHOLDS }
  if (isObject(raw)) {
    for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
      const value = coerceNumber(raw[key])
      if (value != null) merged[key] = value
    }
  }
  return merged
}

function normalizeViewpoint(raw) {
  const src = isObject(raw) ? raw : {}
  return {
    character: typeof src.character === 'string' ? src.character.trim() : '',
    mode: typeof src.mode === 'string' ? src.mode : DEFAULT_VIEWPOINT.mode,
    tense: typeof src.tense === 'string' ? src.tense : DEFAULT_VIEWPOINT.tense,
  }
}

function normalizeDaylight(raw) {
  const src = isObject(raw) ? raw : {}
  return {
    sunrise: typeof src.sunrise === 'string' && parseClock(src.sunrise) != null ? src.sunrise : DEFAULT_DAYLIGHT.sunrise,
    sunset: typeof src.sunset === 'string' && parseClock(src.sunset) != null ? src.sunset : DEFAULT_DAYLIGHT.sunset,
  }
}

function normalizeConfig(raw) {
  const src = isObject(raw) ? raw : {}
  const style = isObject(src.style) ? src.style : {}
  // PRD §5.3 v1.6（修 B2-F2）：显式给出但非对象的 thresholds 视为配置错误 → voice 分析 fail-closed。
  const thresholdsInvalid =
    isObject(src.style) && Object.prototype.hasOwnProperty.call(src.style, 'thresholds') && !isObject(src.style.thresholds)
  const genre = Array.isArray(src.genre) ? stringArray(src.genre) : typeof src.genre === 'string' && src.genre.trim() ? [src.genre.trim()] : []
  return {
    schema: typeof src.schema === 'string' ? src.schema : '',
    title: typeof src.title === 'string' ? src.title.trim() : '',
    slug: typeof src.slug === 'string' ? src.slug.trim() : '',
    lang: typeof src.lang === 'string' && src.lang.trim() ? src.lang.trim() : 'zh-CN',
    genre,
    audience: typeof src.audience === 'string' ? src.audience : '',
    viewpoint: normalizeViewpoint(src.viewpoint),
    chapterWords: coerceNumber(src.chapterWords) != null ? coerceNumber(src.chapterWords) : 3000,
    chapterWordsTolerance: coerceNumber(src.chapterWordsTolerance) != null ? coerceNumber(src.chapterWordsTolerance) : 0.2,
    staleHookChapters: coerceNumber(src.staleHookChapters) != null ? coerceNumber(src.staleHookChapters) : 5,
    storyYear: coerceNumber(src.storyYear),
    daylight: normalizeDaylight(src.daylight),
    hardRules: toArray(src.hardRules).filter((r) => isObject(r) && typeof r.id === 'string' && r.id.trim()),
    envRules: toArray(src.envRules).filter((r) => isObject(r) && typeof r.env === 'string' && r.env.trim()),
    style: {
      forbiddenWords: stringArray(style.forbiddenWords),
      thresholds: normalizeThresholds(style.thresholds),
      thresholdsInvalid,
    },
  }
}

function mergeProjectConfig(base, override) {
  if (!isObject(override)) return base
  const merged = { ...base }
  for (const key of Object.keys(override)) {
    if (key === 'style' || key === 'viewpoint' || key === 'daylight') continue
    merged[key] = override[key]
  }
  const overrideStyle = isObject(override.style) ? override.style : null
  const overrideThresholdsProvided = overrideStyle
    ? Object.prototype.hasOwnProperty.call(overrideStyle, 'thresholds')
    : false
  const thresholdsInvalid = overrideThresholdsProvided
    ? !isObject(overrideStyle.thresholds)
    : base.style.thresholdsInvalid === true
  merged.style = {
    forbiddenWords: Array.isArray(override.style && override.style.forbiddenWords)
      ? stringArray(override.style.forbiddenWords)
      : base.style.forbiddenWords,
    thresholds: normalizeThresholds({ ...base.style.thresholds, ...(isObject(override.style) ? override.style.thresholds : {}) }),
    thresholdsInvalid,
  }
  merged.viewpoint = normalizeViewpoint({ ...base.viewpoint, ...(isObject(override.viewpoint) ? override.viewpoint : {}) })
  merged.daylight = normalizeDaylight({ ...base.daylight, ...(isObject(override.daylight) ? override.daylight : {}) })
  if (override.lang != null) merged.lang = String(override.lang)
  return merged
}

// ---------------------------------------------------------------------------
// 3. YAML-lite 解析（PRD §4.9）
// ---------------------------------------------------------------------------

const YAML_DEPTH_LIMIT = 6

function isListItemText(text) {
  return text === '-' || text.startsWith('- ')
}

function matchKeyValue(text) {
  if (typeof text !== 'string') return null
  const m = /^([^\s:][^:]*?):(?:[ \t]+(.*))?$/.exec(text)
  if (!m) return null
  const key = m[1].trim()
  if (key === '') return null
  return { key, rawValue: m[2] == null ? '' : m[2].trim() }
}

function splitTopLevel(text, sep) {
  const out = []
  let buf = ''
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      buf += ch
      if (ch === quote && text[i - 1] !== '\\') quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '[' || ch === '{') {
      depth++
      buf += ch
      continue
    }
    if (ch === ']' || ch === '}') {
      depth--
      buf += ch
      continue
    }
    if (ch === sep && depth === 0) {
      out.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim() !== '') out.push(buf.trim())
  return out
}

function parseInlineValue(raw, tok) {
  const s = String(raw == null ? '' : raw).trim()
  if (s === '' || s === '~') return { value: null }
  if (/^[|>]/.test(s)) return { error: '不支持块标量（| / >）' }
  if (/^[&*]/.test(s)) return { error: '不支持锚点/别名（& / *）' }
  if (s.startsWith('"')) {
    if (s.length < 2 || !s.endsWith('"')) return { error: '双引号字符串未闭合' }
    return { value: s.slice(1, -1).replace(/\\"/g, '"') }
  }
  if (s.startsWith("'")) {
    if (s.length < 2 || !s.endsWith("'")) return { error: '单引号字符串未闭合' }
    return { value: s.slice(1, -1).replace(/''/g, "'") }
  }
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) return { error: '行内数组未闭合' }
    const inner = s.slice(1, -1).trim()
    if (inner === '') return { value: [] }
    const arr = []
    for (const part of splitTopLevel(inner, ',')) {
      const parsed = parseInlineValue(part, tok)
      if (parsed.error) return { error: parsed.error }
      arr.push(parsed.value)
    }
    return { value: arr }
  }
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) return { error: '行内对象未闭合' }
    const inner = s.slice(1, -1).trim()
    const obj = {}
    if (inner === '') return { value: obj }
    for (const part of splitTopLevel(inner, ',')) {
      const kv = matchKeyValue(part)
      if (!kv) return { error: `行内对象成员无法解析：${part}` }
      if (kv.rawValue === '') return { error: `行内对象成员缺值：${part}` }
      const parsed = parseInlineValue(kv.rawValue, tok)
      if (parsed.error) return { error: parsed.error }
      obj[kv.key] = parsed.value
    }
    return { value: obj }
  }
  if (/^true$/i.test(s)) return { value: true }
  if (/^false$/i.test(s)) return { value: false }
  if (/^null$/i.test(s)) return { value: null }
  if (/^[+-]?\d+$/.test(s)) return { value: Number.parseInt(s, 10) }
  if (/^[+-]?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return { value: Number.parseFloat(s) }
  return { value: s }
}

/**
 * 解析 YAML-lite（PRD §4.9 子集）。
 * @returns `{ok, value, errors:[{message,line}], notices:[{message,line}]}`
 */
function parseYamlLite(lines, firstLineNo) {
  const errors = []
  const notices = []
  const toks = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw == null) continue
    if (/^\s*$/.test(raw)) continue
    const leadMatch = /^[ \t]*/.exec(raw)
    const lead = leadMatch ? leadMatch[0] : ''
    if (lead.includes('\t')) {
      errors.push({ message: '缩进不允许使用 tab', line: firstLineNo + i })
      continue
    }
    const indent = lead.length
    if (indent % 2 !== 0) {
      errors.push({ message: '缩进必须是 2 个空格的倍数', line: firstLineNo + i })
      continue
    }
    const text = raw.slice(indent)
    if (text === '' || text.startsWith('#')) continue
    toks.push({ line: firstLineNo + i, indent, text })
  }

  if (toks.length === 0) return { ok: errors.length === 0, value: {}, errors, notices }

  let cursor = 0
  const peek = () => (cursor < toks.length ? toks[cursor] : null)
  const fail = (message, tok) => errors.push({ message, line: tok ? tok.line : firstLineNo })

  function parseBlock(indent, depth) {
    const tok = peek()
    if (!tok) return null
    if (tok.indent < indent) return null
    if (depth > YAML_DEPTH_LIMIT) {
      fail('嵌套深度超过 6', tok)
      while (cursor < toks.length && toks[cursor].indent >= indent) cursor++
      return null
    }
    if (tok.indent > indent) {
      fail('缩进不一致', tok)
      while (cursor < toks.length && toks[cursor].indent >= tok.indent) cursor++
      return null
    }
    if (isListItemText(tok.text)) return parseList(indent, depth)
    return parseMap(indent, depth, {})
  }

  function assignKey(map, tok, parentIndent, depth) {
    const kv = matchKeyValue(tok.text)
    if (!kv) {
      fail(`无法解析键值行：${tok.text.trim()}`, tok)
      cursor++
      return
    }
    cursor++
    let value
    if (kv.rawValue === '') {
      const next = peek()
      if (next && next.indent > parentIndent) value = parseBlock(next.indent, depth + 1)
      else value = null
    } else {
      const parsed = parseInlineValue(kv.rawValue, tok)
      if (parsed.error) {
        fail(parsed.error, tok)
        value = null
      } else {
        value = parsed.value
      }
    }
    if (Object.prototype.hasOwnProperty.call(map, kv.key)) notices.push({ message: `重复键：${kv.key}`, line: tok.line })
    map[kv.key] = value
  }

  function parseMap(indent, depth, seed) {
    const map = seed || {}
    while (cursor < toks.length) {
      const tok = peek()
      if (!tok) break
      if (tok.indent < indent) break
      if (tok.indent > indent) {
        fail('缩进不一致', tok)
        cursor++
        continue
      }
      if (isListItemText(tok.text)) break
      assignKey(map, tok, indent, depth)
    }
    return map
  }

  function parseList(indent, depth) {
    const arr = []
    while (cursor < toks.length) {
      const tok = peek()
      if (!tok) break
      if (tok.indent < indent) break
      if (tok.indent > indent) {
        fail('缩进不一致', tok)
        cursor++
        continue
      }
      if (!isListItemText(tok.text)) break
      const content = tok.text === '-' ? '' : tok.text.slice(2)
      cursor++
      if (content === '') {
        const next = peek()
        if (next && next.indent > indent) arr.push(parseBlock(next.indent, depth + 1))
        else arr.push(null)
        continue
      }
      if (content.startsWith('{') || content.startsWith('[') || content.startsWith('"') || content.startsWith("'")) {
        const parsed = parseInlineValue(content, tok)
        if (parsed.error) {
          fail(parsed.error, tok)
          arr.push(null)
        } else {
          arr.push(parsed.value)
        }
        continue
      }
      const kv = matchKeyValue(content)
      if (kv) {
        const itemMap = {}
        const mapIndent = indent + 2
        let firstValue
        if (kv.rawValue === '') {
          const next = peek()
          if (next && next.indent > mapIndent) firstValue = parseBlock(next.indent, depth + 2)
          else firstValue = null
        } else {
          const parsed = parseInlineValue(kv.rawValue, tok)
          if (parsed.error) {
            fail(parsed.error, tok)
            firstValue = null
          } else {
            firstValue = parsed.value
          }
        }
        itemMap[kv.key] = firstValue
        const nextTok = peek()
        if (nextTok && nextTok.indent > indent) {
          if (!isListItemText(nextTok.text) || nextTok.indent > mapIndent) parseMap(nextTok.indent, depth + 1, itemMap)
        }
        arr.push(itemMap)
        continue
      }
      const parsed = parseInlineValue(content, tok)
      if (parsed.error) {
        fail(parsed.error, tok)
        arr.push(null)
      } else {
        arr.push(parsed.value)
      }
    }
    return arr
  }

  if (toks[0].indent !== 0) {
    fail('顶层必须是 0 缩进的键值对', toks[0])
    while (cursor < toks.length) cursor++
    return { ok: false, value: {}, errors, notices }
  }

  const root = parseBlock(0, 1)
  while (cursor < toks.length) {
    fail(`无法解析的内容行：${(peek() || {}).text || ''}`, peek())
    cursor++
  }
  if (root != null && !isObject(root)) fail('frontmatter 顶层必须是映射', toks[0])
  return { ok: errors.length === 0, value: isObject(root) ? root : {}, errors, notices }
}

/**
 * 解析章节文本（frontmatter + 正文）。
 * @returns `{ok, frontmatter, body, bodyLine, errors, notices}`
 */
function parseChapterText(text) {
  const src = normText(text)
  const lines = src.split('\n')
  const errors = []
  const notices = []
  const firstLine = lines.length ? lines[0].trim() : ''
  if (firstLine !== '---') {
    errors.push({ message: '缺少 frontmatter 起始 --- 行', line: 1 })
    return { ok: false, frontmatter: null, body: src, bodyLine: 1, errors, notices }
  }
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) {
    errors.push({ message: 'frontmatter 缺少结束 --- 行', line: Math.max(1, lines.length) })
    return { ok: false, frontmatter: null, body: '', bodyLine: lines.length + 1, errors, notices }
  }
  const fmLines = lines.slice(1, closeIdx)
  const parsed = parseYamlLite(fmLines, 2)
  errors.push(...parsed.errors)
  notices.push(...parsed.notices)
  const bodyLines = lines.slice(closeIdx + 1)
  const body = bodyLines.join('\n')
  const bodyLine = closeIdx + 2
  for (let i = 0; i < bodyLines.length; i++) {
    if (bodyLines[i].trim() === '') continue
    if (bodyLines[i].trim() === '---') errors.push({ message: '不支持多文档 --- 块', line: bodyLine + i })
    break
  }
  const frontmatter = isObject(parsed.value) ? parsed.value : null
  return { ok: errors.length === 0, frontmatter, body, bodyLine, errors, notices }
}

/** 取 frontmatter 内与场景同级的 `- ` 行号（按出现顺序）。 */
function frontmatterSceneLines(text) {
  const lines = normText(text).split('\n')
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) return []
  const items = []
  for (let i = 1; i < closeIdx; i++) {
    const m = /^( *)-[ ]/.exec(lines[i])
    if (m) items.push({ indent: m[1].length, line: i + 1 })
  }
  if (!items.length) return []
  const minIndent = Math.min(...items.map((it) => it.indent))
  return items.filter((it) => it.indent === minIndent).map((it) => it.line)
}

// ---------------------------------------------------------------------------
// 4. 反 AI 腔词表与评分（PRD §5.3）
// ---------------------------------------------------------------------------

// 中文词表与 references/anti-ai-voice.md §2 全表逐条对齐（文档 = PRD §5.3 声明的全表）。
const ZH_VOICE = {
  strong: [
    '嘴角勾起', '勾起一抹', '闪过一丝', '眼底闪过', '瞳孔骤缩', '瞳孔微缩', '深吸一口气', '缓缓吐出一口气', '空气仿佛凝固', '空气仿佛安静下来',
    '心中一沉', '心头一紧', '说不清道不明', '若有所思', '意味深长', '似笑非笑', '目光深邃', '深邃的目光', '语气不容置疑', '浑身一震',
    '如遭雷击', '血液仿佛凝固', '时间仿佛静止', '一抹不易察觉的', '心中五味杂陈', '百感交集', '喉咙发紧', '呼吸一滞', '嘴角的弧度', '缓缓闭上眼',
  ],
  weak: ['突然', '忽然', '瞬间', '仿佛', '似乎', '某种', '意识到', '缓缓', '轻轻', '微微', '不由得', '忍不住'],
  templates: [
    /不是[^。！？\n]{1,40}而是/,
    /不仅[^。！？\n]{1,40}而且/,
    /与此同时/,
    /这一刻/,
    /就在这时/,
    /仿佛整个世界[^。！？\n]{0,12}/,
    /是的[，,]/,
    /换句话说/,
    /总而言之/,
    /值得一提的是/,
  ],
  translationese: [
    /作为一个[^，。！？\n]{1,16}[，,]/,
    /当[^。！？\n]{1,40}的时候/,
    /[^。！？\n]{1,20}之一/,
    /在[^。！？\n]{1,20}(?:的情况|的条件|的时候)下/,
    /对于[^，。！？\n]{1,16}(?:来说|而言)/,
    /(?:这|那)是(?:一个|一种)[^。！？\n]{1,24}的(?:方式|过程|结果|方法)/,
  ],
  emotion: ['愤怒', '悲伤', '恐惧', '激动', '震惊', '绝望', '痛苦', '兴奋', '紧张', '愧疚', '焦虑', '厌恶'],
  summaryEndings: [
    /(?:一切|这|那)[^。！？\n]{0,8}(?:才|只是|仅仅)?[^。！？\n]{0,6}开始/,
    /命运(?:的)?齿轮/,
    /一切[^。！？\n]{0,10}(?:都将?不同|都变了|都会不同|已然不同|都不一样)/,
    /(?:他|她|他们|她们|我|我们)不知道的是/,
    /(?:仅仅|只是)[^。！？\n]{0,16}(?:的开始|刚开始)/,
    /(?:多年|许多年|很多年|若干年|数年)(?:以后|之后)/,
    /直到[^。！？\n]{0,24}(?:才(?:明白|懂得|知道|懂))/,
  ],
}

const EN_VOICE = {
  strong: [
    'delve', 'tapestry', 'testament to', 'a mix of', 'little did', 'in the ever-evolving',
    /shiver down (?:his|her) spine/i,
    'heart sank',
    'time seemed to stand still',
    'the air was thick with',
    /let out a breath (?:he|she) didn't know/i,
    'a ghost of a smile',
  ],
  weak: [
    'suddenly', 'just then', 'somehow', 'seemed to', 'a sense of', 'at that moment',
    "couldn't help", 'felt a pang', 'slowly', 'gently', 'barely', 'almost imperceptibly',
  ],
  templates: [
    /not just\b[^.!?\n]{0,60}\bbut\b/i,
    /on the one hand\b[^.!?\n]{0,80}\bon the other\b/i,
    /little did\b[^.!?\n]{0,40}\bknow\b/i,
    /\bif\b[^.!?\n]{0,50}\bthen\b/i,
    /\bthis is not\b/i,
    /\bit was then that\b/i,
    /\bat the end of the day\b/i,
    /\bin other words\b/i,
    /\ball in all\b/i,
    /\bwhat's more\b/i,
    /\bit goes without saying\b/i,
  ],
  translationese: [],
  emotion: [],
  summaryEndings: [],
}

const ZH_TAG_RE = /["”』」][^。！？!?\n]{0,30}?(说道|问道|答道|笑道|叫道|喊道|喝道|冷冷道|低声道|沉声道|轻声道|开口道|开口说|回答说|喃喃道|嘟囔道|接话|开口|道|说|问|答|喊|叫)/g
const META_INFO_PATTERNS = [
  { re: /\[说明\]/g, label: '[说明]' },
  { re: /（注[:：]/g, label: '（注：' },
  { re: /【写作/g, label: '【写作' },
  { re: /\bTODO\b/gi, label: 'TODO' },
  { re: /作者按/g, label: '作者按' },
  { re: /\[AI addition/gi, label: '[AI addition' },
]
const POV_MARKER_RE = /心想|心里想|心中想|暗想|暗自/

function cloneGlobalRegex(re) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  return new RegExp(re.source, flags)
}

function scanPhrase(src, phrase) {
  const positions = []
  if (!phrase) return positions
  let idx = src.indexOf(phrase)
  while (idx !== -1) {
    positions.push(idx)
    idx = src.indexOf(phrase, idx + phrase.length)
  }
  return positions
}

function scanRegexAll(re, src) {
  const out = []
  const regex = cloneGlobalRegex(re)
  regex.lastIndex = 0
  let m
  while ((m = regex.exec(src)) !== null) {
    out.push({ index: m.index, text: m[0] })
    if (m[0] === '') regex.lastIndex++
  }
  return out
}

function emptyVoice() {
  return {
    score: 100,
    hitsPer1000: 0,
    weightedHits: 0,
    weightedHitsPer1000: 0,
    strongHits: 0,
    weakHits: 0,
    forbiddenHits: 0,
    templateHits: 0,
    rhythmCV: null,
    meanSentenceLen: 0,
    paragraphCV: null,
    tagRatio: 0,
    tagTotal: 0,
    topTag: '',
    emotionPer1000: 0,
    summaryEndings: 0,
    translationese: 0,
    unit: 0,
    skipped: ['rhythm', 'paragraph'],
    lineRefs: [],
  }
}

/** fail-closed 的 voice 结果（PRD §5.3 v1.6，修 B2-F2）：分析失败时 score=0 并保留 error 信息。 */
function failVoice(reason) {
  const voice = emptyVoice()
  voice.score = 0
  voice.error = `语音分析失败：${reason}`
  return voice
}

/** fail-closed 时 VOICE-011 的统一文案（message 注明「语音分析失败，按 0 分处理」）。 */
function voiceFailMessage(aiVoice) {
  const error = typeof aiVoice.error === 'string' ? aiVoice.error : ''
  const detail = error.replace(/^语音分析失败：/, '')
  return detail ? `语音分析失败，按 0 分处理：${detail}` : '语音分析失败，按 0 分处理'
}

/**
 * 反 AI 腔评分（PRD §5.3 冻结公式）。
 * @param {string} text 正文
 * @param {object} [options] `{lang?, thresholds?, forbiddenWords?, config?}`
 */
export function analyzeVoice(text, options = {}) {
  try {
    const opts = isObject(options) ? options : {}
    // PRD §5.3 v1.6（修 B2-F2）：显式传入非法 thresholds（null/非对象）视为分析失败 → fail-closed，
    // 不得静默退化到默认阈值后给出满分（该异常由下方 catch 统一转成 score=0 + error）。
    if (Object.prototype.hasOwnProperty.call(opts, 'thresholds') && opts.thresholds !== undefined && !isObject(opts.thresholds)) {
      throw new TypeError('thresholds 非法：必须是对象')
    }
    const src = normText(text)
    const cfg = isObject(opts.config) ? opts.config : {}
    const thresholds = normalizeThresholds(
      isObject(opts.thresholds) ? opts.thresholds : isObject(cfg.style) ? cfg.style.thresholds : {}
    )
    const forbiddenWords = unique(
      stringArray(
        Array.isArray(opts.forbiddenWords)
          ? opts.forbiddenWords
          : isObject(cfg.style)
            ? cfg.style.forbiddenWords
            : []
      )
    )
    const lineAt = lineResolver(src)
    const unit = countWords(src)
    const cjk = countCjkChars(src)
    const latin = countLatinWords(src)
    let lang = typeof opts.lang === 'string' && opts.lang ? opts.lang : typeof cfg.lang === 'string' ? cfg.lang : ''
    if (!lang) lang = cjk < 10 && latin > 20 ? 'en' : 'zh-CN'
    const isEn = String(lang).toLowerCase().startsWith('en')
    const table = isEn ? EN_VOICE : ZH_VOICE
    const scanSrc = isEn ? src.toLowerCase() : src

    const lineRefs = []
    // 行号口径（文档 §3.5）：正文内行号，不含 frontmatter 偏移（报告层自行加偏移）。
    const pushRef = (index, phrase, kind) => {
      if (lineRefs.length >= 2000) return
      lineRefs.push({ line: lineAt(index), phrase, kind })
    }

    // 字符串 = 子串匹配；RegExp = 正则匹配（英文按词边界由正则自身表达）。
    const scanList = (patterns, kind) => {
      let count = 0
      for (const pattern of patterns) {
        if (pattern instanceof RegExp) {
          const hits = scanRegexAll(pattern, src)
          count += hits.length
          for (const hit of hits) pushRef(hit.index, hit.text, kind)
        } else {
          const needle = isEn ? String(pattern).toLowerCase() : String(pattern)
          const hits = scanPhrase(scanSrc, needle)
          count += hits.length
          for (const pos of hits) pushRef(pos, pattern, kind)
        }
      }
      return count
    }
    const strongHits = scanList(table.strong, 'strong')
    const weakHits = scanList(table.weak, 'weak')
    const forbiddenHits = scanList(forbiddenWords, 'forbidden')
    const templateHits = scanList(table.templates, 'template')
    const translationese = scanList(table.translationese, 'translationese')

    let emotionCount = 0
    if (table.emotion.length) {
      const emotionRe = new RegExp(`(${table.emotion.join('|')})`, 'g')
      const hits = scanRegexAll(emotionRe, src)
      emotionCount = hits.length
      for (const hit of hits) pushRef(hit.index, hit.text, 'emotion')
    }

    // 对话标签
    const tagCounts = new Map()
    let tagTotal = 0
    {
      const regex = cloneGlobalRegex(ZH_TAG_RE)
      let m
      while ((m = regex.exec(src)) !== null) {
        tagTotal++
        const tag = m[1]
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
        if (m[0] === '') regex.lastIndex++
      }
    }
    let topTag = ''
    let topTagCount = 0
    for (const [tag, count] of tagCounts) {
      if (count > topTagCount) {
        topTag = tag
        topTagCount = count
      }
    }

    // 句长/段长
    const sentences = src
      .split(/[。！？!?…\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const { mean: meanSentenceLen, cv: rawRhythmCv } = meanAndCv(sentences.map((s) => s.length))
    const paragraphs = src
      .split(/\n[ \t]*\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
    const { cv: rawParagraphCv } = meanAndCv(paragraphs.map((p) => p.length))

    // 段末升华（对每段最后一句匹配 7 条模式）
    let summaryEndings = 0
    for (const paragraph of paragraphs) {
      const sentencesOfParagraph = paragraph
        .split(/[。！？!?…]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const last = sentencesOfParagraph.length ? sentencesOfParagraph[sentencesOfParagraph.length - 1] : ''
      if (!last) continue
      if (table.summaryEndings.some((re) => cloneGlobalRegex(re).test(last))) {
        summaryEndings++
        const pos = src.indexOf(last)
        if (pos !== -1) pushRef(pos, last.slice(0, 16), 'summary')
      }
    }

    const shortText = unit < 500
    const rhythmCV = shortText ? null : round2(rawRhythmCv)
    const paragraphCV = shortText ? null : round2(rawParagraphCv)
    const weightedHitsRaw = strongHits + weakHits * 0.25 + forbiddenHits
    const hitsRaw = strongHits + weakHits + forbiddenHits
    const result = {
      score: 0,
      hitsPer1000: unit > 0 ? round2((hitsRaw / unit) * 1000) : 0,
      weightedHits: round2(weightedHitsRaw),
      weightedHitsPer1000: unit > 0 ? round2((weightedHitsRaw / unit) * 1000) : 0,
      strongHits,
      weakHits,
      forbiddenHits,
      templateHits,
      rhythmCV,
      meanSentenceLen: round2(meanSentenceLen),
      paragraphCV,
      tagRatio: tagTotal > 0 ? round2(topTagCount / tagTotal) : 0,
      tagTotal,
      topTag,
      emotionPer1000: unit > 0 ? round2((emotionCount / unit) * 1000) : 0,
      summaryEndings,
      translationese,
      unit,
      skipped: shortText ? ['rhythm', 'paragraph'] : [],
      lineRefs,
    }
    const minCv = thresholds.minSentenceLengthCV
    let score = 100
    score -= Math.min(45, result.weightedHitsPer1000 * 12)
    score -= Math.min(15, result.templateHits * 3)
    if (result.rhythmCV !== null) score -= result.rhythmCV < minCv ? 10 : result.rhythmCV < minCv + 0.1 ? 5 : 0
    score -= Math.min(10, result.emotionPer1000 * 4)
    score -= Math.min(10, result.translationese * 3)
    score -= Math.min(10, result.summaryEndings * 2)
    result.score = Math.round(clamp(score, 0, 100))
    return result
  } catch (err) {
    // PRD §5.3 v1.6（修 B2-F2）：fail-closed —— 内部异常不得返回满分放行。
    // 返回 score: 0 + error 信息，由调用方经 voiceFindingsFor 产出 VOICE-011 MAJOR（不得抛异常）。
    return failVoice((err && err.message) || String(err))
  }
}

// ---------------------------------------------------------------------------
// 5. 正文局部规则（lintChapterText / prose 共用）
// ---------------------------------------------------------------------------

function scanMetaInfo(body) {
  const hits = []
  for (const pattern of META_INFO_PATTERNS) {
    const matched = scanRegexAll(pattern.re, body)
    for (const hit of matched) hits.push({ index: hit.index, phrase: pattern.label })
  }
  hits.sort((a, b) => a.index - b.index)
  return hits
}

function voiceFindingsFor(job) {
  const { aiVoice, body, bodyStartLine, file, locator, cfg } = job
  const findings = []
  const thresholds = cfg.style.thresholds
  const lineAt = lineResolver(normText(body))
  const absLine = (relative) => bodyStartLine + relative - 1

  for (const hit of scanMetaInfo(normText(body)).slice(0, 50)) {
    findings.push(
      makeFinding('VOICE-001', {
        message: `正文含元信息「${hit.phrase}」`,
        file,
        line: absLine(lineAt(hit.index)),
        locator,
      })
    )
  }

  if (aiVoice.weightedHitsPer1000 > thresholds.maxWeightedClichesPer1000) {
    findings.push(
      makeFinding('VOICE-002', {
        message: `weightedHitsPer1000=${aiVoice.weightedHitsPer1000} 超过阈值 ${thresholds.maxWeightedClichesPer1000}（strong=${aiVoice.strongHits} weak=${aiVoice.weakHits}）`,
        file,
        line: bodyStartLine,
        locator,
      })
    )
  }
  if (aiVoice.templateHits > thresholds.maxTemplateHits) {
    findings.push(
      makeFinding('VOICE-003', {
        message: `templateHits=${aiVoice.templateHits} 超过 maxTemplateHits=${thresholds.maxTemplateHits}`,
        file,
        line: bodyStartLine,
        locator,
      })
    )
  }
  if (aiVoice.rhythmCV !== null && aiVoice.rhythmCV < thresholds.minSentenceLengthCV) {
    findings.push(
      makeFinding('VOICE-004', {
        message: `rhythmCV=${aiVoice.rhythmCV} 低于 minSentenceLengthCV=${thresholds.minSentenceLengthCV}`,
        file,
        line: bodyStartLine,
        locator,
      })
    )
  }
  if (aiVoice.paragraphCV !== null && aiVoice.paragraphCV < 0.3) {
    findings.push(
      makeFinding('VOICE-005', {
        message: `paragraphCV=${aiVoice.paragraphCV} 低于 0.30`,
        file,
        line: bodyStartLine,
        locator,
      })
    )
  }
  if (aiVoice.tagTotal >= 6 && aiVoice.tagRatio > thresholds.maxDialogueTagRatio) {
    findings.push(
      makeFinding('VOICE-006', {
        message: `对话标签 top「${aiVoice.topTag}」占比 ${aiVoice.tagRatio} > maxDialogueTagRatio=${thresholds.maxDialogueTagRatio}（tagTotal=${aiVoice.tagTotal}）`,
        file,
        line: bodyStartLine,
        locator,
      })
    )
  }
  if (aiVoice.emotionPer1000 > thresholds.maxEmotionPer1000) {
    findings.push(
      makeFinding('VOICE-007', {
        message: `emotionPer1000=${aiVoice.emotionPer1000} 超过 maxEmotionPer1000=${thresholds.maxEmotionPer1000}`,
        file,
        line: bodyStartLine,
        locator,
      })
    )
  }
  if (aiVoice.summaryEndings >= 3) {
    findings.push(
      makeFinding('VOICE-008', {
        message: `summaryEndings=${aiVoice.summaryEndings} ≥ 3（段末升华句过多）`,
        file,
        line: bodyStartLine,
        locator,
      })
    )
  }
  if (aiVoice.translationese >= 2) {
    findings.push(
      makeFinding('VOICE-009', {
        message: `translationese=${aiVoice.translationese} ≥ 2（翻译腔结构过多）`,
        file,
        line: bodyStartLine,
        locator,
      })
    )
  }
  if (aiVoice.score < thresholds.minVoiceScore) {
    // PRD §5.3 v1.6（修 B2-F2）：分析异常时 fail-closed，message 明确「按 0 分处理」。
    const analysisFailed = typeof aiVoice.error === 'string' && aiVoice.error !== ''
    findings.push(
      makeFinding('VOICE-011', {
        message: analysisFailed ? voiceFailMessage(aiVoice) : `反 AI 腔体检分 ${aiVoice.score} < minVoiceScore=${thresholds.minVoiceScore}`,
        file,
        line: bodyStartLine,
        locator,
      })
    )
  }

  // VOICE-010：POV 越界（仅在配置了 viewpoint.character 时执行）
  const povId = cfg.viewpoint && cfg.viewpoint.character ? cfg.viewpoint.character : ''
  if (povId) {
    const characters = Array.isArray(cfg.characters) ? cfg.characters : []
    const povChar = characters.find((c) => c && c.id === povId)
    const others = characters.filter((c) => c && c.id !== povId)
    const povNames = povChar ? [povChar.name, ...(povChar.aliases || [])].filter((n) => typeof n === 'string' && n.length >= 2) : []
    const nonPovNames = []
    for (const other of others) {
      for (const name of [other.name, ...(other.aliases || [])]) {
        if (typeof name === 'string' && name.length >= 2) nonPovNames.push(name)
      }
    }
    if (nonPovNames.length) {
      const sentenceRegex = /[^。！？!?\n]+[。！？!?]?/g
      let m
      while ((m = sentenceRegex.exec(normText(body))) !== null) {
        const sentence = m[0]
        if (!POV_MARKER_RE.test(sentence)) continue
        const hasPov = povNames.some((name) => sentence.includes(name))
        if (hasPov) continue
        const other = nonPovNames.find((name) => sentence.includes(name))
        if (!other) continue
        findings.push(
          makeFinding('VOICE-010', {
            message: `非 POV 角色「${other}」句中含心理活动标记：${sentence.trim().slice(0, 40)}`,
            file,
            line: absLine(lineAt(m.index)),
            locator,
          })
        )
      }
    }
  }
  return findings
}

function buildVoiceContext(cfg) {
  return {
    style: cfg.style,
    viewpoint: cfg.viewpoint,
    lang: cfg.lang,
    characters: Array.isArray(cfg.characters) ? cfg.characters : [],
  }
}

/**
 * 反 AI 腔体检 + 规则产出（PRD §5.3 v1.6 fail-closed，修 B2-F2）。
 * 任何 voice 阶段异常都转成 `score: 0` + `VOICE-011 MAJOR`（message 注明「按 0 分处理」），绝不抛异常。
 * lintChapterText / lintProject（逐章）/ prose（经 lintChapterText）共用本入口。
 * @returns `{aiVoice, findings}`
 */
function runVoiceStage(body, bodyStartLine, file, locator, cfg) {
  const style = isObject(cfg && cfg.style) ? cfg.style : {}
  const failed = (reason) => {
    const aiVoice = failVoice(reason)
    return {
      aiVoice,
      findings: [makeFinding('VOICE-011', { message: voiceFailMessage(aiVoice), file, line: bodyStartLine, locator })],
    }
  }
  // 配置层已标记 thresholds 非法（project.json / options.config）→ 直接 fail-closed。
  if (style.thresholdsInvalid === true) return failed('style.thresholds 非法：必须是对象')
  try {
    const aiVoice = analyzeVoice(body, {
      lang: cfg && cfg.lang,
      thresholds: style.thresholds,
      forbiddenWords: style.forbiddenWords,
      config: cfg,
    })
    return { aiVoice, findings: voiceFindingsFor({ aiVoice, body, bodyStartLine, file, locator, cfg }) }
  } catch (err) {
    return failed((err && err.message) || String(err))
  }
}

// ---------------------------------------------------------------------------
// 6. lintChapterText（无项目上下文；只产出 DOC-005/006/007 + VOICE-001..011）
// ---------------------------------------------------------------------------

function normalizeChapterFrontmatter(fm) {
  return fm
}

/**
 * 文本局部体检。
 * @param {string} text
 * @param {object} [options] `{config?, file?, locator?}`
 * @returns `{frontmatter, findings, aiVoice, stats}`
 */
export function lintChapterText(text, options = {}) {
  const opts = isObject(options) ? options : {}
  try {
    const cfg = normalizeConfig(opts.config)
    const isEn = String(cfg.lang).toLowerCase().startsWith('en')
    const voiceCfg = buildVoiceContext({ ...cfg, lang: isEn ? 'en' : 'zh-CN' })
    const src = normText(text)
    const parsed = parseChapterText(src)
    const fm = isObject(parsed.frontmatter) ? parsed.frontmatter : null
    const chapterNumber = fm ? coerceInt(fm.chapter) : null
    const file = typeof opts.file === 'string' && opts.file ? opts.file : chapterNumber != null ? `chapters/ch-${pad3(chapterNumber)}.md` : 'prose'
    const locator = typeof opts.locator === 'string' && opts.locator ? opts.locator : chapterNumber != null ? `ch-${pad3(chapterNumber)}` : ''
    const findings = []

    if (!parsed.ok) {
      for (const err of parsed.errors) {
        findings.push(makeFinding('DOC-005', { message: `frontmatter 解析失败：${err.message}`, file, line: err.line, locator }))
      }
    } else {
      if (chapterNumber == null) {
        findings.push(makeFinding('DOC-005', { message: 'frontmatter 缺少整数 chapter 字段', file, line: 1, locator }))
      }
      if (fm && fm.scenes !== undefined && fm.scenes !== null && !Array.isArray(fm.scenes)) {
        findings.push(makeFinding('DOC-005', { message: 'frontmatter.scenes 必须是列表', file, line: 1, locator }))
      }
    }

    const body = parsed.body
    const words = countWords(body)
    if (String(body).replace(/\s+/g, '') === '') {
      findings.push(makeFinding('DOC-006', { message: '章节正文（去 frontmatter）去空白后为空', file, line: parsed.bodyLine, locator }))
    }

    const explicitChapterWords = isObject(opts.config) ? coerceNumber(opts.config.chapterWords) : null
    if (explicitChapterWords != null && explicitChapterWords > 0 && cfg.chapterWordsTolerance >= 0) {
      const tolerance = cfg.chapterWordsTolerance
      const low = explicitChapterWords * (1 - tolerance)
      const high = explicitChapterWords * (1 + tolerance)
      if (words < low || words > high) {
        findings.push(
          makeFinding('DOC-007', {
            message: `章节字数 ${words} 偏离目标 ${explicitChapterWords} 超过容差 ${tolerance}`,
            file,
            line: parsed.bodyLine,
            locator,
          })
        )
      }
    }

    // PRD §5.3 v1.6（修 B2-F2）：voice 阶段 fail-closed —— 异常时 score=0 + VOICE-011 MAJOR（不抛异常）。
    const characters = Array.isArray(opts.config && opts.config.characters) ? opts.config.characters : []
    const voice = runVoiceStage(body, parsed.bodyLine, file, locator, { ...cfg, lang: voiceCfg.lang, characters })
    const aiVoice = voice.aiVoice
    findings.push(...voice.findings)

    return {
      frontmatter: fm,
      findings: sortFindings(findings),
      aiVoice,
      stats: {
        words,
        unit: aiVoice.unit,
        lines: src.split('\n').length,
        chapter: chapterNumber,
        title: fm && typeof fm.title === 'string' ? fm.title : '',
        bodyLine: parsed.bodyLine,
      },
    }
  } catch (err) {
    return {
      frontmatter: null,
      findings: [
        makeFinding('DOC-005', {
          message: `文本解析异常：${(err && err.message) || err}`,
          file: typeof opts.file === 'string' ? opts.file : 'prose',
          line: 1,
          locator: '',
        }),
      ],
      aiVoice: emptyVoice(),
      stats: { words: 0, unit: 0, lines: 0, chapter: null, title: '', bodyLine: 1 },
    }
  }
}

// ---------------------------------------------------------------------------
// 7. scaffoldProject（PRD §3 / §5.1）
// ---------------------------------------------------------------------------

function kebabSlug(raw) {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function projectTemplate({ title, slug, lang, genre }) {
  return {
    schema: SCHEMA_VERSION,
    title,
    slug,
    lang,
    genre,
    audience: '网文读者',
    viewpoint: { character: '', mode: 'third-limited', tense: 'past' },
    chapterWords: 3000,
    chapterWordsTolerance: 0.2,
    staleHookChapters: 5,
    storyYear: 2026,
    daylight: { sunrise: '06:30', sunset: '18:00' },
    hardRules: [],
    envRules: [],
    style: {
      forbiddenWords: [],
      thresholds: { ...DEFAULT_THRESHOLDS },
    },
  }
}

function scaffoldFiles({ title, slug, lang, genre }) {
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  return [
    { path: 'project.json', content: json(projectTemplate({ title, slug, lang, genre })) },
    {
      path: 'bible/world.md',
      content: [
        `# 世界观 — ${title}`,
        '',
        '> 本文件是给人读的世界观散文；机器可判的硬规则登记在 `project.json.hardRules`。',
        '',
        '## 世界概览',
        '',
        '（一句话说清时代、地点、基本规则。）',
        '',
        '## 常识与禁忌',
        '',
        '- （世界的常识：技术、社会、语言、货币……）',
        '- （世界的禁忌与代价：什么不能做，做了会怎样……）',
        '',
      ].join('\n'),
    },
    { path: 'bible/characters.jsonl', content: '' },
    { path: 'bible/space.json', content: json({ places: [], edges: [] }) },
    { path: 'bible/facts.jsonl', content: '' },
    { path: 'bible/hooks.jsonl', content: '' },
    { path: 'outline/outline.json', content: json({ chapters: [] }) },
    {
      path: 'summaries.md',
      content: ['# 章节摘要', '', '（每章一节：`## ch-001 标题` + 1-3 句摘要，供上下文打包。）', ''].join('\n'),
    },
    {
      path: 'style/style.md',
      content: [
        `# 文风指南 — ${title}`,
        '',
        '> 阈值在 `project.json.style.thresholds`；本文件是给人读的文风约定。',
        '',
        '## 叙述声音',
        '',
        '- 视点：（第三人称限知 / 第一人称……）',
        '- 句长：（长短句比例、节奏偏好……）',
        '- 对话标签：（允许的标签、禁止的标签……）',
        '',
        '## 禁忌',
        '',
        '- （禁用的套话、情绪直给、段末升华……）',
        '',
      ].join('\n'),
    },
  ]
}

/**
 * 生成小说项目脚手架。**只创建缺失文件，绝不覆盖已存在文件**（AC-2b）。
 * @param {string} dir 项目目录（相对 cwd 或绝对路径）
 * @param {object} [options] `{title?, slug?, lang?, genre?, force?}`
 * @returns `{ok, dir, created[], skipped[], reason}`
 */
export async function scaffoldProject(dir, options = {}) {
  const opts = isObject(options) ? options : {}
  const targetDir = path.resolve(String(dir == null ? '.' : dir))
  const result = { ok: false, dir: targetDir, created: [], skipped: [], reason: '' }
  try {
    const exists = await isDirectoryPath(targetDir)
    const existingFromDisk = new Set()
    if (exists) {
      let entries = []
      try {
        entries = await readdir(targetDir)
      } catch (err) {
        result.reason = `无法读取项目目录：${(err && err.message) || err}`
        return result
      }
      if (entries.length > 0 && opts.force !== true) {
        result.reason = '目录非空且未指定 --force，拒绝写入（避免覆盖已有稿件）'
        return result
      }
      // --force = 只补缺失文件、绝不覆盖：先把已存在文件全部登记为 skipped（AC-2b）。
      for (const rel of await listRelativeFiles(targetDir)) existingFromDisk.add(rel)
    } else {
      await mkdir(targetDir, { recursive: true })
    }

    const title = typeof opts.title === 'string' && opts.title.trim() ? opts.title.trim() : path.basename(targetDir)
    const slug = kebabSlug(opts.slug) || kebabSlug(path.basename(targetDir)) || 'novel'
    const lang = typeof opts.lang === 'string' && opts.lang.trim() ? opts.lang.trim() : 'zh-CN'
    const genreRaw = opts.genre
    const genre = Array.isArray(genreRaw)
      ? stringArray(genreRaw)
      : typeof genreRaw === 'string' && genreRaw.trim()
        ? genreRaw
            .split(/[,，\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : []

    for (const name of ['chapters', 'reports', 'exports']) {
      try {
        await mkdir(path.join(targetDir, name), { recursive: true })
      } catch {
        /* 目录创建失败在文件写入阶段会暴露 */
      }
    }

    const scaffoldList = scaffoldFiles({ title, slug, lang, genre })
    const scaffoldPaths = new Set(scaffoldList.map((file) => file.path))
    for (const file of scaffoldList) {
      const abs = path.join(targetDir, ...file.path.split('/'))
      if (existingFromDisk.has(file.path) || (await isFilePath(abs))) {
        result.skipped.push(file.path)
        continue
      }
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, file.content, 'utf8')
      result.created.push(file.path)
    }
    // skipped[] = 目录内全部已存在项（含章节/报告等非脚手架文件；目录项不列）。
    for (const rel of existingFromDisk) {
      if (!scaffoldPaths.has(rel)) result.skipped.push(rel)
    }
    result.skipped = unique(result.skipped)
    result.ok = true
    return result
  } catch (err) {
    result.ok = false
    result.reason = `脚手架创建失败：${(err && err.message) || err}`
    return result
  }
}

// ---------------------------------------------------------------------------
// 8. 项目加载 / schema 归一化
// ---------------------------------------------------------------------------

function normalizeCharacterEntry(raw, line) {
  const src = isObject(raw) ? raw : {}
  const id = typeof src.id === 'string' ? src.id.trim() : ''
  const voice = isObject(src.voice) ? src.voice : null
  const resources = isObject(src.resources) ? { ...src.resources } : {}
  return {
    id,
    name: typeof src.name === 'string' ? src.name.trim() : '',
    aliases: stringArray(src.aliases),
    status: src.status === undefined ? 'alive' : String(src.status),
    role: typeof src.role === 'string' ? src.role : '',
    age: coerceNumber(src.age),
    birthYear: coerceNumber(src.birthYear),
    goal: typeof src.goal === 'string' ? src.goal.trim() : '',
    fear: typeof src.fear === 'string' ? src.fear : '',
    voice: voice && Object.keys(voice).length ? voice : null,
    appellations: isObject(src.appellations) ? src.appellations : {},
    abilities: stringArray(src.abilities),
    limits: stringArray(src.limits),
    resources,
    knowledgeDefault: stringArray(src.knowledgeDefault),
    diedAt: coerceNumber(src.diedAt),
    notes: typeof src.notes === 'string' ? src.notes : '',
    line: Number.isInteger(line) ? line : 1,
  }
}

function normalizeFactEntry(raw, line) {
  const src = isObject(raw) ? raw : {}
  return {
    id: typeof src.id === 'string' ? src.id.trim() : '',
    statement: typeof src.statement === 'string' ? src.statement.trim() : '',
    public: src.public === true,
    truth: src.truth !== false,
    revealAt: coerceInt(src.revealAt),
    line: Number.isInteger(line) ? line : 1,
  }
}

function normalizeHookEntry(raw, line) {
  const src = isObject(raw) ? raw : {}
  return {
    id: typeof src.id === 'string' ? src.id.trim() : '',
    question: typeof src.question === 'string' ? src.question.trim() : '',
    plant: coerceInt(src.plant),
    pay: coerceInt(src.pay),
    status: src.status === undefined ? 'OPEN' : String(src.status),
    staleAfter: coerceInt(src.staleAfter),
    notes: typeof src.notes === 'string' ? src.notes : '',
    line: Number.isInteger(line) ? line : 1,
  }
}

function normalizePlaceEntry(raw) {
  const src = isObject(raw) ? raw : {}
  return {
    id: typeof src.id === 'string' ? src.id.trim() : '',
    name: typeof src.name === 'string' ? src.name.trim() : '',
    region: typeof src.region === 'string' ? src.region : '',
    aliases: stringArray(src.aliases),
    light: typeof src.light === 'string' ? src.light : '',
  }
}

function normalizeEdgeEntry(raw) {
  const src = isObject(raw) ? raw : {}
  return {
    from: typeof src.from === 'string' ? src.from.trim() : '',
    to: typeof src.to === 'string' ? src.to.trim() : '',
    mode: typeof src.mode === 'string' ? src.mode : '',
    minutes: coerceNumber(src.minutes) != null ? Math.max(0, coerceNumber(src.minutes)) : 0,
    bidirectional: src.bidirectional === true,
  }
}

function normalizeOutlineCard(raw) {
  const src = isObject(raw) ? raw : {}
  const scenes = toArray(src.scenes).map((sceneRaw, index) => {
    const scene = isObject(sceneRaw) ? sceneRaw : {}
    return {
      id: typeof scene.id === 'string' && scene.id.trim() ? scene.id.trim() : `s${index + 1}`,
      place: typeof scene.place === 'string' ? scene.place.trim() : '',
      cast: stringArray(scene.cast),
      goal: typeof scene.goal === 'string' ? scene.goal.trim() : '',
      conflict: typeof scene.conflict === 'string' ? scene.conflict.trim() : '',
      outcome: typeof scene.outcome === 'string' ? scene.outcome.trim() : '',
      hooks_plant: stringArray(scene.hooks_plant),
      hooks_pay: stringArray(scene.hooks_pay),
    }
  })
  return {
    chapter: coerceInt(src.chapter),
    title: typeof src.title === 'string' ? src.title.trim() : '',
    scenes,
  }
}

function normalizeScene(raw, chapterNumber, fallbackId) {
  const src = isObject(raw) ? raw : {}
  const id = typeof src.id === 'string' && src.id.trim() ? src.id.trim() : fallbackId
  const dayExplicit = coerceInt(src.day)
  const day = dayExplicit
  const clockRaw = typeof src.clock === 'string' ? src.clock.trim() : src.clock != null ? String(src.clock) : null
  const clockMinutes = parseClock(clockRaw)
  const minutes = Math.max(0, Math.round(coerceNumber(src.minutes) || 0))
  const lightRaw = typeof src.light === 'string' ? src.light.trim() : ''
  const actions = toArray(src.actions).map((a) => {
    const item = isObject(a) ? a : {}
    return {
      who: typeof item.who === 'string' ? item.who.trim() : '',
      kind: typeof item.kind === 'string' ? item.kind.trim() : 'other',
      intensity: clamp(Math.round(coerceNumber(item.intensity) != null ? coerceNumber(item.intensity) : 1), 0, 3),
      ability: typeof item.ability === 'string' ? item.ability.trim() : '',
    }
  })
  const uses = toArray(src.uses).map((u) => {
    const item = isObject(u) ? u : {}
    return {
      who: typeof item.who === 'string' ? item.who.trim() : '',
      fact: typeof item.fact === 'string' ? item.fact.trim() : '',
    }
  })
  const knowledge = toArray(src.knowledge).map((k) => {
    const item = isObject(k) ? k : {}
    return {
      who: typeof item.who === 'string' ? item.who.trim() : '',
      fact: typeof item.fact === 'string' ? item.fact.trim() : '',
      source: typeof item.source === 'string' ? item.source : '',
    }
  })
  const appellations = toArray(src.appellations).map((a) => {
    const item = isObject(a) ? a : {}
    return {
      from: typeof item.from === 'string' ? item.from.trim() : '',
      to: typeof item.to === 'string' ? item.to.trim() : '',
      as: typeof item.as === 'string' ? item.as.trim() : '',
    }
  })
  const injuries = toArray(src.injuries).map((i) => {
    const item = isObject(i) ? i : {}
    return {
      who: typeof item.who === 'string' ? item.who.trim() : '',
      part: typeof item.part === 'string' ? item.part.trim() : '',
      delta: coerceNumber(item.delta) != null ? coerceNumber(item.delta) : 0,
    }
  })
  const items = toArray(src.items).map((i) => {
    const item = isObject(i) ? i : {}
    return {
      id: typeof item.id === 'string' ? item.id.trim() : '',
      op: typeof item.op === 'string' ? item.op.trim() : '',
      from: typeof item.from === 'string' ? item.from.trim() : '',
      to: typeof item.to === 'string' ? item.to.trim() : '',
      name: typeof item.name === 'string' ? item.name.trim() : '',
      place: typeof item.place === 'string' ? item.place.trim() : '',
    }
  })
  const resources = toArray(src.resources).map((r) => {
    const item = isObject(r) ? r : {}
    return {
      who: typeof item.who === 'string' ? item.who.trim() : '',
      kind: typeof item.kind === 'string' ? item.kind.trim() : '',
      delta: coerceNumber(item.delta) != null ? coerceNumber(item.delta) : 0,
    }
  })
  return {
    id,
    place: typeof src.place === 'string' ? src.place.trim() : '',
    day,
    dayExplicit,
    clock: clockRaw,
    clockMinutes,
    minutes,
    cast: stringArray(src.cast),
    light: LIGHT_VALUES.has(lightRaw) ? lightRaw : lightRaw ? lightRaw : null,
    flashback: src.flashback === true,
    env: typeof src.env === 'string' ? src.env.trim() : '',
    actions,
    uses,
    knowledge,
    appellations,
    injuries,
    items,
    resources,
    facts: stringArray(src.facts),
    hooks_plant: stringArray(src.hooks_plant),
    hooks_pay: stringArray(src.hooks_pay),
    violates: stringArray(src.violates),
    justification: typeof src.justification === 'string' ? src.justification.trim() : '',
    line: 1,
    file: '',
    chapter: chapterNumber,
  }
}

async function loadProjectContext(projectDir) {
  const dir = path.resolve(String(projectDir == null ? '.' : projectDir))
  const ctx = {
    dir,
    baseFindings: [],
    project: normalizeConfig({}),
    projectRaw: null,
    projectMissing: false,
    characters: [],
    facts: [],
    factEntries: [],
    hooks: [],
    hookEntries: [],
    space: { places: [], edges: [] },
    outline: { chapters: [] },
    chapters: [],
    chapterFiles: [],
    summaries: '',
    styleGuide: '',
    exemptions: [],
  }
  const addBase = (ruleId, detail) => ctx.baseFindings.push(makeFinding(ruleId, detail))

  // ---- project.json ----
  const projectRead = await readOptional(path.join(dir, 'project.json'))
  if (projectRead.text === null) {
    if (projectRead.error) {
      addBase('DOC-002', { message: `读取 project.json 失败：${(projectRead.error && projectRead.error.message) || projectRead.error}`, file: 'project.json', line: 1 })
    } else {
      ctx.projectMissing = true
      addBase('DOC-001', { message: 'project.json 缺失', file: 'project.json', line: 1 })
    }
  } else {
    const parsed = parseJsonMeta(projectRead.text)
    if (parsed.error) {
      addBase('DOC-002', { message: `project.json 解析失败：${parsed.error.message}`, file: 'project.json', line: parsed.line })
    } else if (!isObject(parsed.value)) {
      addBase('DOC-001', { message: 'project.json 顶层必须是对象且 schema 为 novel-forge/v1', file: 'project.json', line: 1 })
    } else {
      ctx.projectRaw = parsed.value
      ctx.project = normalizeConfig(parsed.value)
      if (parsed.value.schema !== SCHEMA_VERSION) {
        addBase('DOC-001', { message: `project.json.schema=${JSON.stringify(parsed.value.schema)}，应为 ${SCHEMA_VERSION}`, file: 'project.json', line: 1 })
      }
    }
  }

  // ---- bible/characters.jsonl ----
  {
    const file = 'bible/characters.jsonl'
    const read = await readOptional(path.join(dir, 'bible', 'characters.jsonl'))
    if (read.error) addBase('DOC-002', { message: `读取 ${file} 失败：${(read.error && read.error.message) || read.error}`, file, line: 1 })
    if (read.text != null) {
      const parsed = parseJsonlMeta(read.text)
      for (const err of parsed.errors) addBase('DOC-002', { message: err.message, file, line: err.line })
      const seen = new Set()
      for (const entry of parsed.entries) {
        if (!isObject(entry.value)) {
          addBase('DOC-002', { message: `第 ${entry.line} 行不是 JSON 对象`, file, line: entry.line })
          continue
        }
        const character = normalizeCharacterEntry(entry.value, entry.line)
        if (!character.id) {
          addBase('CHAR-005', { message: '角色缺少 id', file, line: entry.line, locator: '' })
          continue
        }
        if (!KEBAB_RE.test(character.id)) {
          addBase('CHAR-005', { message: `角色 id「${character.id}」不是 kebab-case`, file, line: entry.line, locator: character.id })
        }
        if (!STATUS_VALUES.has(String(character.status))) {
          addBase('CHAR-005', { message: `角色「${character.id}」status=${character.status} 非法`, file, line: entry.line, locator: character.id })
        }
        if (seen.has(character.id)) {
          addBase('CHAR-005', { message: `角色 id「${character.id}」重复`, file, line: entry.line, locator: character.id })
          continue
        }
        seen.add(character.id)
        ctx.characters.push(character)
      }
    }
  }

  // ---- bible/facts.jsonl ----
  {
    const file = 'bible/facts.jsonl'
    const read = await readOptional(path.join(dir, 'bible', 'facts.jsonl'))
    if (read.error) addBase('DOC-002', { message: `读取 ${file} 失败：${(read.error && read.error.message) || read.error}`, file, line: 1 })
    if (read.text != null) {
      const parsed = parseJsonlMeta(read.text)
      for (const err of parsed.errors) addBase('DOC-002', { message: err.message, file, line: err.line })
      for (const entry of parsed.entries) {
        if (!isObject(entry.value)) {
          addBase('DOC-002', { message: `第 ${entry.line} 行不是 JSON 对象`, file, line: entry.line })
          continue
        }
        const fact = normalizeFactEntry(entry.value, entry.line)
        if (!fact.id) continue
        ctx.factEntries.push(fact)
        if (!ctx.facts.some((f) => f.id === fact.id)) ctx.facts.push(fact)
      }
    }
  }

  // ---- bible/hooks.jsonl ----
  {
    const file = 'bible/hooks.jsonl'
    const read = await readOptional(path.join(dir, 'bible', 'hooks.jsonl'))
    if (read.error) addBase('DOC-002', { message: `读取 ${file} 失败：${(read.error && read.error.message) || read.error}`, file, line: 1 })
    if (read.text != null) {
      const parsed = parseJsonlMeta(read.text)
      for (const err of parsed.errors) addBase('DOC-002', { message: err.message, file, line: err.line })
      for (const entry of parsed.entries) {
        if (!isObject(entry.value)) {
          addBase('DOC-002', { message: `第 ${entry.line} 行不是 JSON 对象`, file, line: entry.line })
          continue
        }
        const hook = normalizeHookEntry(entry.value, entry.line)
        if (!hook.id) continue
        ctx.hookEntries.push(hook)
        if (!ctx.hooks.some((h) => h.id === hook.id)) ctx.hooks.push(hook)
      }
    }
  }

  // ---- bible/space.json ----
  {
    const file = 'bible/space.json'
    const read = await readOptional(path.join(dir, 'bible', 'space.json'))
    if (read.error) addBase('DOC-002', { message: `读取 ${file} 失败：${(read.error && read.error.message) || read.error}`, file, line: 1 })
    if (read.text != null) {
      const parsed = parseJsonMeta(read.text)
      if (parsed.error) addBase('DOC-002', { message: `${file} 解析失败：${parsed.error.message}`, file, line: parsed.line })
      else if (isObject(parsed.value)) {
        ctx.space = {
          places: toArray(parsed.value.places).map(normalizePlaceEntry).filter((p) => p.id),
          edges: toArray(parsed.value.edges).map(normalizeEdgeEntry).filter((e) => e.from && e.to),
        }
      }
    }
  }

  // ---- outline/outline.json ----
  {
    const file = 'outline/outline.json'
    const read = await readOptional(path.join(dir, 'outline', 'outline.json'))
    if (read.error) addBase('DOC-002', { message: `读取 ${file} 失败：${(read.error && read.error.message) || read.error}`, file, line: 1 })
    if (read.text != null) {
      const parsed = parseJsonMeta(read.text)
      if (parsed.error) addBase('DOC-002', { message: `${file} 解析失败：${parsed.error.message}`, file, line: parsed.line })
      else if (isObject(parsed.value)) {
        ctx.outline = { chapters: toArray(parsed.value.chapters).map(normalizeOutlineCard) }
      }
    }
  }

  // ---- summaries.md / style/style.md ----
  {
    const read = await readOptional(path.join(dir, 'summaries.md'))
    if (read.error) addBase('DOC-002', { message: `读取 summaries.md 失败：${(read.error && read.error.message) || read.error}`, file: 'summaries.md', line: 1 })
    if (read.text != null) ctx.summaries = read.text
    const styleRead = await readOptional(path.join(dir, 'style', 'style.md'))
    if (styleRead.error) addBase('DOC-002', { message: `读取 style/style.md 失败：${(styleRead.error && styleRead.error.message) || styleRead.error}`, file: 'style/style.md', line: 1 })
    if (styleRead.text != null) ctx.styleGuide = styleRead.text
  }

  // ---- reports/exemptions.json ----
  {
    const file = 'reports/exemptions.json'
    const read = await readOptional(path.join(dir, 'reports', 'exemptions.json'))
    if (read.error) addBase('DOC-002', { message: `读取 ${file} 失败：${(read.error && read.error.message) || read.error}`, file, line: 1 })
    if (read.text != null) {
      const parsed = parseJsonMeta(read.text)
      if (parsed.error) addBase('DOC-002', { message: `${file} 解析失败：${parsed.error.message}`, file, line: parsed.line })
      else if (Array.isArray(parsed.value)) ctx.exemptions = parsed.value
      else if (isObject(parsed.value) && Array.isArray(parsed.value.exemptions)) ctx.exemptions = parsed.value.exemptions
    }
  }

  // ---- chapters/*.md ----
  const chaptersDir = path.join(dir, 'chapters')
  let entries = []
  try {
    entries = await readdir(chaptersDir, { withFileTypes: true })
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      addBase('DOC-002', { message: `读取 chapters/ 失败：${(err && err.message) || err}`, file: 'chapters/', line: 1 })
    }
  }
  const chapterFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const validChapterFiles = []
  for (const name of chapterFiles.sort()) {
    const m = CHAPTER_FILE_RE.exec(name)
    if (!m) {
      addBase('DOC-003', { message: `章节文件名「${name}」不符合 ch-NNN.md`, file: `chapters/${name}`, line: 1, locator: name })
      continue
    }
    validChapterFiles.push({ name, fileNumber: Number(m[1]) })
  }
  validChapterFiles.sort((a, b) => a.fileNumber - b.fileNumber || a.name.localeCompare(b.name))

  // DOC-004 章节序号不连续（v1.5 M5：连续缺口合并为 1 条，千章级项目 findings 不爆炸）
  if (validChapterFiles.length) {
    const numbers = unique(validChapterFiles.map((f) => f.fileNumber)).sort((a, b) => a - b)
    const maxNumber = Math.max(...numbers)
    const numberSet = new Set(numbers)
    const gaps = []
    let gapStart = null
    let gapEnd = null
    for (let n = 1; n <= maxNumber; n++) {
      if (numberSet.has(n)) {
        if (gapStart != null) {
          gaps.push({ start: gapStart, end: gapEnd })
          gapStart = null
          gapEnd = null
        }
      } else {
        if (gapStart == null) gapStart = n
        gapEnd = n
      }
    }
    if (gapStart != null) gaps.push({ start: gapStart, end: gapEnd })
    for (const gap of gaps) {
      const count = gap.end - gap.start + 1
      const range = count === 1 ? `ch-${pad3(gap.start)}` : `ch-${pad3(gap.start)}…ch-${pad3(gap.end)}`
      addBase('DOC-004', { message: `章节序号缺口：${range}（共 ${count} 章）`, file: 'chapters/', line: 1, locator: range })
    }
    const invalidNumbers = numbers.filter((n) => n < 1)
    if (invalidNumbers.length) {
      addBase('DOC-004', {
        message: `章节序号非法：${invalidNumbers.map((n) => `ch-${pad3(n)}.md`).join('、')}`,
        file: 'chapters/',
        line: 1,
        locator: `ch-${pad3(invalidNumbers[0])}`,
      })
    }
  }

  for (const info of validChapterFiles) {
    const relFile = `chapters/${info.name}`
    const read = await readOptional(path.join(chaptersDir, info.name))
    if (read.error) {
      addBase('DOC-002', { message: `读取 ${relFile} 失败：${(read.error && read.error.message) || read.error}`, file: relFile, line: 1 })
      continue
    }
    const text = read.text == null ? '' : read.text
    const parsed = parseChapterText(text)
    const sceneLineList = frontmatterSceneLines(text)
    const fm = isObject(parsed.frontmatter) ? parsed.frontmatter : null
    const chapterNumberRaw = fm ? coerceInt(fm.chapter) : null
    const chapterNumber = chapterNumberRaw != null ? chapterNumberRaw : info.fileNumber
    if (!parsed.ok) {
      for (const err of parsed.errors) addBase('DOC-005', { message: `frontmatter 解析失败：${err.message}`, file: relFile, line: err.line, locator: `ch-${pad3(info.fileNumber)}` })
    } else if (chapterNumberRaw == null) {
      addBase('DOC-005', { message: 'frontmatter 缺少整数 chapter 字段', file: relFile, line: 1, locator: `ch-${pad3(info.fileNumber)}` })
    } else if (fm && fm.scenes !== undefined && fm.scenes !== null && !Array.isArray(fm.scenes)) {
      addBase('DOC-005', { message: 'frontmatter.scenes 必须是列表', file: relFile, line: 1, locator: `ch-${pad3(chapterNumber)}` })
    }
    if (String(parsed.body).replace(/\s+/g, '') === '') {
      addBase('DOC-006', { message: '章节正文（去 frontmatter）去空白后为空', file: relFile, line: parsed.bodyLine, locator: `ch-${pad3(chapterNumber)}` })
    }
    const scenes = toArray(fm ? fm.scenes : []).map((raw, index) =>
      normalizeScene(raw, chapterNumber, `ch${chapterNumber}-s${index + 1}`)
    )
    scenes.forEach((scene, index) => {
      scene.line = sceneLineList[index] != null ? sceneLineList[index] : parsed.bodyLine > 1 ? 2 : 1
      scene.file = relFile
      scene.chapter = chapterNumber
      scene.day = scene.dayExplicit != null ? scene.dayExplicit : coerceInt(fm ? fm.day : null)
      scene.absStart = absMinutes(scene.day, scene.clockMinutes)
      scene.absEnd = scene.absStart != null ? scene.absStart + scene.minutes : null
    })
    ctx.chapters.push({
      fileNumber: info.fileNumber,
      file: relFile,
      chapter: chapterNumber,
      title: fm && typeof fm.title === 'string' ? fm.title.trim() : '',
      pov: fm && typeof fm.pov === 'string' ? fm.pov.trim() : '',
      day: fm ? coerceInt(fm.day) : null,
      mentions: fm ? stringArray(fm.mentions) : [],
      scenes,
      body: parsed.body,
      bodyLine: parsed.bodyLine,
      text,
      parseOk: parsed.ok,
      words: countWords(parsed.body),
      line: 1,
    })
  }
  ctx.chapters.sort((a, b) => a.chapter - b.chapter || a.fileNumber - b.fileNumber)
  ctx.chapterFiles = ctx.chapters.map((c) => c.chapter)
  return ctx
}

// ---------------------------------------------------------------------------
// 9. 规则判定（派生 + 62 条规则）
// ---------------------------------------------------------------------------

function buildTravelGraph(space) {
  const adj = new Map()
  const addEdge = (from, to, minutes) => {
    if (!from || !to) return
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from).push({ to, minutes: Number.isFinite(minutes) ? Math.max(0, minutes) : 0 })
  }
  for (const edge of toArray(space && space.edges)) {
    addEdge(edge.from, edge.to, edge.minutes)
    if (edge.bidirectional) addEdge(edge.to, edge.from, edge.minutes)
  }
  return adj
}

function shortestTravel(adj, from, to) {
  if (!from || !to) return null
  if (from === to) return 0
  if (!adj.has(from)) return Infinity
  const dist = new Map([[from, 0]])
  const visited = new Set()
  while (true) {
    let best = null
    let bestDist = Infinity
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < bestDist) {
        best = node
        bestDist = d
      }
    }
    if (best === null) break
    visited.add(best)
    if (best === to) return bestDist
    for (const edge of adj.get(best) || []) {
      const next = bestDist + edge.minutes
      if (!dist.has(edge.to) || next < dist.get(edge.to)) dist.set(edge.to, next)
    }
  }
  return dist.has(to) ? dist.get(to) : Infinity
}

function expectedLight(clockMinutes, daylight) {
  if (!Number.isFinite(clockMinutes)) return null
  const rise = parseClock(daylight.sunrise)
  const set = parseClock(daylight.sunset)
  if (rise == null || set == null) return null
  if (clockMinutes < rise - 60 || clockMinutes >= set + 60) return 'night'
  if (clockMinutes < rise + 60) return 'dawn'
  if (clockMinutes < set - 60) return 'day'
  return 'dusk'
}

function hookChaptersDerivation(chapters) {
  const plants = new Map()
  const pays = new Map()
  const push = (map, id, chapter) => {
    if (!map.has(id)) map.set(id, [])
    map.get(id).push(chapter)
  }
  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      for (const plant of scene.hooks_plant) push(plants, plant, chapter.chapter)
      for (const pay of scene.hooks_pay) push(pays, pay, chapter.chapter)
    }
  }
  return { plants, pays }
}

function minChapterOf(map, id) {
  const list = map.get(id)
  if (!list || !list.length) return null
  return Math.min(...list)
}

/**
 * 项目级分析：派生状态 + 全部规则判定。
 * @returns `{findings, derived}`
 */
function analyzeProjectState(ctx, cfg) {
  const findings = []
  const add = (ruleId, detail) => findings.push(makeFinding(ruleId, detail))
  const charById = new Map(ctx.characters.map((c) => [c.id, c]))
  const factById = new Map(ctx.facts.map((f) => [f.id, f]))
  const hookById = new Map(ctx.hooks.map((h) => [h.id, h]))
  const placeById = new Map(ctx.space.places.map((p) => [p.id, p]))
  const hardRuleIds = new Set(cfg.hardRules.map((r) => String(r.id).trim()).filter(Boolean))
  const chapterNumbers = new Set(ctx.chapters.map((c) => c.chapter))
  const maxChapter = ctx.chapters.length ? Math.max(...ctx.chapters.map((c) => c.chapter)) : 0
  const travelAdj = buildTravelGraph(ctx.space)
  const travelCache = new Map()
  const travel = (from, to) => {
    const key = `${from}\u0000${to}`
    if (!travelCache.has(key)) travelCache.set(key, shortestTravel(travelAdj, from, to))
    return travelCache.get(key)
  }

  // ---- 角色卡（CHAR-004） ----
  for (const character of ctx.characters) {
    if (!character.goal || !character.voice) {
      add('CHAR-004', {
        message: `角色「${character.id}」缺 ${!character.goal ? 'goal' : ''}${!character.goal && !character.voice ? ' 与 ' : ''}${!character.voice ? 'voice' : ''}`,
        file: 'bible/characters.jsonl',
        line: character.line,
        locator: character.id,
      })
    }
  }

  // ---- TIME-005 ----
  if (Number.isFinite(cfg.storyYear)) {
    for (const character of ctx.characters) {
      if (character.age == null || character.birthYear == null) continue
      const expected = cfg.storyYear - character.birthYear
      if (Math.abs(character.age - expected) > 1) {
        add('TIME-005', {
          message: `角色「${character.id}」age=${character.age} 与 storyYear(${cfg.storyYear}) - birthYear(${character.birthYear}) = ${expected} 相差超过 1`,
          file: 'bible/characters.jsonl',
          line: character.line,
          locator: character.id,
        })
      }
    }
  }

  // ---- hook 派生（前置扫描） ----
  const { plants: hookPlantDerived, pays: hookPayDerived } = hookChaptersDerivation(ctx.chapters)

  // ---- 初始状态 ----
  const publicFacts = ctx.facts.filter((f) => f.public).map((f) => f.id)
  const knowledge = new Map()
  for (const character of ctx.characters) {
    knowledge.set(character.id, new Set([...character.knowledgeDefault, ...publicFacts]))
  }
  const injuries = new Map()
  const resources = new Map()
  for (const character of ctx.characters) {
    for (const [kind, value] of Object.entries(character.resources || {})) {
      const numeric = coerceNumber(value)
      if (numeric != null) resources.set(`${character.id}\u0000${kind}`, numeric)
    }
  }
  const items = new Map()
  const sceneAppearances = []
  let prevScene = null
  let timelineDay = null

  const registered = (id) => charById.has(id)
  const inCast = (scene, id) => scene.cast.includes(id)
  const addSpace005 = (scene, who, where) => {
    if (!who || !registered(who) || inCast(scene, who)) return
    add('SPACE-005', {
      message: `场景 ${scene.id} 的 ${where} 角色「${who}」不在 cast [${scene.cast.join(', ')}] 中`,
      file: scene.file,
      line: scene.line,
      locator: scene.id,
    })
  }

  for (const chapter of ctx.chapters) {
    if (timelineDay == null && chapter.day != null) timelineDay = chapter.day

    // TIME-006（章节级 day 与首个场景 day）
    const firstScene = chapter.scenes[0]
    if (chapter.day != null && firstScene && firstScene.dayExplicit != null && firstScene.dayExplicit !== chapter.day) {
      add('TIME-006', {
        message: `章节 day=${chapter.day} 与首个场景 day=${firstScene.dayExplicit} 不一致`,
        file: chapter.file,
        line: firstScene.line,
        locator: firstScene.id,
      })
    }

    for (const scene of chapter.scenes) {
      if (scene.day != null && timelineDay == null) timelineDay = scene.day
      if (!scene.flashback && scene.day != null) timelineDay = timelineDay == null ? scene.day : Math.max(timelineDay, scene.day)

      // SPACE-001 地点注册
      if (scene.place && !placeById.has(scene.place)) {
        add('SPACE-001', {
          message: `场景 ${scene.id} 的地点「${scene.place}」未在 bible/space.json.places 注册`,
          file: scene.file,
          line: scene.line,
          locator: scene.id,
        })
      }

      // SPACE-002 / SPACE-003（相邻场景）
      if (prevScene && scene.place && prevScene.place && scene.place !== prevScene.place && !scene.flashback && !prevScene.flashback) {
        const registeredPlaces = placeById.has(scene.place) && placeById.has(prevScene.place)
        if (registeredPlaces) {
          const cost = travel(prevScene.place, scene.place)
          if (cost === Infinity) {
            add('SPACE-002', {
              message: `场景 ${scene.id}（${scene.place}）与上一场景 ${prevScene.id}（${prevScene.place}）异地，但地点图无连通路径`,
              file: scene.file,
              line: scene.line,
              locator: scene.id,
            })
          } else if (Number.isFinite(cost) && scene.absStart != null && prevScene.absEnd != null) {
            const gap = scene.absStart - prevScene.absEnd
            if (gap < cost) {
              add('SPACE-003', {
                message: `场景 ${scene.id} 与上一场景 ${prevScene.id} 异地，但间隔 ${gap} 分钟 < 最短通行 ${cost} 分钟`,
                file: scene.file,
                line: scene.line,
                locator: scene.id,
              })
            }
          }
        }
      }

      // TIME-001 / TIME-007
      if (prevScene && scene.absStart != null && prevScene.absStart != null && !scene.flashback) {
        if (prevScene.chapter === chapter.chapter && prevScene.file === scene.file && scene.absStart < prevScene.absStart) {
          add('TIME-001', {
            message: `场景 ${scene.id} 起始时间 ${scene.clock} 早于同章上一场景 ${prevScene.id}（${prevScene.clock}）且未标 flashback`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
        if (scene.absStart < prevScene.absStart) {
          add('TIME-007', {
            message: `场景 ${scene.id} 时间早于上一场景 ${prevScene.id} 且未标 flashback: true`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }

      // TIME-002 跨章时间倒退
      if (prevScene && prevScene.file !== scene.file && prevScene.absEnd != null && scene.absStart != null && !scene.flashback && !prevScene.flashback) {
        if (scene.absStart < prevScene.absEnd) {
          add('TIME-002', {
            message: `本章首场景 ${scene.id} 起始 ${scene.absStart} 早于上一章末场景 ${prevScene.id} 结束 ${prevScene.absEnd}（跨章时间倒退）`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }

      // TIME-003 时间窗重叠且地点不同
      if (prevScene && scene.absStart != null && prevScene.absEnd != null && !scene.flashback && !prevScene.flashback) {
        if (scene.absStart < prevScene.absEnd && scene.place && prevScene.place && scene.place !== prevScene.place) {
          add('TIME-003', {
            message: `场景 ${scene.id} 时间窗与上一场景 ${prevScene.id} 重叠且地点不同（${prevScene.place} → ${scene.place}）`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }

      // TIME-004 light 与 clock/daylight
      if (scene.light && LIGHT_VALUES.has(scene.light) && scene.light !== 'dim' && scene.clockMinutes != null) {
        const expected = expectedLight(scene.clockMinutes, cfg.daylight)
        if (expected && expected !== scene.light) {
          add('TIME-004', {
            message: `场景 ${scene.id} light=${scene.light} 与 clock=${scene.clock}（应属 ${expected}）矛盾`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }

      // SPACE-004 收集
      if (scene.place && scene.absStart != null) {
        for (const who of scene.cast) {
          sceneAppearances.push({
            who,
            place: scene.place,
            start: scene.absStart,
            end: scene.absEnd != null ? scene.absEnd : scene.absStart,
            locator: scene.id,
            file: scene.file,
            line: scene.line,
          })
        }
      }

      // SPACE-005（注册但不在 cast）
      const sceneCtx = scene
      for (const action of scene.actions) addSpace005(sceneCtx, action.who, 'actions.who')
      for (const use of scene.uses) addSpace005(sceneCtx, use.who, 'uses.who')
      for (const know of scene.knowledge) addSpace005(sceneCtx, know.who, 'knowledge.who')
      for (const app of scene.appellations) {
        addSpace005(sceneCtx, app.from, 'appellations.from')
        addSpace005(sceneCtx, app.to, 'appellations.to')
      }
      for (const item of scene.items) {
        addSpace005(sceneCtx, item.from, 'items.from')
        addSpace005(sceneCtx, item.to, 'items.to')
      }
      for (const resource of scene.resources) addSpace005(sceneCtx, resource.who, 'resources.who')
      for (const injury of scene.injuries) addSpace005(sceneCtx, injury.who, 'injuries.who')

      // CHAR-001 未注册角色
      for (const who of scene.cast) {
        if (!registered(who)) add('CHAR-001', { message: `场景 ${scene.id} cast 引用未注册角色「${who}」`, file: scene.file, line: scene.line, locator: scene.id })
      }
      for (const action of scene.actions) {
        if (action.who && !registered(action.who)) add('CHAR-001', { message: `场景 ${scene.id} actions.who 引用未注册角色「${action.who}」`, file: scene.file, line: scene.line, locator: scene.id })
      }
      for (const know of scene.knowledge) {
        if (know.who && !registered(know.who)) add('CHAR-001', { message: `场景 ${scene.id} knowledge.who 引用未注册角色「${know.who}」`, file: scene.file, line: scene.line, locator: scene.id })
      }
      for (const injury of scene.injuries) {
        if (injury.who && !registered(injury.who)) add('CHAR-001', { message: `场景 ${scene.id} injuries.who 引用未注册角色「${injury.who}」`, file: scene.file, line: scene.line, locator: scene.id })
      }

      // CHAR-002 死者/失踪者非回忆出场
      if (!scene.flashback) {
        for (const who of unique([...scene.cast, ...scene.actions.map((a) => a.who).filter(Boolean)])) {
          const character = charById.get(who)
          if (!character) continue
          if (character.status === 'dead' || character.status === 'missing') {
            add('CHAR-002', {
              message: `status=${character.status} 的角色「${who}」在场景 ${scene.id} 出场，且未标 flashback: true`,
              file: scene.file,
              line: scene.line,
              locator: scene.id,
            })
          }
        }
      }

      // CHAR-003 能力越界
      for (const action of scene.actions) {
        if (!action.ability || !action.who) continue
        const character = charById.get(action.who)
        if (!character) continue
        if (!character.abilities.includes(action.ability)) {
          add('CHAR-003', {
            message: `场景 ${scene.id} 动作能力「${action.ability}」不在角色「${action.who}」abilities 中`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }

      // PHYS-001 重伤高强度动作
      for (const action of scene.actions) {
        if (!action.who || action.intensity < 2) continue
        let injured = false
        for (const [key, value] of injuries) {
          if (!key.startsWith(`${action.who}\u0000`)) continue
          if (-value >= 2) {
            injured = true
            break
          }
        }
        if (injured) {
          add('PHYS-001', {
            message: `角色「${action.who}」存在净伤势 ≥ 2 的部位，仍执行 intensity=${action.intensity} 动作`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }

      // DLG-001 / DLG-002
      for (const use of scene.uses) {
        if (use.who && !registered(use.who)) {
          add('DLG-002', { message: `场景 ${scene.id} uses.who「${use.who}」未注册`, file: scene.file, line: scene.line, locator: scene.id })
          continue
        }
        if (!use.fact || !factById.has(use.fact)) continue
        const known = knowledge.get(use.who)
        if (!known || !known.has(use.fact)) {
          add('DLG-001', {
            message: `场景 ${scene.id} 角色「${use.who}」使用了尚未获知的事实「${use.fact}」`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }
      for (const know of scene.knowledge) {
        if (know.who && !registered(know.who)) {
          add('DLG-002', { message: `场景 ${scene.id} knowledge.who「${know.who}」未注册`, file: scene.file, line: scene.line, locator: scene.id })
        }
      }
      for (const app of scene.appellations) {
        if (app.from && !registered(app.from)) add('DLG-002', { message: `场景 ${scene.id} appellations.from「${app.from}」未注册`, file: scene.file, line: scene.line, locator: scene.id })
        if (app.to && !registered(app.to)) add('DLG-002', { message: `场景 ${scene.id} appellations.to「${app.to}」未注册`, file: scene.file, line: scene.line, locator: scene.id })
      }

      // DLG-003 称谓越界
      for (const app of scene.appellations) {
        if (!app.from || !app.to || !app.as) continue
        const target = charById.get(app.to)
        if (!target) continue
        const from = app.from
        const allowed = new Set([target.name, ...target.aliases])
        const registeredAppellations = isObject(target.appellations) ? target.appellations : {}
        const list = stringArray(registeredAppellations[from])
        for (const name of list) allowed.add(name)
        if (!allowed.has(app.as)) {
          add('DLG-003', {
            message: `场景 ${scene.id} 称谓「${app.as}」（${app.from} → ${app.to}）不在允许清单内`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }

      // PHYS-006 envRules
      if (scene.env) {
        for (const rule of cfg.envRules) {
          if (String(rule.env) !== scene.env) continue
          const requiresAny = stringArray(rule.requiresAny)
          if (!requiresAny.length) continue
          const ok = scene.cast.some((who) => {
            const character = charById.get(who)
            if (!character) return false
            return character.abilities.some((ability) => requiresAny.some((req) => ability.includes(req)))
          })
          if (!ok) {
            add('PHYS-006', {
              message: `场景 ${scene.id} env=${scene.env} 命中环境规则，但 cast 无人具备 [${requiresAny.join('/')}]`,
              file: scene.file,
              line: scene.line,
              locator: scene.id,
            })
          }
        }
      }

      // PHYS-007 硬规则
      for (const ruleId of scene.violates) {
        if (!hardRuleIds.has(ruleId)) {
          add('PHYS-007', { message: `场景 ${scene.id} violates 引用未注册硬规则「${ruleId}」`, file: scene.file, line: scene.line, locator: scene.id })
        } else if (!scene.justification) {
          add('PHYS-007', { message: `场景 ${scene.id} 违反硬规则「${ruleId}」但 justification 为空`, file: scene.file, line: scene.line, locator: scene.id })
        }
      }

      // PHYS-002/003/004 道具状态机（按 items 顺序 check-then-apply）
      for (const item of scene.items) {
        if (!item.id) continue
        if (!items.has(item.id)) items.set(item.id, { id: item.id, name: item.name || item.id, holder: null, place: item.place || null, status: 'ok' })
        const state = items.get(item.id)
        if (item.name) state.name = item.name
        if (state.status === 'destroyed' || state.status === 'lost') {
          if (item.op === 'create' || item.op === 'transfer' || item.op === 'find') {
            add('PHYS-002', {
              message: `道具「${item.id}」已 ${state.status}，却又在场景 ${scene.id} 执行 ${item.op}`,
              file: scene.file,
              line: scene.line,
              locator: scene.id,
            })
          }
        }
        if (item.op === 'create') {
          state.status = 'ok'
          if (item.to) {
            state.holder = item.to
            state.place = null
          } else if (item.place) {
            state.place = item.place
            state.holder = null
          }
        } else if (item.op === 'find') {
          state.status = 'ok'
          if (item.to) {
            state.holder = item.to
            state.place = null
          }
        } else if (item.op === 'transfer') {
          if (state.holder == null) {
            add('PHYS-004', { message: `场景 ${scene.id} 道具「${item.id}」transfer 时无人持有`, file: scene.file, line: scene.line, locator: scene.id })
          } else if (item.from !== state.holder) {
            add('PHYS-003', {
              message: `场景 ${scene.id} 道具「${item.id}」transfer.from=${item.from || '(空)'} 与当前持有者「${state.holder}」不符`,
              file: scene.file,
              line: scene.line,
              locator: scene.id,
            })
          }
          if (item.to) {
            state.holder = item.to
            state.place = null
          } else {
            state.holder = null
            if (item.place) state.place = item.place
          }
        } else if (item.op === 'destroy') {
          if (state.holder == null) {
            add('PHYS-004', { message: `场景 ${scene.id} 道具「${item.id}」destroy 时无人持有`, file: scene.file, line: scene.line, locator: scene.id })
          }
          state.status = 'destroyed'
          state.holder = null
        } else if (item.op === 'lose') {
          state.status = 'lost'
          state.holder = null
        } else if (item.op && !ITEM_OPS.has(item.op)) {
          /* 未知 op：无对应规则，忽略 */
        }
      }

      // PHYS-005 资源
      for (const resource of scene.resources) {
        if (!resource.who || !resource.kind) continue
        const character = charById.get(resource.who)
        if (!character) continue
        if (!Object.prototype.hasOwnProperty.call(character.resources || {}, resource.kind)) continue
        const key = `${resource.who}\u0000${resource.kind}`
        const next = (resources.has(key) ? resources.get(key) : 0) + resource.delta
        resources.set(key, next)
        if (next < 0) {
          add('PHYS-005', {
            message: `角色「${resource.who}」资源 ${resource.kind} 累加后为 ${next}`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }

      // ---- 状态更新：knowledge / injuries ----
      for (const know of scene.knowledge) {
        if (!know.who || !know.fact) continue
        if (!registered(know.who)) continue
        if (!knowledge.has(know.who)) knowledge.set(know.who, new Set())
        knowledge.get(know.who).add(know.fact)
        // FACT-003（v1.3 冻结）：knowledge 来源不可追溯 = 该 fact 既未在本场景 facts[] 声明，source 也为空/缺省。
        // 判定只看「证据在不在」，与角色是否首次出场、此前章节无关（v1.2 口径会在任何角色首章获知上误报）。
        const declaredInScene = scene.facts.includes(know.fact)
        const hasSource = typeof know.source === 'string' && know.source.trim() !== ''
        if (!declaredInScene && !hasSource) {
          add('FACT-003', {
            message: `场景 ${scene.id} 角色「${know.who}」获知事实「${know.fact}」但来源不可追溯（既未在本场景 facts 声明，也无 source）`,
            file: scene.file,
            line: scene.line,
            locator: scene.id,
          })
        }
      }
      for (const injury of scene.injuries) {
        if (!injury.who || !injury.part) continue
        const key = `${injury.who}\u0000${injury.part}`
        injuries.set(key, (injuries.has(key) ? injuries.get(key) : 0) + injury.delta)
      }

      prevScene = scene
    }
  }

  // ---- SPACE-004 ----
  {
    const reported = new Set()
    for (let i = 0; i < sceneAppearances.length; i++) {
      for (let j = i + 1; j < sceneAppearances.length; j++) {
        const a = sceneAppearances[i]
        const b = sceneAppearances[j]
        if (a.who !== b.who || a.place === b.place) continue
        if (!(a.start <= b.end && b.start <= a.end)) continue
        const key = `${a.who}|${a.locator}|${b.locator}`
        if (reported.has(key)) continue
        reported.add(key)
        add('SPACE-004', {
          message: `角色「${a.who}」在同一时间窗出现在两个地点：${a.place}（${a.locator}）与 ${b.place}（${b.locator}）`,
          file: b.file,
          line: b.line,
          locator: b.locator,
        })
      }
    }
  }

  // ---- FACT-001 / FACT-002 / FACT-004 ----
  {
    const byId = new Map()
    for (const fact of ctx.factEntries) {
      if (!fact.id) continue
      if (!byId.has(fact.id)) byId.set(fact.id, [])
      byId.get(fact.id).push(fact)
    }
    for (const [id, list] of byId) {
      if (list.length < 2) continue
      const first = list[0].statement
      const inconsistent = list.some((f) => f.statement !== first)
      if (inconsistent) {
        add('FACT-001', { message: `fact id「${id}」重复且 statement 不一致`, file: 'bible/facts.jsonl', line: list[1].line, locator: id })
      }
    }
    for (const chapter of ctx.chapters) {
      for (const scene of chapter.scenes) {
        for (const factId of scene.facts) {
          if (!factById.has(factId)) add('FACT-002', { message: `场景 ${scene.id} facts 引用未注册事实「${factId}」`, file: scene.file, line: scene.line, locator: scene.id })
        }
        for (const use of scene.uses) {
          if (use.fact && !factById.has(use.fact)) add('FACT-002', { message: `场景 ${scene.id} uses 引用未注册事实「${use.fact}」`, file: scene.file, line: scene.line, locator: scene.id })
        }
        for (const know of scene.knowledge) {
          if (know.fact && !factById.has(know.fact)) add('FACT-002', { message: `场景 ${scene.id} knowledge 引用未注册事实「${know.fact}」`, file: scene.file, line: scene.line, locator: scene.id })
        }
      }
    }
    for (const fact of ctx.facts) {
      if (fact.revealAt != null && !chapterNumbers.has(fact.revealAt)) {
        add('FACT-004', { message: `fact「${fact.id}」revealAt=${fact.revealAt} 指向不存在的章节`, file: 'bible/facts.jsonl', line: fact.line, locator: fact.id })
      }
    }
    for (const hook of ctx.hooks) {
      for (const key of ['plant', 'pay']) {
        const value = hook[key]
        if (value != null && !chapterNumbers.has(value)) {
          add('FACT-004', { message: `伏笔「${hook.id}」${key}=${value} 指向不存在的章节`, file: 'bible/hooks.jsonl', line: hook.line, locator: hook.id })
        }
      }
    }
  }

  // ---- HOOK-001/002/003/004/006 ----
  {
    for (const hook of ctx.hooks) {
      const plant = minChapterOf(hookPlantDerived, hook.id)
      const pay = minChapterOf(hookPayDerived, hook.id)
      if (pay != null && (plant == null || pay < plant)) {
        add('HOOK-001', {
          message: `伏笔「${hook.id}」回收章 ${pay} 早于埋设章 ${plant == null ? '(未埋设)' : plant}`,
          file: 'bible/hooks.jsonl',
          line: hook.line,
          locator: hook.id,
        })
      }
      if (hook.status === 'BROKEN' || hook.status === 'DEFERRED') {
        if (pay != null) {
          add('HOOK-003', {
            message: `伏笔「${hook.id}」显式 status=${hook.status}，但章节 frontmatter 存在 hooks_pay（章 ${pay}）`,
            file: 'bible/hooks.jsonl',
            line: hook.line,
            locator: hook.id,
          })
        }
      }
      if (hook.plant !== plant || hook.pay !== pay) {
        add('HOOK-006', {
          message: `伏笔「${hook.id}」断言 plant=${hook.plant}/pay=${hook.pay} 与 frontmatter 派生 plant=${plant}/pay=${pay} 不一致`,
          file: 'bible/hooks.jsonl',
          line: hook.line,
          locator: hook.id,
        })
      }
      const staleAfter = hook.staleAfter != null ? hook.staleAfter : cfg.staleHookChapters
      if (pay == null && plant != null && maxChapter - plant > staleAfter) {
        add('HOOK-002', {
          message: `伏笔「${hook.id}」派生状态 OPEN：当前最大章 ${maxChapter} - plant ${plant} = ${maxChapter - plant} > staleAfter ${staleAfter}`,
          file: 'bible/hooks.jsonl',
          line: hook.line,
          locator: hook.id,
        })
      }
    }
    for (const chapter of ctx.chapters) {
      for (const scene of chapter.scenes) {
        for (const plant of scene.hooks_plant) {
          if (!hookById.has(plant)) add('HOOK-004', { message: `场景 ${scene.id} hooks_plant 引用未注册伏笔「${plant}」`, file: scene.file, line: scene.line, locator: scene.id })
        }
        for (const pay of scene.hooks_pay) {
          if (!hookById.has(pay)) add('HOOK-004', { message: `场景 ${scene.id} hooks_pay 引用未注册伏笔「${pay}」`, file: scene.file, line: scene.line, locator: scene.id })
        }
      }
    }
  }

  // ---- OUT-001/002/003/004/005 & HOOK-005 ----
  {
    const cardByChapter = new Map()
    for (const card of ctx.outline.chapters) {
      if (card.chapter != null && !cardByChapter.has(card.chapter)) cardByChapter.set(card.chapter, card)
      for (const scene of card.scenes) {
        for (const key of ['goal', 'conflict', 'outcome']) {
          if (!scene[key]) {
            add('HOOK-005', {
              message: `大纲场景卡「${scene.id}」（第 ${card.chapter} 章）缺 ${key}`,
              file: 'outline/outline.json',
              line: 1,
              locator: scene.id,
            })
          }
        }
        if (scene.place && !placeById.has(scene.place)) {
          add('OUT-002', { message: `大纲场景卡「${scene.id}」place「${scene.place}」未注册`, file: 'outline/outline.json', line: 1, locator: scene.id })
        }
        for (const who of scene.cast) {
          if (!registered(who)) add('OUT-002', { message: `大纲场景卡「${scene.id}」cast「${who}」未注册`, file: 'outline/outline.json', line: 1, locator: scene.id })
        }
        for (const hookId of [...scene.hooks_plant, ...scene.hooks_pay]) {
          if (!hookById.has(hookId)) add('OUT-002', { message: `大纲场景卡「${scene.id}」hooks 引用未注册伏笔「${hookId}」`, file: 'outline/outline.json', line: 1, locator: scene.id })
        }
      }
    }

    const chapterByNumber = new Map(ctx.chapters.map((c) => [c.chapter, c]))
    for (const chapter of ctx.chapters) {
      if (!cardByChapter.has(chapter.chapter)) {
        add('OUT-001', { message: `存在章节文件 ${chapter.file}，但 outline.json 无第 ${chapter.chapter} 章卡`, file: chapter.file, line: 1, locator: `ch-${pad3(chapter.chapter)}` })
      }
    }
    for (const card of ctx.outline.chapters) {
      if (card.chapter == null) continue
      if (!chapterByNumber.has(card.chapter)) {
        add('OUT-003', { message: `大纲章节卡第 ${card.chapter} 章无对应章节文件`, file: 'outline/outline.json', line: 1, locator: `ch-${pad3(card.chapter)}` })
      }
    }
    for (const chapter of ctx.chapters) {
      const card = cardByChapter.get(chapter.chapter)
      if (!card) continue
      const fmIds = chapter.scenes.map((s) => s.id)
      const cardIds = card.scenes.map((s) => s.id)
      // PRD §5.4 v1.5（修 M2）：比较「集合」（数量或 id 不一致才算），场景顺序无关。
      const sameSet =
        fmIds.length === cardIds.length &&
        [...fmIds].sort().join('\u0000') === [...cardIds].sort().join('\u0000')
      if (!sameSet) {
        add('OUT-004', {
          message: `第 ${chapter.chapter} 章 frontmatter 场景 id [${fmIds.join(', ')}] 与大纲卡 [${cardIds.join(', ')}] 不一致`,
          file: chapter.file,
          line: 1,
          locator: `ch-${pad3(chapter.chapter)}`,
        })
      }
      const cardById = new Map(card.scenes.map((s) => [s.id, s]))
      for (const scene of chapter.scenes) {
        const outlineScene = cardById.get(scene.id)
        if (!outlineScene) continue
        if (outlineScene.place && scene.place && outlineScene.place !== scene.place) {
          add('OUT-005', { message: `场景 ${scene.id} place 与大纲卡不一致：frontmatter=${scene.place} / outline=${outlineScene.place}`, file: chapter.file, line: scene.line, locator: scene.id })
        }
        const fmCast = [...scene.cast].sort().join('|')
        const cardCast = [...outlineScene.cast].sort().join('|')
        if (fmCast !== cardCast) {
          add('OUT-005', { message: `场景 ${scene.id} cast 与大纲卡不一致：frontmatter=[${scene.cast.join(', ')}] / outline=[${outlineScene.cast.join(', ')}]`, file: chapter.file, line: scene.line, locator: scene.id })
        }
        const fmPlant = [...scene.hooks_plant].sort().join('|')
        const cardPlant = [...outlineScene.hooks_plant].sort().join('|')
        if (fmPlant !== cardPlant) {
          add('OUT-005', { message: `场景 ${scene.id} hooks_plant 与大纲卡不一致`, file: chapter.file, line: scene.line, locator: scene.id })
        }
        const fmPay = [...scene.hooks_pay].sort().join('|')
        const cardPay = [...outlineScene.hooks_pay].sort().join('|')
        if (fmPay !== cardPay) {
          add('OUT-005', { message: `场景 ${scene.id} hooks_pay 与大纲卡不一致`, file: chapter.file, line: scene.line, locator: scene.id })
        }
      }
    }
  }

  // ---- DOC-007 / DOC-008 ----
  {
    const target = cfg.chapterWords
    const tolerance = cfg.chapterWordsTolerance
    if (Number.isFinite(target) && target > 0 && Number.isFinite(tolerance) && tolerance >= 0) {
      for (const chapter of ctx.chapters) {
        if (chapter.words < target * (1 - tolerance) || chapter.words > target * (1 + tolerance)) {
          add('DOC-007', {
            message: `章节 ${chapter.file} 字数 ${chapter.words} 偏离目标 ${target} 超过容差 ${tolerance}`,
            file: chapter.file,
            line: 1,
            locator: `ch-${pad3(chapter.chapter)}`,
          })
        }
      }
    }
    if (ctx.summaries) {
      for (const chapter of ctx.chapters) {
        const re = new RegExp(`^##\\s*ch-0*${chapter.chapter}(?:\\s|$)`, 'm')
        if (!re.test(ctx.summaries)) {
          add('DOC-008', {
            message: `summaries.md 缺章节 ch-${pad3(chapter.chapter)} 的摘要小节`,
            file: 'summaries.md',
            line: 1,
            locator: `ch-${pad3(chapter.chapter)}`,
          })
        }
      }
    }
  }

  // ---- CHAR-006 死者提及未登记 mentions ----
  {
    const deadLike = ctx.characters.filter((c) => c.status === 'dead' || c.status === 'missing')
    for (const chapter of ctx.chapters) {
      if (!chapter.body) continue
      const mentions = new Set(chapter.mentions)
      for (const character of deadLike) {
        if (mentions.has(character.id)) continue
        const names = [character.name, ...character.aliases].filter((n) => typeof n === 'string' && n.length >= 2)
        const hit = names.find((name) => chapter.body.includes(name))
        if (hit) {
          add('CHAR-006', {
            message: `正文出现 status=${character.status} 角色「${hit}」，但该章 mentions 未登记「${character.id}」`,
            file: chapter.file,
            line: 1,
            locator: character.id,
          })
        }
      }
    }
  }

  // ---- VOICE-001..011（逐章） ----
  {
    const voiceCfg = buildVoiceContext({ ...cfg, characters: ctx.characters })
    for (const chapter of ctx.chapters) {
      const voice = runVoiceStage(chapter.body, chapter.bodyLine, chapter.file, `ch-${pad3(chapter.chapter)}`, voiceCfg)
      findings.push(...voice.findings)
    }
  }

  // ---- 派生汇总 ----
  const derived = {
    timelineDay,
    hookStats: (() => {
      let open = 0
      let paid = 0
      let stale = 0
      for (const hook of ctx.hooks) {
        const plant = minChapterOf(hookPlantDerived, hook.id)
        const pay = minChapterOf(hookPayDerived, hook.id)
        const staleAfter = hook.staleAfter != null ? hook.staleAfter : cfg.staleHookChapters
        if (pay != null) paid++
        else {
          open++
          if (plant != null && maxChapter - plant > staleAfter) stale++
        }
      }
      return { open, paid, stale }
    })(),
    hooksList: ctx.hooks.map((hook) => {
      const plant = minChapterOf(hookPlantDerived, hook.id)
      const pay = minChapterOf(hookPayDerived, hook.id)
      const staleAfter = hook.staleAfter != null ? hook.staleAfter : cfg.staleHookChapters
      return {
        id: hook.id,
        question: hook.question,
        plant,
        pay,
        status: hook.status,
        derivedStatus: pay != null ? 'PAID' : 'OPEN',
        staleAfter,
        stale: pay == null && plant != null && maxChapter - plant > staleAfter,
      }
    }),
    charCounts: {
      alive: ctx.characters.filter((c) => c.status === 'alive').length,
      dead: ctx.characters.filter((c) => c.status === 'dead').length,
      missing: ctx.characters.filter((c) => c.status === 'missing').length,
    },
    items: [...items.values()].map((state) => ({ id: state.id, name: state.name, holder: state.holder, place: state.place, status: state.status })),
    injuries: [...injuries.entries()]
      .map(([key, value]) => {
        const [who, part] = key.split('\u0000')
        return { who, part, severity: -value }
      })
      .filter((entry) => entry.severity > 0)
      .sort((a, b) => a.who.localeCompare(b.who) || a.part.localeCompare(b.part)),
    maxChapter,
  }
  return { findings, derived }
}

// ---------------------------------------------------------------------------
// 10. 豁免（PRD §5.2）
// ---------------------------------------------------------------------------

function exemptionSpecificity(entry) {
  let score = 0
  if (typeof entry.rule === 'string' && entry.rule.trim()) score += 1
  if (typeof entry.locator === 'string' && entry.locator.trim()) score += 2
  if (typeof entry.messageIncludes === 'string' && entry.messageIncludes.trim()) score += 2
  return score
}

function chapterRefsOfFinding(finding) {
  const refs = []
  const m = /ch-?(\d+)/.exec(finding.file || '')
  if (m) {
    const n = Number(m[1])
    refs.push(`ch-${pad3(n)}`, String(n))
  }
  return refs
}

function exemptionMatches(entry, finding) {
  if (typeof entry.rule !== 'string' || entry.rule !== finding.rule) return false
  if (typeof entry.locator === 'string' && entry.locator.trim() !== '' && entry.locator.trim() !== finding.locator) return false
  if (typeof entry.messageIncludes === 'string' && entry.messageIncludes.trim() !== '' && !String(finding.message).includes(entry.messageIncludes)) return false
  if (typeof entry.scope === 'string' && entry.scope.trim() !== '') {
    const scope = entry.scope.trim()
    const refs = chapterRefsOfFinding(finding)
    const scopeChapter = /^(?:ch-)?(\d+)$/.exec(scope)
    let matched = false
    if (scopeChapter) {
      const n = Number(scopeChapter[1])
      matched = refs.includes(`ch-${pad3(n)}`) || refs.includes(String(n)) || finding.locator === `ch-${pad3(n)}`
    }
    if (!matched && finding.locator) matched = String(finding.locator).startsWith(scope)
    if (!matched) return false
  }
  return true
}

function applyExemptionsWithStrict(findings, rawEntries, strict) {
  let skipped = 0
  const entries = []
  for (const raw of toArray(rawEntries)) {
    if (!isObject(raw)) {
      skipped++
      continue
    }
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''
    if (!reason) {
      skipped++
      continue
    }
    entries.push({ ...raw, reason })
  }
  const kept = []
  const dismissed = []
  const blocked = new Set()
  entries.forEach((entry, index) => {
    void index
    entry.__index = entries.indexOf(entry)
  })
  for (const finding of findings) {
    const candidates = entries.filter((entry) => exemptionMatches(entry, finding))
    if (!candidates.length) {
      kept.push(finding)
      continue
    }
    candidates.sort((a, b) => exemptionSpecificity(b) - exemptionSpecificity(a))
    const chosen = candidates[0]
    if (strict && (finding.severity === 'BLOCKER' || finding.severity === 'MAJOR')) {
      blocked.add(chosen.__index)
      kept.push(finding)
      continue
    }
    dismissed.push({ rule: finding.rule, severity: finding.severity, reason: chosen.reason })
  }
  skipped += blocked.size
  return { findings: kept, dismissed, skippedExemptions: skipped }
}

function countSeverities(findings) {
  const counts = { BLOCKER: 0, MAJOR: 0, MINOR: 0, NIT: 0, INFO: 0, dismissed: 0 }
  for (const finding of findings) {
    if (Object.prototype.hasOwnProperty.call(counts, finding.severity)) counts[finding.severity]++
  }
  return counts
}

// ---------------------------------------------------------------------------
// 11. lintProject
// ---------------------------------------------------------------------------

function emptyStats() {
  return {
    chapters: 0,
    words: 0,
    perChapter: [],
    timeline: { day: null },
    hooks: { open: 0, paid: 0, stale: 0 },
    characters: { alive: 0, dead: 0, missing: 0 },
    aiVoice: { score: 100, hitsPer1000: 0, weightedHitsPer1000: 0, rhythmCV: null, tagRatio: 0 },
    skippedExemptions: 0,
  }
}

function buildStats(ctx, derived, cfg, skippedExemptions) {
  const words = ctx.chapters.reduce((sum, chapter) => sum + chapter.words, 0)
  // PRD §5.3 v1.6（修 B2-F2）：thresholds 配置非法时统计同样 fail-closed（score=0），不得静默满分。
  const aggregate =
    cfg.style.thresholdsInvalid === true
      ? failVoice('style.thresholds 非法：必须是对象')
      : analyzeVoice(ctx.chapters.map((chapter) => chapter.body).join('\n\n'), {
          lang: cfg.lang,
          thresholds: cfg.style.thresholds,
          forbiddenWords: cfg.style.forbiddenWords,
        })
  return {
    chapters: ctx.chapters.length,
    words,
    perChapter: ctx.chapters.map((chapter) => ({ chapter: chapter.chapter, title: chapter.title, words: chapter.words })),
    timeline: { day: derived.timelineDay },
    hooks: derived.hookStats,
    characters: derived.charCounts,
    aiVoice: {
      score: aggregate.score,
      hitsPer1000: aggregate.hitsPer1000,
      weightedHitsPer1000: aggregate.weightedHitsPer1000,
      rhythmCV: aggregate.rhythmCV,
      tagRatio: aggregate.tagRatio,
    },
    skippedExemptions,
  }
}

/**
 * 项目级 lint。
 * @param {string} projectDir
 * @param {object} [options] `{chapter?, strict?, config?, now?}`
 * @returns Report（PRD §5.2 冻结形状；任何失败都不抛异常）
 */
export async function lintProject(projectDir, options = {}) {
  const opts = isObject(options) ? options : {}
  try {
    const ctx = await loadProjectContext(projectDir)
    const cfg = mergeProjectConfig(ctx.project, opts.config)
    const analysis = analyzeProjectState(ctx, cfg)
    let findings = dedupeFindings(sortFindings([...ctx.baseFindings, ...analysis.findings]))

    let scope = 'all'
    if (Number.isInteger(opts.chapter)) {
      scope = `ch-${pad3(opts.chapter)}`
      const selectedFile = `chapters/ch-${pad3(opts.chapter)}.md`
      // PRD §5.2 §5.5 v1.5（修 H2）：章门禁 = 本章文件 findings ∪ 全部非章节文件 findings，
      // 否则 bible/outline/config 级 BLOCKER 会被过滤掉、章门禁可无限推进。
      findings = findings.filter((finding) => {
        if (!(finding.file === selectedFile || !finding.file.startsWith('chapters/'))) return false
        // PRD §5.5 v1.7（修 B2-F1）：计划/进度型断言不并入章门禁（先建大纲、逐章写时必然为真），
        // 全量 `lint`（不带 --chapter）仍照常报 OUT-003/FACT-004。
        return !PLAN_PROGRESS_RULES.includes(finding.rule)
      })
    }

    const strict = opts.strict === true
    const applied = applyExemptionsWithStrict(findings, ctx.exemptions, strict)
    const counts = countSeverities(applied.findings)
    counts.dismissed = applied.dismissed.length
    const failed = counts.BLOCKER > 0 || counts.MAJOR > 0 || (strict && counts.MINOR > 0)
    const verdict = failed ? 'FAIL' : 'PASS'
    return {
      ok: verdict === 'PASS',
      schemaVersion: SCHEMA_VERSION,
      engineVersion: VERSION,
      project: ctx.dir,
      title: ctx.project.title || '',
      scope,
      verdict,
      strict,
      counts,
      findings: applied.findings,
      dismissed: applied.dismissed,
      stats: buildStats(ctx, analysis.derived, cfg, applied.skippedExemptions),
    }
  } catch (err) {
    const message = `引擎内部错误：${(err && err.message) || err}`
    const finding = makeFinding('DOC-002', { message, file: 'project.json', line: 1, locator: '' })
    return {
      ok: false,
      schemaVersion: SCHEMA_VERSION,
      engineVersion: VERSION,
      project: path.resolve(String(projectDir == null ? '.' : projectDir)),
      title: '',
      scope: 'all',
      verdict: 'FAIL',
      strict: opts.strict === true,
      counts: { BLOCKER: 1, MAJOR: 0, MINOR: 0, NIT: 0, INFO: 0, dismissed: 0 },
      findings: [finding],
      dismissed: [],
      stats: emptyStats(),
    }
  }
}

// ---------------------------------------------------------------------------
// 12. status / context
// ---------------------------------------------------------------------------

/**
 * 派生状态（`status --json` 顶层键冻结，PRD §5.5）。
 */
async function buildStatus(projectDir) {
  const ctx = await loadProjectContext(projectDir)
  const analysis = analyzeProjectState(ctx, ctx.project)
  const derived = analysis.derived
  return {
    ok: true,
    title: ctx.project.title || '',
    chapters: ctx.chapters.length,
    words: ctx.chapters.reduce((sum, chapter) => sum + chapter.words, 0),
    perChapter: ctx.chapters.map((chapter) => ({ chapter: chapter.chapter, title: chapter.title, words: chapter.words })),
    timeline: { day: derived.timelineDay },
    hooks: derived.hookStats,
    characters: derived.charCounts,
    items: derived.items,
    injuries: derived.injuries,
    lastChapter: ctx.chapters.length ? ctx.chapters[ctx.chapters.length - 1].chapter : null,
  }
}

function extractSummarySection(summaries, chapterNumber) {
  if (!summaries) return ''
  const lines = normText(summaries).split('\n')
  const startRe = new RegExp(`^##\\s*ch-0*${chapterNumber}(?:\\s|$)`)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return ''
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n').trim()
}

/**
 * 下一章写作上下文包（`context --json` 顶层键冻结，PRD §5.5）。
 */
async function buildContext(projectDir, chapterNumber) {
  const ctx = await loadProjectContext(projectDir)
  if (ctx.projectMissing) return { error: '项目缺少 project.json，无法生成上下文包' }
  const card = ctx.outline.chapters.find((item) => item.chapter === chapterNumber)
  if (!card) return { error: `大纲缺少章节卡：ch-${pad3(chapterNumber)}` }
  const analysis = analyzeProjectState(ctx, ctx.project)
  const derived = analysis.derived
  const previous = ctx.chapters.find((chapter) => chapter.chapter === chapterNumber - 1)
  const previousCast = previous ? previous.scenes.flatMap((scene) => scene.cast) : []
  const cardCast = card.scenes.flatMap((scene) => scene.cast)
  const castIds = unique([...cardCast, ...previousCast]).sort((a, b) => a.localeCompare(b))
  const castCards = castIds.map((id) => ctx.characters.find((character) => character.id === id)).filter(Boolean)
  return {
    ok: true,
    chapter: chapterNumber,
    outlineCard: card,
    previousSummary: extractSummarySection(ctx.summaries, chapterNumber - 1),
    castCards,
    openHooks: derived.hooksList.filter((hook) => hook.derivedStatus === 'OPEN'),
    facts: ctx.facts,
    places: ctx.space.places,
    styleGuide: ctx.styleGuide,
  }
}

// ---------------------------------------------------------------------------
// 13. renderReport（PRD §5.5 冻结骨架）
// ---------------------------------------------------------------------------

function escapePipe(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** 报告自由文本（title/project 等）转义：单行化 + 管道转义，防 markdown 注入（PRD v1.7 F4）。 */
function escapeReportLine(value) {
  return String(value == null ? '' : value).replace(/\r\n?/g, ' ').replace(/\n/g, ' ').replace(/\|/g, '\\|')
}

function locationText(finding) {
  const where = finding.file || ''
  const line = Number.isInteger(finding.line) ? finding.line : 1
  const base = where ? `${where}:${line}` : `:${line}`
  return finding.locator ? `${base}（${finding.locator}）` : base
}

/**
 * 渲染人读 markdown 报告（骨架冻结）。
 * @param {object} report lintProject 的返回值（prose 也复用）
 * @param {object} [options]
 * @returns {string}
 */
export function renderReport(report, options = {}) {
  void options
  const r = isObject(report) ? report : {}
  const findings = toArray(r.findings)
  const dismissed = toArray(r.dismissed)
  const counts = isObject(r.counts) ? r.counts : countSeverities(findings)
  const stats = isObject(r.stats) ? r.stats : {}
  const skipped = Number.isInteger(stats.skippedExemptions) ? stats.skippedExemptions : 0
  // PRD §11 v1.7（修 B2-F4）：标题/项目等自由文本写入 markdown 前做单行 + 管道转义，防伪段落/表头注入。
  const titleText = escapeReportLine(r.title)
  const projectText = escapeReportLine(r.project)
  const lines = []
  lines.push(`# 小说门禁报告 — ${titleText}`)
  lines.push(`- 结论：${r.verdict || 'PASS'} / 范围：${r.scope || 'all'} / strict：${r.strict === true} / 引擎：novel-lint ${VERSION}`)
  lines.push(`- 项目：${projectText}`)
  lines.push('## 统计')
  lines.push('| 级别 | 数量 |')
  lines.push('| --- | --- |')
  for (const severity of SEVERITIES) {
    lines.push(`| ${severity} | ${counts[severity] != null ? counts[severity] : 0} |`)
  }
  lines.push(`| 豁免 | ${dismissed.length} |`)
  lines.push(`## 发现（${findings.length}）`)
  lines.push('| 级别 | 规则 | 位置 | 说明 | 修复路由 |')
  lines.push('| --- | --- | --- | --- | --- |')
  if (findings.length === 0) {
    lines.push('| - | - | - | 无 | - |')
  } else {
    for (const finding of findings) {
      lines.push(
        `| ${finding.severity} | ${finding.rule} | ${escapePipe(locationText(finding))} | ${escapePipe(finding.message)} | ${finding.fixRoute} |`
      )
    }
  }
  lines.push(`## 豁免（${dismissed.length}）`)
  lines.push(`- 本次豁免 ${dismissed.length} 条，跳过 ${skipped} 条（缺 reason 或 strict 下 BLOCKER/MAJOR 不可豁免）`)
  if (dismissed.length) {
    lines.push('| 规则 | 级别 | 原因 |')
    lines.push('| --- | --- | --- |')
    for (const item of dismissed) {
      lines.push(`| ${item.rule || ''} | ${item.severity || ''} | ${escapePipe(item.reason)} |`)
    }
  }
  lines.push('## 下一步')
  const nextSteps = []
  if (findings.length === 0) {
    nextSteps.push('- 门禁通过：可以进入下一章。')
  } else {
    const byRoute = new Map()
    for (const finding of findings) byRoute.set(finding.fixRoute, (byRoute.get(finding.fixRoute) || 0) + 1)
    nextSteps.push(
      `- 共 ${findings.length} 条待修复，按修复路由分派：${[...byRoute.entries()].map(([route, n]) => `${route} ${n} 条`).join('，')}。`
    )
    if ((counts.BLOCKER || 0) > 0) nextSteps.push(`- 先清 BLOCKER（${counts.BLOCKER} 条）：未清零不得进入下一章。`)
    if (r.strict === true && (counts.MINOR || 0) > 0) nextSteps.push(`- strict 模式：MINOR（${counts.MINOR} 条）也要清零。`)
  }
  if (dismissed.length) nextSteps.push(`- 已豁免 ${dismissed.length} 条（reports/exemptions.json），提交前请复核理由。`)
  if (skipped > 0) nextSteps.push(`- 有 ${skipped} 条豁免被跳过（缺 reason 或 strict 下 BLOCKER/MAJOR 不可豁免）。`)
  lines.push(...nextSteps)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 14. CLI（PRD §5.1 / §5.5）
// ---------------------------------------------------------------------------

const USAGE = [
  `novel-forge 确定性校验引擎（novel-lint ${VERSION}）`,
  '',
  '用法：',
  '  node lib/novel-lint.mjs init <dir> --title "<标题>" [--slug s] [--lang zh-CN] [--genre 悬疑] [--force]',
  '  node lib/novel-lint.mjs lint <dir> [--chapter N] [--strict] [--json] [--report <path>]',
  '  node lib/novel-lint.mjs status <dir> [--json]',
  '  node lib/novel-lint.mjs context <dir> --chapter N [--json]',
  '  node lib/novel-lint.mjs prose <file> [--json]   # 仅文本局部规则：DOC-005/006 + VOICE-001..011（不含 DOC-007 字数偏离，无 chapterWords 上下文）',
  '  node lib/novel-lint.mjs rules [--json]',
  '',
  '退出码：0 = 门禁通过；1 = 门禁失败；2 = 用法/IO 错误',
].join('\n') + '\n'

const VALUE_FLAGS = new Set(['title', 'slug', 'lang', 'genre', 'report', 'chapter'])
const BOOL_FLAGS = new Set(['force', 'strict', 'json', 'help'])

function parseCliArgs(tokens) {
  const positional = []
  const flags = {}
  let i = 0
  while (i < tokens.length) {
    const tok = String(tokens[i] == null ? '' : tokens[i])
    if (tok === '--help' || tok === '-h') {
      flags.help = true
      i++
      continue
    }
    if (tok.startsWith('--')) {
      let name = tok.slice(2)
      let value = null
      const eq = name.indexOf('=')
      if (eq !== -1) {
        value = name.slice(eq + 1)
        name = name.slice(0, eq)
      }
      if (VALUE_FLAGS.has(name)) {
        if (value === null) {
          value = i + 1 < tokens.length ? String(tokens[i + 1]) : undefined
          if (value !== undefined) i++
        }
        if (value === undefined || value.startsWith('--')) return { error: `参数 --${name} 缺少取值` }
        flags[name] = value
        i++
        continue
      }
      if (BOOL_FLAGS.has(name)) {
        flags[name] = true
        i++
        continue
      }
      return { error: `未知参数：--${name}` }
    }
    if (tok.startsWith('-') && tok !== '-') return { error: `未知参数：${tok}` }
    positional.push(tok)
    i++
  }
  return { positional, flags }
}

function parseChapterArg(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (!/^\d+$/.test(text)) return { error: '无效章节号' }
  const value = Number(text)
  if (!Number.isInteger(value) || value <= 0) return { error: '无效章节号' }
  return { value }
}

async function writeReportFiles(projectDir, report, extraPath) {
  const reportsDir = path.join(projectDir, 'reports')
  const jsonText = `${JSON.stringify(report, null, 2)}\n`
  const mdText = `${renderReport(report)}\n`
  const errors = []
  async function tryWrite(target, content) {
    try {
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
    } catch (err) {
      errors.push({ path: target, message: (err && err.message) || String(err) })
    }
  }
  // PRD §5.1 v1.5（修 H3）：默认产物「总是」写盘；写失败不得静默 PASS，由 CLI 转 stderr + exit 2。
  await tryWrite(path.join(reportsDir, 'last.json'), jsonText)
  await tryWrite(path.join(reportsDir, 'last.md'), mdText)
  if (extraPath) {
    const target = path.resolve(extraPath)
    const isJson = target.toLowerCase().endsWith('.json')
    await tryWrite(target, isJson ? jsonText : mdText)
  }
  return { jsonText, mdText, errors }
}

function buildProseReport(filePath, text, cfg) {
  const src = normText(text)
  const firstLineIsMarker = (src.split('\n')[0] || '').trim() === '---'
  // PRD §5.1/§5.5 v1.5（修 M1）：prose 只跑文本局部规则 = 委托 lintChapterText，
  // 产出集 = DOC-005/006 + VOICE-001…011。
  const check = lintChapterText(src, { config: cfg })
  const findings = check.findings
    // 无 chapterWords 上下文：prose 不做项目级字数偏离判定，显式过滤 DOC-007。
    .filter((finding) => finding.rule !== 'DOC-007')
    // 完全没有 frontmatter 是普通文本的合法形态：不报 DOC-005（零标注价值路径）。
    .filter((finding) => firstLineIsMarker || finding.rule !== 'DOC-005')
    .map((finding) => {
      // PRD §5.5 v1.6（修 N1）：prose 的 DOC-005 message 必须含行号信息，且与 line 字段一致。
      // lintChapterText 的 DOC-005 文案尚无行号 → 在此统一追加（已有则复用，不写两套）。
      const message =
        finding.rule === 'DOC-005' && !/第\s*\d+\s*行/.test(finding.message)
          ? `${finding.message}（第 ${finding.line} 行）`
          : finding.message
      return { ...finding, file: filePath, locator: '', message }
    })
  const aiVoice = check.aiVoice
  const counts = countSeverities(findings)
  counts.dismissed = 0
  const failed = counts.BLOCKER > 0 || counts.MAJOR > 0
  return {
    ok: !failed,
    schemaVersion: SCHEMA_VERSION,
    engineVersion: VERSION,
    project: filePath,
    title: path.basename(filePath),
    scope: 'prose',
    verdict: failed ? 'FAIL' : 'PASS',
    strict: false,
    counts,
    findings,
    dismissed: [],
    stats: { words: check.stats.words, skippedExemptions: 0, aiVoice },
    aiVoice,
    file: filePath,
  }
}

function renderRulesTable() {
  const lines = ['# 规则目录（62 条）', '', '| ID | 维度 | 级别 | 修复路由 | 标题 |', '| --- | --- | --- | --- | --- |']
  for (const rule of RULES) lines.push(`| ${rule.id} | ${rule.dimension} | ${rule.severity} | ${rule.fixRoute} | ${escapePipe(rule.title)} |`)
  return `${lines.join('\n')}\n`
}

function renderStatusMarkdown(status) {
  const lines = [
    `# 项目状态 — ${status.title || '(未命名)'}`,
    '',
    '| 项 | 值 |',
    '| --- | --- |',
    `| 章节数 | ${status.chapters} |`,
    `| 总字数 | ${status.words} |`,
    `| 时间线 day | ${status.timeline.day == null ? '-' : status.timeline.day} |`,
    `| 伏笔（OPEN/PAID/STALE） | ${status.hooks.open} / ${status.hooks.paid} / ${status.hooks.stale} |`,
    `| 角色（alive/dead/missing） | ${status.characters.alive} / ${status.characters.dead} / ${status.characters.missing} |`,
    `| 最后一章 | ${status.lastChapter == null ? '-' : `ch-${pad3(status.lastChapter)}`} |`,
    '',
  ]
  if (status.perChapter.length) {
    lines.push('## 每章字数', '', '| 章节 | 标题 | 字数 |', '| --- | --- | --- |')
    for (const item of status.perChapter) lines.push(`| ch-${pad3(item.chapter)} | ${escapePipe(item.title)} | ${item.words} |`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function renderContextMarkdown(pack) {
  const lines = [
    `# 写作上下文包 — 第 ${pack.chapter} 章`,
    '',
    `## 大纲卡`,
    '',
    `- 章节：${pack.chapter}${pack.outlineCard.title ? ` ${pack.outlineCard.title}` : ''}`,
    `- 场景：${pack.outlineCard.scenes.map((scene) => scene.id).join('、') || '（无）'}`,
    '',
    '## 上一章摘要',
    '',
    pack.previousSummary || '（无）',
    '',
    '## 在场角色',
    '',
    pack.castCards.length ? pack.castCards.map((card) => `- ${card.id}（${card.name}）status=${card.status}`).join('\n') : '（无）',
    '',
    '## 未回收伏笔',
    '',
    pack.openHooks.length ? pack.openHooks.map((hook) => `- ${hook.id}：${hook.question}`).join('\n') : '（无）',
    '',
    '## 文风指南',
    '',
    pack.styleGuide || '（无）',
    '',
  ]
  return `${lines.join('\n')}\n`
}

async function runCliInner(args, out, err) {
  if (!args.length) {
    out(USAGE)
    return 2
  }
  const command = String(args[0])
  if (command === '--help' || command === '-h' || command === 'help') {
    out(USAGE)
    return 2
  }
  const parsedArgs = parseCliArgs(args.slice(1))
  if (parsedArgs.error) {
    err(`${parsedArgs.error}\n`)
    return 2
  }
  const { positional, flags } = parsedArgs
  if (flags.help) {
    out(USAGE)
    return 2
  }

  if (command === 'init') {
    const dir = positional[0]
    if (!dir) {
      err('缺少项目目录\n')
      return 2
    }
    if (typeof flags.title !== 'string' || !flags.title.trim()) {
      err('init 缺少 --title\n')
      return 2
    }
    const result = await scaffoldProject(dir, {
      title: flags.title,
      slug: flags.slug,
      lang: flags.lang,
      genre: flags.genre,
      force: flags.force === true,
    })
    if (!result.ok) {
      err(`${result.reason}\n`)
      return 2
    }
    if (flags.json) {
      out(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      out(`已创建 ${result.created.length} 个文件，跳过 ${result.skipped.length} 个已存在文件。\n项目：${result.dir}\n`)
    }
    return 0
  }

  if (command === 'lint') {
    const dir = positional[0]
    if (!dir) {
      err('缺少项目目录\n')
      return 2
    }
    const abs = path.resolve(dir)
    if (!(await isDirectoryPath(abs))) {
      err(`项目目录不存在：${abs}\n`)
      return 2
    }
    let chapterNumber = null
    if (flags.chapter !== undefined) {
      const parsed = parseChapterArg(flags.chapter)
      if (parsed.error) {
        err(`${parsed.error}\n`)
        return 2
      }
      chapterNumber = parsed.value
      const chapterFile = path.join(abs, 'chapters', `ch-${pad3(chapterNumber)}.md`)
      if (!(await isFilePath(chapterFile))) {
        err(`章节不存在：ch-${pad3(chapterNumber)}\n`)
        return 2
      }
    }
    const report = await lintProject(abs, { chapter: chapterNumber, strict: flags.strict === true })
    const { jsonText, mdText, errors } = await writeReportFiles(abs, report, flags.report)
    out(flags.json ? jsonText : mdText)
    if (errors.length) {
      // PRD §5.1 v1.5（修 H3）：报告写盘失败 → stderr 一行原因 + exit 2，绝不静默 PASS。
      for (const writeError of errors) err(`报告写入失败：${writeError.path}：${writeError.message}\n`)
      return 2
    }
    return report.verdict === 'PASS' ? 0 : 1
  }

  if (command === 'status') {
    const dir = positional[0]
    if (!dir) {
      err('缺少项目目录\n')
      return 2
    }
    const abs = path.resolve(dir)
    if (!(await isDirectoryPath(abs))) {
      err(`项目目录不存在：${abs}\n`)
      return 2
    }
    const status = await buildStatus(abs)
    out(flags.json ? `${JSON.stringify(status, null, 2)}\n` : renderStatusMarkdown(status))
    return 0
  }

  if (command === 'context') {
    const dir = positional[0]
    if (!dir) {
      err('缺少项目目录\n')
      return 2
    }
    const abs = path.resolve(dir)
    if (!(await isDirectoryPath(abs))) {
      err(`项目目录不存在：${abs}\n`)
      return 2
    }
    if (flags.chapter === undefined) {
      err('context 缺少 --chapter\n')
      return 2
    }
    const parsed = parseChapterArg(flags.chapter)
    if (parsed.error) {
      err(`${parsed.error}\n`)
      return 2
    }
    const chapterNumber = parsed.value
    // PRD §5.1/§5.5 v1.5（修 H1）：context 是「下一章」上下文包，不要求 ch-NNN.md 已存在；
    // 只校验正整数 + 大纲卡存在（缺卡由 buildContext 返回可读原因 → 2）。
    const pack = await buildContext(abs, chapterNumber)
    if (pack.error) {
      err(`${pack.error}\n`)
      return 2
    }
    out(flags.json ? `${JSON.stringify(pack, null, 2)}\n` : renderContextMarkdown(pack))
    return 0
  }

  if (command === 'prose') {
    const file = positional[0]
    if (!file) {
      err('缺少正文文件\n')
      return 2
    }
    const abs = path.resolve(file)
    if (!(await isFilePath(abs))) {
      err(`文件不存在：${abs}\n`)
      return 2
    }
    let text
    try {
      text = await readFile(abs, 'utf8')
    } catch (readErr) {
      err(`读取文件失败：${(readErr && readErr.message) || readErr}\n`)
      return 2
    }
    const cfg = normalizeConfig({})
    const report = buildProseReport(abs, text, cfg)
    out(flags.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderReport(report)}\n`)
    return report.verdict === 'PASS' ? 0 : 1
  }

  if (command === 'rules') {
    if (flags.json) out(`${JSON.stringify(RULES, null, 2)}\n`)
    else out(renderRulesTable())
    return 0
  }

  err(`未知命令：${command}\n`)
  out(USAGE)
  return 2
}

/**
 * CLI 入口。
 * @param {string[]} argv 参数数组（不含 node / 脚本路径）
 * @param {{out?: Function, err?: Function}} [io]
 * @returns {Promise<number>} 退出码 0/1/2
 */
export async function runCli(argv, io) {
  const out = io && typeof io.out === 'function' ? io.out : (chunk) => process.stdout.write(chunk)
  const err = io && typeof io.err === 'function' ? io.err : (chunk) => process.stderr.write(chunk)
  try {
    return await runCliInner(Array.isArray(argv) ? argv.slice() : [], out, err)
  } catch (e) {
    try {
      err(`内部错误：${(e && e.message) || e}\n`)
    } catch {
      /* ignore */
    }
    return 2
  }
}

// ---------------------------------------------------------------------------
// 15. CLI 入口守卫
// ---------------------------------------------------------------------------

function isDirectInvocation() {
  try {
    const entry = process.argv[1]
    if (!entry) return false
    return import.meta.url === pathToFileURL(path.resolve(entry)).href
  } catch {
    return false
  }
}

if (isDirectInvocation()) {
  const exitCode = await runCli(process.argv.slice(2))
  process.exitCode = Number.isInteger(exitCode) ? exitCode : 2
}
