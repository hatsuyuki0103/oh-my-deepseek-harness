// SPDX-License-Identifier: MIT
// test/novel-lint.test.mjs — novel-forge 校验引擎契约测试（TDD：红 → 绿）。
//
// 真源（冻结）：
//   .omx/plans/test-spec-novel-forge.md v1.3（NF-01…NF-23 + §2 夹具矩阵 + §4 非空洞自测）
//   .omx/plans/prd-novel-forge.md v1.7（§3 布局 / §4 schema / §5 引擎 API + 规则目录 + 报告骨架；
//     v1.3 FACT-003 / v1.4 prose DOC-005 / v1.5 H1/H2/H3/M1/M2/M5+阈值 1.5 /
//     v1.6 fail-closed / v1.7 F1 计划型断言 + F2 fail-closed + F4 报告转义）
//
// 覆盖：NF-01…NF-19、NF-21、NF-23（共 72 条测试）。
//   - 2026-10-29 口径归一：NF-21 skipped[] 含非脚手架已存在文件；VOICE-006/007/008/009 已补靶向覆盖；
//     FACT-003 按 v1.3 正反例断言；NF-23 台账 COVERED=62/62（NOT_YET 清空）。
//   - PRD v1.4（QA-B4）：prose 对「以 --- 开头但 YAML-lite 解析失败」必须产出 DOC-005 BLOCKER，
//     对无 frontmatter 纯文本不误报（见 NF-19/v1.4 两条测试）。
//   - PRD v1.5（code-review H1/H2/H3/M1/M2/M5 + 阈值 1.5）：context 写前可用、章门禁含全局、
//     报告写盘失败 exit 2、prose 委托规则面（含 DOC-006 不含 DOC-007）、OUT-004 集合语义、
//     DOC-004 缺口聚合、默认 maxWeightedClichesPer1000=1.5（见对应 v1.5 测试）。
//   - PRD v1.6/v1.7（code-review B2 的 N1/F1/F2/F4）：prose DOC-005 message 必须含「第 N 行」；
//     计划型断言 OUT-003/FACT-004 不并入 --chapter 章门禁（全量 lint 仍报）；
//     语音分析内部异常 fail-closed（score=0 + VOICE-011 MAJOR，不得返回满分）；renderReport 转义 title。
//   - NF-20 / NF-22 属于 test/skills.test.mjs 的包契约 lane（由 Lead 持有），本文件不重复断言。
//
// 约束：
//   - 只 import ../lib/novel-lint.mjs 与 node 内置模块；
//   - 禁止 spawn 子进程，CLI 一律进程内 `runCli(argv, io)`，io 自接 out/err；
//   - 每条规则断言同时断言 rule 与 severity（并核对 dimension / fixRoute）；
//   - NF-23：COVERED 只由真实命中断言累积，NOT_YET 每条显式 {id, reason}。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SCHEMA_VERSION,
  VERSION,
  RULES,
  scaffoldProject,
  lintProject,
  lintChapterText,
  analyzeVoice,
  renderReport,
  runCli,
} from '../lib/novel-lint.mjs'

// ---------------------------------------------------------------------------
// 0. 冻结常量：PRD §5.4 规则目录（id / dimension / severity / fixRoute）
// 级别一律全称（B=BLOCKER / M=MAJOR / m=MINOR / n=NIT / i=INFO）；
// 路由 P=prose / B=bible / O=outline / C=config。
// ---------------------------------------------------------------------------
const RULE_TABLE = [
  ['DOC-001', 'structure', 'BLOCKER', 'config'],
  ['DOC-002', 'structure', 'BLOCKER', 'bible'],
  ['DOC-003', 'structure', 'MAJOR', 'prose'],
  ['DOC-004', 'structure', 'MAJOR', 'prose'],
  ['DOC-005', 'structure', 'BLOCKER', 'prose'],
  ['DOC-006', 'structure', 'BLOCKER', 'prose'],
  ['DOC-007', 'structure', 'MINOR', 'prose'],
  ['DOC-008', 'structure', 'MINOR', 'prose'],
  ['SPACE-001', 'space', 'BLOCKER', 'bible'],
  ['SPACE-002', 'space', 'BLOCKER', 'outline'],
  ['SPACE-003', 'space', 'BLOCKER', 'prose'],
  ['SPACE-004', 'space', 'BLOCKER', 'prose'],
  ['SPACE-005', 'space', 'BLOCKER', 'prose'],
  ['TIME-001', 'time', 'BLOCKER', 'prose'],
  ['TIME-002', 'time', 'BLOCKER', 'prose'],
  ['TIME-003', 'time', 'MAJOR', 'prose'],
  ['TIME-004', 'time', 'MINOR', 'prose'],
  ['TIME-005', 'time', 'MAJOR', 'bible'],
  ['TIME-006', 'time', 'MINOR', 'prose'],
  ['TIME-007', 'time', 'MAJOR', 'prose'],
  ['PHYS-001', 'physics', 'MAJOR', 'prose'],
  ['PHYS-002', 'physics', 'BLOCKER', 'prose'],
  ['PHYS-003', 'physics', 'BLOCKER', 'prose'],
  ['PHYS-004', 'physics', 'MAJOR', 'prose'],
  ['PHYS-005', 'physics', 'BLOCKER', 'prose'],
  ['PHYS-006', 'physics', 'MAJOR', 'prose'],
  ['PHYS-007', 'physics', 'BLOCKER', 'bible'],
  ['DLG-001', 'dialogue', 'BLOCKER', 'prose'],
  ['DLG-002', 'dialogue', 'BLOCKER', 'bible'],
  ['DLG-003', 'dialogue', 'MINOR', 'prose'],
  ['CHAR-001', 'character', 'BLOCKER', 'bible'],
  ['CHAR-002', 'character', 'BLOCKER', 'prose'],
  ['CHAR-003', 'character', 'BLOCKER', 'prose'],
  ['CHAR-004', 'character', 'MINOR', 'bible'],
  ['CHAR-005', 'character', 'BLOCKER', 'bible'],
  ['CHAR-006', 'character', 'MINOR', 'prose'],
  ['FACT-001', 'fact', 'MAJOR', 'bible'],
  ['FACT-002', 'fact', 'BLOCKER', 'bible'],
  ['FACT-003', 'fact', 'MAJOR', 'prose'],
  ['FACT-004', 'fact', 'MAJOR', 'bible'],
  ['HOOK-001', 'hook', 'BLOCKER', 'outline'],
  ['HOOK-002', 'hook', 'MAJOR', 'bible'],
  ['HOOK-003', 'hook', 'MAJOR', 'bible'],
  ['HOOK-004', 'hook', 'BLOCKER', 'bible'],
  ['HOOK-005', 'hook', 'MINOR', 'outline'],
  ['HOOK-006', 'hook', 'MINOR', 'bible'],
  ['OUT-001', 'outline', 'MAJOR', 'outline'],
  ['OUT-002', 'outline', 'BLOCKER', 'outline'],
  ['OUT-003', 'outline', 'MAJOR', 'outline'],
  ['OUT-004', 'outline', 'MAJOR', 'prose'],
  ['OUT-005', 'outline', 'MINOR', 'outline'],
  ['VOICE-001', 'voice', 'BLOCKER', 'prose'],
  ['VOICE-002', 'voice', 'MAJOR', 'prose'],
  ['VOICE-003', 'voice', 'MINOR', 'prose'],
  ['VOICE-004', 'voice', 'MINOR', 'prose'],
  ['VOICE-005', 'voice', 'NIT', 'prose'],
  ['VOICE-006', 'voice', 'MINOR', 'prose'],
  ['VOICE-007', 'voice', 'MINOR', 'prose'],
  ['VOICE-008', 'voice', 'MINOR', 'prose'],
  ['VOICE-009', 'voice', 'MINOR', 'prose'],
  ['VOICE-010', 'voice', 'INFO', 'prose'],
  ['VOICE-011', 'voice', 'MAJOR', 'prose'],
]

const RULES_BY_ID = new Map(
  RULE_TABLE.map(([id, dimension, severity, fixRoute]) => [id, { id, dimension, severity, fixRoute }])
)
const ALL_RULE_IDS = RULE_TABLE.map((row) => row[0])
const SEVERITIES = ['BLOCKER', 'MAJOR', 'MINOR', 'NIT', 'INFO']
const DIMENSIONS = new Set(['structure', 'space', 'time', 'physics', 'dialogue', 'character', 'fact', 'hook', 'outline', 'voice'])
const FIX_ROUTES = new Set(['prose', 'bible', 'outline', 'config'])

// NF-23 覆盖台账：只由真实命中断言（expectRule）累积。
const COVERED = new Set()
// NF-23 显式未覆盖台账。
// 2026-10-29 口径归一：VOICE-006/007/008/009 的词表/正则已在
// skills/novel-forge/references/anti-ai-voice.md §2 冻结（引擎逐条对齐），
// 对应靶向测试已补（见下方 NF-13 边界规则），故台账清空 → COVERED=62/62。
// 若未来仍有未覆盖项，必须逐条 {id, reason} 显式声明（reason 不得空泛）。
const NOT_YET = []

// ---------------------------------------------------------------------------
// 1. 路径与 IO 辅助
// ---------------------------------------------------------------------------
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures', 'novel')
const fixturePath = (name) => path.join(FIXTURES, name)

function makeIo() {
  const out = []
  const err = []
  return { io: { out: (chunk) => out.push(String(chunk)), err: (chunk) => err.push(String(chunk)) }, out, err }
}

async function cli(argv) {
  const { io, out, err } = makeIo()
  const code = await runCli(argv, io)
  return { code, out: out.join(''), err: err.join('') }
}

async function withTmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'novel-lint-test-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// 所有 lintProject / CLI 断言都在临时副本上跑，污染不了 test/fixtures/novel/**。
async function withFixture(name, fn) {
  return withTmp(async (dir) => {
    const project = path.join(dir, 'project')
    await cp(fixturePath(name), project, { recursive: true })
    return await fn(project, dir)
  })
}

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(abs, base)))
    else out.push(path.relative(base, abs).split(path.sep).join('/'))
  }
  return out.sort()
}

function relEntry(target, entry) {
  const abs = path.isAbsolute(entry) ? entry : path.resolve(target, String(entry))
  return path.relative(target, abs).split(path.sep).join('/')
}

function relSetOf(target, entries) {
  return new Set((entries || []).map((entry) => relEntry(target, entry)))
}

// 断言文件包含唯一待替换片段后替换，避免夹具补丁打错位置。
async function patchFile(file, from, to) {
  const text = await readFile(file, 'utf8')
  assert.ok(text.includes(from), `${path.basename(file)} 应包含待替换片段：${from.slice(0, 40)}`)
  assert.equal(text.indexOf(from), text.lastIndexOf(from), `${path.basename(file)} 中待替换片段必须唯一`)
  await writeFile(file, text.replace(from, to))
}

async function writeExemptions(project, exemptions) {
  await mkdir(path.join(project, 'reports'), { recursive: true })
  await writeFile(
    path.join(project, 'reports', 'exemptions.json'),
    JSON.stringify({ exemptions }, null, 2),
    'utf8'
  )
}

// ---------------------------------------------------------------------------
// 2. 断言辅助：rule + severity 双断言 / report 形状与计数自洽
// ---------------------------------------------------------------------------
function findingsOf(reportOrFindings) {
  return Array.isArray(reportOrFindings) ? reportOrFindings : reportOrFindings.findings
}

function rulesOf(reportOrFindings) {
  const findings = findingsOf(reportOrFindings)
  const ids = [...new Set(findings.map((finding) => finding.rule))].sort()
  return ids.length > 0 ? ids.join(', ') : '(无)'
}

function sumSeverityCounts(counts) {
  return SEVERITIES.reduce((acc, severity) => acc + (counts[severity] ?? 0), 0)
}

// 主断言：命中指定 rule，并且 severity / dimension 与 PRD §5.4 冻结表一致。
// 命中成功才把 id 记入 COVERED（NF-23 要求由真实命中断言累积）。
function expectRule(reportOrFindings, id) {
  const meta = RULES_BY_ID.get(id)
  assert.ok(meta, `测试引用了未定义规则 ${id}`)
  const findings = findingsOf(reportOrFindings)
  const found = findings.filter((finding) => finding.rule === id)
  assert.ok(found.length > 0, `应命中 ${id}（实际命中：${rulesOf(reportOrFindings)}）`)
  const finding = found[0]
  assert.equal(finding.rule, id, `命中规则应为 ${id}`)
  assert.equal(finding.severity, meta.severity, `${id} 的 severity 应为 ${meta.severity}（实际 ${finding.severity}）`)
  assert.equal(finding.dimension, meta.dimension, `${id} 的 dimension 应为 ${meta.dimension}`)
  assert.ok(typeof finding.message === 'string' && finding.message.length > 0, `${id} 必须有非空 message`)
  COVERED.add(id)
  return finding
}

function expectNoRule(reportOrFindings, id) {
  const hits = findingsOf(reportOrFindings).filter((finding) => finding.rule === id)
  assert.deepEqual(hits, [], `不应命中 ${id}（实际命中 ${hits.length} 条）`)
}

// 报告形状与计数口径（PRD §5.2）：findings 不含豁免项、逐级别计数一致、dismissed 同步。
function assertReportShape(report) {
  assert.ok(report && typeof report === 'object', 'report 必须是对象')
  for (const key of [
    'ok',
    'schemaVersion',
    'engineVersion',
    'project',
    'title',
    'scope',
    'verdict',
    'strict',
    'counts',
    'findings',
    'dismissed',
    'stats',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(report, key), `report 缺顶层键 ${key}`)
  }
  assert.equal(report.schemaVersion, SCHEMA_VERSION)
  assert.equal(report.engineVersion, VERSION)
  assert.ok(['PASS', 'FAIL'].includes(report.verdict), `verdict 非法：${report.verdict}`)
  assert.ok(typeof report.strict === 'boolean')
  assert.ok(Array.isArray(report.findings))
  assert.ok(Array.isArray(report.dismissed))
  for (const severity of SEVERITIES) {
    assert.equal(typeof report.counts[severity], 'number', `counts.${severity} 必须是数字`)
  }
  assert.equal(report.counts.dismissed, report.dismissed.length, 'counts.dismissed 必须等于 dismissed.length')
  assert.equal(
    report.findings.length,
    sumSeverityCounts(report.counts),
    'findings.length 必须等于 Σ(BLOCKER,MAJOR,MINOR,NIT,INFO)'
  )
  for (const severity of SEVERITIES) {
    assert.equal(
      report.counts[severity],
      report.findings.filter((finding) => finding.severity === severity).length,
      `counts.${severity} 与 findings 中同级别条数不一致`
    )
  }
}

// 逐条 finding 的元数据一致性（规则必须来自 RULES；severity/dimension/fixRoute 与冻结表一致）。
function assertFindingMetadata(reportOrFindings) {
  for (const finding of findingsOf(reportOrFindings)) {
    const meta = RULES_BY_ID.get(finding.rule)
    assert.ok(meta, `finding 的 rule 必须在 RULES 中：${finding.rule}`)
    assert.equal(finding.severity, meta.severity, `${finding.rule} finding severity 与冻结表不一致`)
    assert.equal(finding.dimension, meta.dimension, `${finding.rule} finding dimension 与冻结表不一致`)
    assert.equal(finding.fixRoute, meta.fixRoute, `${finding.rule} finding fixRoute 与冻结表不一致`)
    assert.ok(typeof finding.message === 'string' && finding.message.length > 0, `${finding.rule} 必须有 message`)
    assert.ok(SEVERITIES.includes(finding.severity), `severity 必须是全称 5 值：${finding.severity}`)
  }
}

function assertReportConsistency(report) {
  assertReportShape(report)
  assertFindingMetadata(report)
}

function cjkCount(text) {
  return (text.match(/[\u3400-\u9fff]/g) || []).length
}

// PRD §5.3 评分公式重算（score 四舍五入取整，clamp 0-100）。
function scoreFromFields(voice, minCV) {
  const rhythmDeduction =
    voice.rhythmCV === null ? 0 : voice.rhythmCV < minCV ? 10 : voice.rhythmCV < minCV + 0.1 ? 5 : 0
  const raw =
    100 -
    Math.min(45, voice.weightedHitsPer1000 * 12) -
    Math.min(15, voice.templateHits * 3) -
    rhythmDeduction -
    Math.min(10, voice.emotionPer1000 * 4) -
    Math.min(10, voice.translationese * 3) -
    Math.min(10, voice.summaryEndings * 2)
  return Math.max(0, Math.min(100, Math.round(raw)))
}

// ---------------------------------------------------------------------------
// 3. 内联正文样例（NF-13/NF-14；三组均 ≥500 中文字；人类负控两种不同文体）
// ---------------------------------------------------------------------------
const AI_PROSE = `林烬推开那扇门的时候，嘴角勾起一抹冷笑。屋里的空气仿佛凝固了，他的瞳孔骤缩。徐岸跟在他身后，眼底闪过一丝慌乱。林烬突然停下脚步，缓缓转过身，意味深长地看了他一眼。不是害怕，而是审视。他深吸一口气，淡淡开口，声音里带着说不清道不明的意味。

徐岸似乎意识到什么，微微后退了半步，心中一沉。与此同时，窗外的雨声忽然大了。就在这时，林烬伸手拂过桌面，指尖沾起一层薄灰。他若有所思地望着窗外，仿佛整个世界只剩下这一场雨。这一刻，他终于明白父亲当年为何离开。

是的，有些真相不需要说破。他忍不住想笑，胸口却涌起一阵痛苦与绝望。换句话说，他早就输得一败涂地。徐岸的恐惧写在脸上，那种无助让他感到一阵愤怒。总而言之，这一夜注定无人能够安睡。他轻轻合上门，仿佛合上了一个时代。

雨还在下。他站在檐下，看着院子里的水洼，心想这一切究竟是谁的安排。空气里有一股潮湿的霉味，墙角的青苔爬得很高。他忽然想起父亲离家那天的背影，心里空了一块。某种说不清的东西堵在喉咙里，他用力咽下去。

他慢慢收拢思绪，眼底闪过一丝算计。徐岸站在门边，似乎还想说什么，终究没有开口。空气仿佛凝固了，只剩下一片雨声。他缓缓抬起头，深吸一口气，把话说得很轻，却意味深长。这一刻，他明白了那种说不清道不明的失望。

他知道自己不能停下。为了父亲，也为了那个雨夜里消失的答案。是的，他必须走下去。哪怕前面是深渊，哪怕没有人理解。此时此刻，他感到一种从未有过的坚定。他抬起头，看着灰白的天空，嘴角再次勾起一丝弧度。`

const REWRITTEN_PROSE = `林烬推门进去。屋里的东西没有动过，桌面上落了一层灰。徐岸跟在他后面，脚步很轻，停在门框边上。林烬回过身，看了他一眼，没有开口。

窗外的雨下得正密，水从屋檐垂下来，落到院子里的水洼上。林烬伸手在桌面上抹了一下，指腹沾了灰。他把怀表从衣袋里取出来，放在桌上，表盖朝上。

「你父亲的事，」徐岸说，「我劝你别查了。」

林烬盯着怀表，等他把话说完。表盖内侧贴着一张小纸条，边角已经卷起。他把纸条揭下来，摊在掌心。上面只有六个字：别相信任何人。

两个人谁都没有再说话。雨声把屋子填满，灶上的水壶凉着，门板被风吹得响了一下。林烬把纸条折好，放进衣袋，又把表收起来。

「明天我去码头。」他说。徐岸没有回答，只把伞往门边挪了挪。林烬跨过门槛，走进雨里，身后的门慢慢合上。

他在巷子里走了一段，回头看时，徐岸还站在门口。雨把两个人的身影都压得很低。巷口有一家修表铺，卷帘门拉着，门缝里透出一线灯光。他停了两步，又继续往前走。

路面积了水，路过一辆自行车时，水花溅到裤脚上。他把伞压低，绕过一辆停着的板车。前面是桥，桥下的水比昨天涨了一截，浮着几片菜叶。他站在桥头，看了一会儿水，才走下桥去。

桥那头是条老街，铺子大多关着门。他沿着屋檐走，鞋底踩过一块松动的石板，溅起一点水。走到街尾，他停在第一盏路灯下，把纸条又看了一遍。别相信任何人。他把纸条收好，继续往前。雨小了些，路灯的光落在水面上，碎成一片一片。`

// 人类负控 A：沈从文式抒情（土白、水气、缓慢）
const HUMAN_LYRIC = `沅水到了辰州便宽起来。水色发青，流得慢，几乎看不出在动。渡船泊在岸边，船头被水推得一晃一晃。撑船的老人坐在石阶上抽旱烟，火一点一点明灭，烟灰落在青布裤腿上。

上游下来了三只白船，船上载着桐油和盐。船工们赤着脚，把篙子插入水中，竹篙弯成一张弓。他们的号子从水面上传过来，声音低，拖得长，和水声混在一处。

岸边有一个卖米豆腐的小摊，摊前摆两张矮凳。妇人把米豆腐切成小方块，舀一勺酸汤，撒上几粒葱花。赶集的人坐下吃完，摸出两个铜板放在桌上，又起身走了。

太阳偏西的时候，渡口安静下来。老人把船系好，卷起裤脚涉水到石阶上。他抬头看了看天色，又低头把烟袋里的灰磕掉。远处有人在喊孩子回家吃饭，声音顺着江面飘过来。

水面上起了薄雾。几只白鹭落在浅滩上，一动不动，像几块被水冲白的石头。老人提起鱼篓，沿着石阶往上走。走到坡顶，他回头看了一眼江面。江水还是那样流着，不紧不慢，看不出悲喜。

暮色从对岸漫过来，先上屋顶，再上树梢。远处的山一层一层地淡下去。渡口的旗子在风里翻了一下，又垂下来。有人在江边洗菜，水声清脆，菜叶顺流漂走。老人没有再回头，慢慢走远了。

渡口的历史没有人说得清。老人只记得他父亲也在这里撑船，一根竹篙从春撑到冬。船底漏了，就用桐油石灰补一补，补了再用。坡上的青石板被脚底板磨得发亮，雨天里能照见人影。来过渡的人有挑担的、赶集的、走亲戚的，也有不声不响坐了半晌又走的。老人都不问，只把船撑稳，让他们在对岸下船。`

// 人类负控 B：老舍式白描（市井、算账、口语节奏）
const HUMAN_PLAIN = `六月的北平，太阳一出来就把院里的地晒得发烫。王掌柜把门板一块一块卸下来，靠在墙根。门板上的漆裂了缝，缝里嵌着黑泥。他用抹布擦了两把，擦不干净，就由它去。

街面上有人挑着担子卖酸梅汤，玻璃罐子上蒙着一层水汽。孩子们蹲在墙阴里拍洋画，拍一下，喊一声。远处传来电车的铃铛，叮叮当当，由远到近，又由近到远。

王掌柜坐在柜台上算账。算盘珠子噼里啪啦响，响了半个钟头，他把账本合上，叹了口气。伙计端来一碗面，他吃了两口，放下筷子，走到门口看天。天很蓝，一丝云也没有。

下午来了两个主顾，买了半斤茶叶，又挑了半天，说下次再来。王掌柜把茶叶用纸包好，绳子系成十字，打了个活结。主顾走了，他把柜台擦干净，把算盘放回抽屉里。

日头落了，街上的热气散了一半。王掌柜把门板一块一块安回去，插好门闩。屋里暗下来，他点上油灯，灯芯烧得噼啪响。他坐在灯下，把白天没算完的账翻出来，一页一页往下看。

院子里的槐树叶子被风翻过来，露出灰白的背面。邻居家的收音机响了一阵，又停了。王掌柜算完最后一笔，把灯吹灭，摸黑走到里屋。床板响了一声，整条街都安静下来。

第二天一早，天还没亮透，街口就有推水车的过来。木轮子碾过石板，吱呀吱呀地响。王掌柜起来开门，先把昨天的账本翻到最后一页，看了看，又合上。院里那口缸的水见了底，他打算下午去挑两趟。

天擦黑的时候，街坊四邻都把饭桌搬到门口。王掌柜端一碗面条蹲在台阶上吃，吃完把碗往水盆里一放，又回到柜台后头。这时候的街面最安静，偶尔有一辆洋车跑过去，车灯一晃就没了。`

// 模板句密集样例（VOICE-003：templateHits > maxTemplateHits）
const TEMPLATE_PROSE = `不是她不想说，而是她不能说。这不仅是一次失误，而且是一次背叛。与此同时，楼下的门开了。这一刻，她明白了一切。就在这时，电话响了。换句话说，她没有退路。总而言之，事情已经无法挽回。值得一提的是，那天下了雨。`

// 元信息泄漏样例（VOICE-001）
const META_PROSE = `林烬推开门，屋里没有人。

[说明] 此处应补一段雨声。

他站在门边，看见桌上的怀表。（注：怀表的来历待定）`

// 均匀句长样例（VOICE-004/005：句长 CV = 0、段长 CV = 0）
const UNIFORM_PARAGRAPH = '他把窗户关上了。'.repeat(20)
const UNIFORM_RHYTHM = Array.from({ length: 8 }, () => UNIFORM_PARAGRAPH).join('\n\n')

function textAsChapter(body) {
  return `---\nchapter: 1\ntitle: 体检\npov: lin-jin\nday: 1\n---\n${body}`
}

// ---------------------------------------------------------------------------
// 4. NF-03 规则目录契约（62 条 + 元数据 + 非空洞自测）
// ---------------------------------------------------------------------------
test('NF-03 RULES：恰 62 条、id 唯一且匹配 ^[A-Z]+-\\d{3}$、精确集合等于 PRD §5.4', () => {
  assert.ok(Array.isArray(RULES), 'RULES 必须是数组')
  assert.equal(RULES.length, 62, 'RULES 必须恰 62 条')
  const ids = RULES.map((rule) => rule.id)
  assert.equal(new Set(ids).size, ids.length, 'RULES.id 必须唯一')
  for (const id of ids) assert.match(id, /^[A-Z]+-\d{3}$/, `规则 id 格式非法：${id}`)
  assert.deepEqual([...ids].sort(), [...ALL_RULE_IDS].sort(), 'RULES id 集合必须精确等于 PRD §5.4 规则目录')
  // 非空洞自测：删一条后同一等值断言必须失败（不得退化为"子集/包含"这类恒真关系）
  const missingOne = [...ids].sort().slice(1)
  assert.throws(
    () => assert.deepEqual(missingOne, [...ALL_RULE_IDS].sort(), '删一条则集合等值断言必失败'),
    /删一条则集合等值断言必失败/,
    '集合等值断言必须能捕获缺项（非空洞自测）'
  )
})

test('NF-03 RULES 元数据：severity 全称 5 值、dimension/fixRoute 合法且逐条符合 §5.4', () => {
  for (const rule of RULES) {
    assert.equal(typeof rule.title, 'string', `${rule.id} 必须有 title`)
    assert.ok(rule.title.length > 0, `${rule.id} 的 title 不得为空`)
    assert.ok(SEVERITIES.includes(rule.severity), `${rule.id} severity 必须是全称 5 值：${rule.severity}`)
    assert.ok(DIMENSIONS.has(rule.dimension), `${rule.id} dimension 非法：${rule.dimension}`)
    assert.ok(FIX_ROUTES.has(rule.fixRoute), `${rule.id} fixRoute 非法：${rule.fixRoute}`)
    const frozen = RULES_BY_ID.get(rule.id)
    assert.ok(frozen, `${rule.id} 不在 PRD §5.4 冻结目录`)
    assert.deepEqual(
      { dimension: rule.dimension, severity: rule.severity, fixRoute: rule.fixRoute },
      { dimension: frozen.dimension, severity: frozen.severity, fixRoute: frozen.fixRoute },
      `${rule.id} 元数据与 PRD §5.4 不一致`
    )
  }
})

// ---------------------------------------------------------------------------
// 5. NF-04 YAML-lite 解析契约（正例 ≥12 / 反例 ≥5）
// ---------------------------------------------------------------------------
const YAML_POSITIVE = `---
chapter: 1
title: 桥东的雨
pov: lin-jin

day: 1
mentions: [chen-mo, xu-an]
tags: []
inline: {mode: third-limited, tense: "past"}
flag: true
none: null
count: 3
clock: "21:40"
中文键: 中文值
# 整行注释
scenes:
  - id: ch1-s1
    place: qiao-dong
    cast: [lin-jin, xu-an]
    clock: "21:40"
    minutes: 20
    light: night
    actions:
      - {who: lin-jin, kind: search, intensity: 1}
  - who: xu-an
    kind: talk
---
正文第一段。`

test('NF-04 YAML-lite 正例 ≥12：标量/引号内冒号/行内数组/空数组/行内对象/嵌套 list-of-map/布尔/null/中文/注释/空行', () => {
  const result = lintChapterText(YAML_POSITIVE)
  expectNoRule(result.findings, 'DOC-005')
  const fm = result.frontmatter
  assert.ok(fm && typeof fm === 'object', 'frontmatter 必须是对象')
  assert.equal(fm.chapter, 1)
  assert.equal(fm.title, '桥东的雨')
  assert.equal(fm.pov, 'lin-jin')
  assert.equal(fm.day, 1)
  assert.deepEqual(fm.mentions, ['chen-mo', 'xu-an'], '行内数组应解析为字符串数组')
  assert.deepEqual(fm.tags, [], '空行内数组应解析为 []')
  assert.deepEqual(fm.inline, { mode: 'third-limited', tense: 'past' }, '行内对象应解析为 map')
  assert.equal(fm.flag, true, '布尔 true')
  assert.equal(fm.none, null, 'null 值')
  assert.equal(fm.count, 3, '整数标量')
  assert.equal(fm.clock, '21:40', '引号内冒号必须完整保留')
  assert.equal(fm['中文键'], '中文值', '中文键值')
  assert.ok(Array.isArray(fm.scenes), 'scenes 应为数组')
  assert.equal(fm.scenes.length, 2)
  assert.equal(fm.scenes[0].id, 'ch1-s1')
  assert.equal(fm.scenes[0].place, 'qiao-dong')
  assert.deepEqual(fm.scenes[0].cast, ['lin-jin', 'xu-an'])
  assert.equal(fm.scenes[0].minutes, 20)
  assert.equal(fm.scenes[0].clock, '21:40')
  assert.deepEqual(fm.scenes[0].actions, [{ who: 'lin-jin', kind: 'search', intensity: 1 }], '行内对象列表项')
  assert.equal(fm.scenes[1].who, 'xu-an', '- key: value 开头的 map 列表项')
  assert.equal(fm.scenes[1].kind, 'talk', '后续缩进行补键')
})

test('NF-04 YAML-lite CRLF：行尾归一化（\\r\\n → \\n）后同文档可解析', () => {
  const crlfText = YAML_POSITIVE.replace(/\n/g, '\r\n')
  const result = lintChapterText(crlfText)
  expectNoRule(result.findings, 'DOC-005')
  assert.equal(result.frontmatter.chapter, 1)
  assert.equal(result.frontmatter.clock, '21:40')
})

const YAML_BAD_CASES = [
  ['tab 缩进', '---\nchapter: 1\nscenes:\n\t- id: ch1-s1\n---\n正文'],
  ['块标量 |', '---\nchapter: 1\ntitle: |\n  多行标题\n---\n正文'],
  ['锚点 &', '---\nchapter: 1\ntitle: &anchor 标题\n---\n正文'],
  ['缺结束 ---', '---\nchapter: 1\ntitle: 桥东的雨\n正文没有结束分隔符'],
  ['嵌套深度 >6', '---\na:\n  b:\n    c:\n      d:\n        e:\n          f:\n            g: 1\n---\n正文'],
]

test('NF-04 YAML-lite 反例 ≥5：产出 DOC-005 BLOCKER 且不抛异常', () => {
  for (const [name, badText] of YAML_BAD_CASES) {
    let result
    assert.doesNotThrow(() => {
      result = lintChapterText(badText)
    }, `${name} 不得抛异常`)
    expectRule(result.findings, 'DOC-005')
  }
})

// ---------------------------------------------------------------------------
// 6. NF-01 / NF-02 / NF-21 脚手架与 init 丢稿回归
// ---------------------------------------------------------------------------
test('NF-01 scaffoldProject：产出 PRD §3 全部路径，schema/created/skipped 契约', async () => {
  await withTmp(async (dir) => {
    const target = path.join(dir, 'novel-demo')
    const result = await scaffoldProject(target, { title: '雨停之前' })
    assert.equal(result.ok, true, 'scaffoldProject 应成功')
    const required = [
      'project.json',
      'bible/world.md',
      'bible/characters.jsonl',
      'bible/space.json',
      'bible/facts.jsonl',
      'bible/hooks.jsonl',
      'outline/outline.json',
      'summaries.md',
      'style/style.md',
    ]
    const files = new Set(await listFiles(target))
    for (const rel of required) assert.ok(files.has(rel), `脚手架缺文件：${rel}`)
    const projectJson = JSON.parse(await readFile(path.join(target, 'project.json'), 'utf8'))
    assert.equal(projectJson.schema, SCHEMA_VERSION, 'project.json.schema 必须是 SCHEMA_VERSION')
    assert.equal(projectJson.title, '雨停之前')
    const created = relSetOf(target, result.created)
    for (const rel of required) {
      assert.ok(created.has(rel), `created[] 应覆盖：${rel}（实际：${[...created].join(', ')}）`)
    }
    assert.deepEqual(result.skipped, [], '空目录首次 init 不应有 skipped')
  })
})

test('NF-02 init：空目录退出码 0；缺 --title / 未知命令 → 2', async () => {
  await withTmp(async (dir) => {
    const target = path.join(dir, 'novel-a')
    const ok = await cli(['init', target, '--title', '雨停之前'])
    assert.equal(ok.code, 0, '空目录 init 应成功退出 0')
    assert.ok((await listFiles(target)).includes('project.json'))
    const missingTitle = await cli(['init', path.join(dir, 'novel-b')])
    assert.equal(missingTitle.code, 2, '缺 --title 必须退出 2')
    const unknown = await cli(['frobnicate'])
    assert.equal(unknown.code, 2, '未知命令必须退出 2')
  })
})

test('NF-02 非空目录无 --force → 退出码 2 且零写入（内容快照不变）', async () => {
  await withTmp(async (dir) => {
    const occupied = path.join(dir, 'occupied')
    await mkdir(occupied, { recursive: true })
    await writeFile(path.join(occupied, 'keep.txt'), '不许动', 'utf8')
    const beforeFiles = await listFiles(occupied)
    const beforeText = await readFile(path.join(occupied, 'keep.txt'), 'utf8')
    const result = await cli(['init', occupied, '--title', '雨停之前'])
    assert.equal(result.code, 2, '非空目录无 --force 必须退出 2')
    assert.deepEqual(await listFiles(occupied), beforeFiles, '拒绝时不得写入任何文件')
    assert.equal(await readFile(path.join(occupied, 'keep.txt'), 'utf8'), beforeText)
  })
})

test('NF-21 AC-2b 丢稿回归：init --force 不覆盖正文/fact/hook，created 只补缺、skipped 列出已存在', async () => {
  await withFixture('clean-mini', async (project) => {
    const chapter = path.join(project, 'chapters', 'ch-001.md')
    const facts = path.join(project, 'bible', 'facts.jsonl')
    const hooks = path.join(project, 'bible', 'hooks.jsonl')
    await appendFile(chapter, '\n作者新写的一段正文，绝不能被覆盖。\n')
    await appendFile(facts, '{"id":"f-new","statement":"新登记的事实","public":false,"truth":true,"revealAt":null}\n')
    await appendFile(hooks, '{"id":"h-new","question":"新埋的伏笔","plant":1,"pay":null,"status":"OPEN","staleAfter":null,"notes":""}\n')
    const watched = {
      'chapters/ch-001.md': chapter,
      'bible/facts.jsonl': facts,
      'bible/hooks.jsonl': hooks,
    }
    const before = {}
    for (const [rel, file] of Object.entries(watched)) before[rel] = await readFile(file, 'utf8')
    const result = await scaffoldProject(project, { title: '最小的雨', force: true })
    assert.equal(result.ok, true, 'init --force 应成功')
    for (const [rel, file] of Object.entries(watched)) {
      assert.equal(await readFile(file, 'utf8'), before[rel], `${rel} 必须字节不变`)
    }
    const created = relSetOf(project, result.created)
    const skipped = relSetOf(project, result.skipped)
    for (const rel of Object.keys(watched)) {
      assert.ok(!created.has(rel), `${rel} 不得出现在 created[]（只补缺项）`)
    }
    // AC-2b 字面语义：skipped[] 列出目录内全部已存在文件（含非脚手架文件 chapters/ch-001.md）。
    // 2026-10-29 口径归一：引擎冻结版已对齐该语义（lint-engineer 确认），此前因引擎差异放宽的断言恢复严格。
    for (const rel of ['chapters/ch-001.md', 'bible/facts.jsonl', 'bible/hooks.jsonl']) {
      assert.ok(skipped.has(rel), `${rel} 应出现在 skipped[]（已存在项）`)
    }
  })
})

// ---------------------------------------------------------------------------
// 7. NF-05 干净夹具 + NF-16 报告契约
// ---------------------------------------------------------------------------
test('NF-05 clean 夹具：verdict=PASS、BLOCKER=MAJOR=0、计数等式自洽、CLI 退出码 0', async () => {
  await withFixture('clean', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    assert.equal(report.verdict, 'PASS')
    assert.equal(report.counts.BLOCKER, 0, 'clean 夹具不得有 BLOCKER')
    assert.equal(report.counts.MAJOR, 0, 'clean 夹具不得有 MAJOR')
    assert.equal(report.findings.length, sumSeverityCounts(report.counts))
    assert.equal(report.dismissed.length, report.counts.dismissed, 'clean 夹具无豁免 → dismissed 应为 0')
    assert.equal(report.title, '雨停之前')
    // 非空洞自测：计数与发现数等式必须能失败
    assert.throws(
      () => assert.equal(report.findings.length, sumSeverityCounts(report.counts) + 1, '计数等式必须非空洞'),
      /计数等式必须非空洞/
    )
    const res = await cli(['lint', project, '--json'])
    assert.equal(res.code, 0, 'clean 夹具 CLI 退出码应为 0')
  })
})

test('NF-05 clean-mini 夹具：最小可过项目 PASS', async () => {
  await withFixture('clean-mini', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    assert.equal(report.verdict, 'PASS')
    assert.equal(report.counts.BLOCKER, 0)
    assert.equal(report.counts.MAJOR, 0)
  })
})

test('NF-16 lint --json：含 PRD §5.2 全部顶层键与 stats.aiVoice.weightedHitsPer1000', async () => {
  await withFixture('clean', async (project) => {
    const res = await cli(['lint', project, '--json'])
    assert.equal(res.code, 0)
    let report
    assert.doesNotThrow(() => {
      report = JSON.parse(res.out)
    }, '--json stdout 必须是单个合法 JSON 对象')
    assertReportConsistency(report)
    const stats = report.stats
    for (const key of ['chapters', 'words', 'perChapter', 'timeline', 'hooks', 'characters', 'aiVoice']) {
      assert.ok(key in stats, `stats 缺键 ${key}`)
    }
    assert.equal(typeof stats.aiVoice.weightedHitsPer1000, 'number', 'stats.aiVoice.weightedHitsPer1000 必须是数字')
    for (const key of ['score', 'hitsPer1000', 'rhythmCV', 'tagRatio']) {
      assert.ok(key in stats.aiVoice, `stats.aiVoice 缺键 ${key}`)
    }
    assert.equal(stats.chapters, 2)
    assert.ok(stats.words > 0, 'stats.words 必须 > 0')
    assert.ok(Array.isArray(stats.perChapter) && stats.perChapter.length === 2, 'stats.perChapter 应为 2 章')
    assert.equal(typeof stats.timeline.day, 'number')
  })
})

test('NF-16 lint 默认写 reports/last.json + reports/last.md（冻结骨架 + 豁免 N/M 计数）', async () => {
  await withFixture('clean', async (project) => {
    const res = await cli(['lint', project])
    assert.equal(res.code, 0)
    const mdPath = path.join(project, 'reports', 'last.md')
    const md = await readFile(mdPath, 'utf8')
    for (const skeleton of ['# 小说门禁报告', '## 统计', '## 发现', '## 豁免', '## 下一步']) {
      assert.ok(md.includes(skeleton), `reports/last.md 缺骨架：${skeleton}`)
    }
    assert.match(md, /本次豁免 \d+ 条，跳过 \d+ 条/, '## 豁免 段首行必须是「本次豁免 N 条，跳过 M 条」')
    for (const skeleton of ['# 小说门禁报告', '## 统计', '## 发现', '## 豁免']) {
      assert.ok(res.out.includes(skeleton), `stdout markdown 缺骨架：${skeleton}`)
    }
    const lastJson = JSON.parse(await readFile(path.join(project, 'reports', 'last.json'), 'utf8'))
    assert.equal(lastJson.verdict, 'PASS')
    // --report 额外写副本
    const copyPath = path.join(project, '..', 'custom-report.json')
    const res2 = await cli(['lint', project, '--report', copyPath, '--json'])
    assert.equal(res2.code, 0)
    const copy = JSON.parse(await readFile(copyPath, 'utf8'))
    assert.equal(copy.verdict, 'PASS')
    assert.equal(copy.counts.BLOCKER, 0)
  })
})

test('NF-16 renderReport 冻结骨架与豁免计数行', async () => {
  await withFixture('clean', async (project) => {
    const report = await lintProject(project)
    const md = renderReport(report)
    assert.equal(typeof md, 'string', 'renderReport 应返回 markdown 字符串')
    for (const skeleton of ['# 小说门禁报告', '## 统计', '## 发现', '## 豁免', '## 下一步']) {
      assert.ok(md.includes(skeleton), `renderReport 缺骨架：${skeleton}`)
    }
    assert.match(md, /本次豁免 \d+ 条，跳过 \d+ 条/)
  })
})

// ---------------------------------------------------------------------------
// 8. NF-06…NF-12 六维规则（故障夹具逐维命中 + 对照不误报）
// ---------------------------------------------------------------------------
test('NF-06 空间维 broken-space：SPACE-001/002/003/005（+004 同角色同窗口两地）', async () => {
  await withFixture('broken-space', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    for (const id of ['SPACE-001', 'SPACE-002', 'SPACE-003', 'SPACE-004', 'SPACE-005']) expectRule(report, id)
    assert.equal(report.verdict, 'FAIL')
  })
})

test('NF-07 时间维 broken-time：TIME-001/002/003/004/007', async () => {
  await withFixture('broken-time', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    for (const id of ['TIME-001', 'TIME-002', 'TIME-003', 'TIME-004', 'TIME-007']) expectRule(report, id)
    assert.equal(report.verdict, 'FAIL')
  })
})

test('NF-07 flashback 对照：标 flashback=true 后 TIME-001/002/007 不命中', async () => {
  await withFixture('broken-time', async (project) => {
    const ch1 = path.join(project, 'chapters', 'ch-001.md')
    const ch2 = path.join(project, 'chapters', 'ch-002.md')
    await patchFile(ch1, 'clock: "09:00"', 'clock: "09:00"\n    flashback: true')
    await patchFile(ch2, 'clock: "08:00"', 'clock: "08:00"\n    flashback: true')
    const report = await lintProject(project)
    assertReportConsistency(report)
    for (const id of ['TIME-001', 'TIME-002', 'TIME-007']) expectNoRule(report, id)
    // 非空洞：同一报告仍有其它时间维发现，证明确实跑过时间维
    expectRule(report, 'TIME-003')
    expectRule(report, 'TIME-004')
  })
})

test('NF-07 TIME-005/TIME-006：年龄矛盾与章节级 day 不一致', async () => {
  await withFixture('clean-mini', async (project) => {
    const charsPath = path.join(project, 'bible', 'characters.jsonl')
    const card = JSON.parse((await readFile(charsPath, 'utf8')).trim().split('\n')[0])
    card.age = 20 // storyYear 2026 - birthYear 1991 = 35，差 15 > 容差 1
    await writeFile(charsPath, JSON.stringify(card) + '\n')
    await patchFile(path.join(project, 'chapters', 'ch-001.md'), 'day: 1\nscenes:', 'day: 9\nscenes:')
    const report = await lintProject(project)
    assertReportConsistency(report)
    assert.equal(expectRule(report, 'TIME-005').severity, 'MAJOR')
    assert.equal(expectRule(report, 'TIME-006').severity, 'MINOR')
  })
})

test('NF-08 物理维 broken-physics：PHYS-001/002/003/005（+004/006/007）', async () => {
  await withFixture('broken-physics', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    for (const id of ['PHYS-001', 'PHYS-002', 'PHYS-003', 'PHYS-004', 'PHYS-005', 'PHYS-006', 'PHYS-007']) {
      expectRule(report, id)
    }
  })
})

test('NF-08 PHYS-005 只统计角色卡声明的 kind：未声明 kind 的负 delta 不命中', async () => {
  await withFixture('clean-mini', async (project) => {
    // money 是角色卡声明的 kind；换成未声明的 ammo 后即使为负也不得命中 PHYS-005
    await patchFile(path.join(project, 'chapters', 'ch-001.md'), 'kind: money, delta: -20', 'kind: ammo, delta: -20')
    const report = await lintProject(project)
    expectNoRule(report, 'PHYS-005')
  })
})

test('NF-09 台词维 broken-dialogue：DLG-001/002/003 + CHAR-001', async () => {
  await withFixture('broken-dialogue', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    // FACT-003 触发形态（PRD v1.3）：knowledge 记录无 source，且该 fact 不在本场景 facts[] 中声明
    for (const id of ['DLG-001', 'DLG-002', 'DLG-003', 'CHAR-001', 'FACT-002', 'FACT-003']) expectRule(report, id)
  })
})

test('NF-09 合法知识路径不误报：clean 夹具无 DLG-001/DLG-002/DLG-003', async () => {
  await withFixture('clean', async (project) => {
    const report = await lintProject(project)
    for (const id of ['DLG-001', 'DLG-002', 'DLG-003']) expectNoRule(report, id)
  })
})

// PRD v1.3 FACT-003 正反例（AC-14）：knowledge 记录的 fact 既不在本场景 facts[] 中声明、
// 且 source 为空/缺省 → FACT-003 MAJOR；补 source 或把 fact 加入本场景 facts[] → 不命中。
test('NF-09/v1.3 FACT-003 正反例：无 source 且不在本场景 facts[] → MAJOR；补 source / 加入 facts[] → 不命中', async () => {
  await withFixture('clean-mini', async (project) => {
    const chapter = path.join(project, 'chapters', 'ch-001.md')
    const usesBlock = '    uses:\n      - {who: lin-jin, fact: f-000}\n'
    // ① 正例：knowledge 无 source，且 f-000 不在本场景 facts[]
    await patchFile(chapter, usesBlock, `${usesBlock}    knowledge:\n      - {who: lin-jin, fact: f-000}\n`)
    let report = await lintProject(project)
    assertReportConsistency(report)
    assert.equal(expectRule(report, 'FACT-003').severity, 'MAJOR', 'FACT-003 级别必须为 MAJOR')
    // ② 反例：补 source → 证据可追溯，不得命中
    await patchFile(
      chapter,
      '    knowledge:\n      - {who: lin-jin, fact: f-000}\n',
      '    knowledge:\n      - {who: lin-jin, fact: f-000, source: 亲眼所见}\n'
    )
    report = await lintProject(project)
    assertReportConsistency(report)
    expectNoRule(report, 'FACT-003')
    // ③ 反例：把 fact 加入本场景 facts[]（仍无 source）→ 证据在案，不得命中
    await patchFile(
      chapter,
      '    knowledge:\n      - {who: lin-jin, fact: f-000, source: 亲眼所见}\n',
      '    facts: [f-000]\n    knowledge:\n      - {who: lin-jin, fact: f-000}\n'
    )
    report = await lintProject(project)
    assertReportConsistency(report)
    expectNoRule(report, 'FACT-003')
    // 非空洞自测：同一条 rule 断言在空 findings 上必须红
    assert.throws(
      () => expectRule([], 'FACT-003'),
      /应命中 FACT-003/,
      'FACT-003 命中断言必须能捕获未触发情况'
    )
  })
})

test('NF-10 人物维 broken-character：CHAR-002/003/006', async () => {
  await withFixture('broken-character', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    for (const id of ['CHAR-002', 'CHAR-003', 'CHAR-006']) expectRule(report, id)
  })
})

test('NF-10 CHAR-002 flashback 对照 + CHAR-006 mentions 对照（非恒真）', async () => {
  await withFixture('broken-character', async (project) => {
    const ch1 = path.join(project, 'chapters', 'ch-001.md')
    const ch2 = path.join(project, 'chapters', 'ch-002.md')
    await patchFile(ch1, 'cast: [lin-jin, chen-mo]', 'cast: [lin-jin, chen-mo]\n    flashback: true')
    let report = await lintProject(project)
    expectNoRule(report, 'CHAR-002')
    await patchFile(ch2, 'day: 2\nscenes:', 'day: 2\nmentions: [chen-mo]\nscenes:')
    report = await lintProject(project)
    expectNoRule(report, 'CHAR-006')
    // 非空洞：CHAR-003 仍在，说明人物维确实跑过
    expectRule(report, 'CHAR-003')
  })
})

test('NF-11 因果维 broken-hook：HOOK-001/002/003/004/006 + HOOK-005 + FACT-001/004', async () => {
  await withFixture('broken-hook', async (project) => {
    const config = JSON.parse(await readFile(path.join(project, 'project.json'), 'utf8'))
    assert.ok(!('staleHookChapters' in config), 'broken-hook 必须省略 staleHookChapters 才能验证缺省值参与 HOOK-002')
    const report = await lintProject(project)
    assertReportConsistency(report)
    for (const id of ['HOOK-001', 'HOOK-002', 'HOOK-003', 'HOOK-004', 'HOOK-005', 'HOOK-006', 'FACT-001', 'FACT-004']) {
      expectRule(report, id)
    }
  })
})

test('NF-12 大纲维 broken-outline：OUT-001/002/003/004/005', async () => {
  await withFixture('broken-outline', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    for (const id of ['OUT-001', 'OUT-002', 'OUT-003', 'OUT-004', 'OUT-005']) expectRule(report, id)
  })
})

test('NF-12 文字故障 broken-words：DOC-006/007 + VOICE-001/002/011', async () => {
  await withFixture('broken-words', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    for (const id of ['DOC-006', 'DOC-007', 'VOICE-001', 'VOICE-002', 'VOICE-011']) expectRule(report, id)
  })
})

test('NF-12 结构维 broken-structure：DOC-003/004/005/006', async () => {
  await withFixture('broken-structure', async (project) => {
    const report = await lintProject(project)
    assertReportConsistency(report)
    for (const id of ['DOC-003', 'DOC-004', 'DOC-005', 'DOC-006']) expectRule(report, id)
  })
})

test('NF-12 补充规则：DOC-008 / CHAR-004 / CHAR-005', async () => {
  await withFixture('clean-mini', async (project) => {
    const summaries = path.join(project, 'summaries.md')
    const originalSummaries = await readFile(summaries, 'utf8')
    await writeFile(summaries, '# 摘要\n\n## ch-999 不存在的章\n\n空。\n')
    let report = await lintProject(project)
    assertReportConsistency(report)
    expectRule(report, 'DOC-008')
    await writeFile(summaries, originalSummaries)

    const charsPath = path.join(project, 'bible', 'characters.jsonl')
    const originalChars = await readFile(charsPath, 'utf8')
    const card = JSON.parse(originalChars.trim().split('\n')[0])
    delete card.goal
    delete card.voice
    await writeFile(charsPath, JSON.stringify(card) + '\n')
    report = await lintProject(project)
    expectRule(report, 'CHAR-004')

    const badCard = JSON.parse(originalChars.trim().split('\n')[0])
    badCard.status = 'zombie'
    await writeFile(charsPath, JSON.stringify(badCard) + '\n')
    report = await lintProject(project)
    expectRule(report, 'CHAR-005')
  })
})

test('VOICE-010 POV 越界 INFO：viewpoint.character 非空时非 POV 角色心想被标 INFO', async () => {
  await withFixture('clean', async (project) => {
    await appendFile(path.join(project, 'chapters', 'ch-002.md'), '\n\n徐岸心想，这件事不能再拖。\n')
    const report = await lintProject(project)
    assertReportConsistency(report)
    assert.equal(expectRule(report, 'VOICE-010').severity, 'INFO')
  })
})

// ---------------------------------------------------------------------------
// 9. NF-13 反 AI 腔（三组正文均 ≥500 字 + 人类负控 ×2）+ NF-14 公式自洽
// ---------------------------------------------------------------------------
test('NF-13 AI 腔样例（≥500 字）：score<60、strongHits≥3、命中 VOICE-002+011', () => {
  const chars = cjkCount(AI_PROSE)
  assert.ok(chars >= 500, `AI 腔样例正文必须 ≥500 中文字（实际 ${chars}）`)
  const voice = analyzeVoice(AI_PROSE)
  assert.ok(voice.score < 60, `AI 腔样例 score 应 <60（实际 ${voice.score}）`)
  assert.ok(voice.strongHits >= 3, `AI 腔样例 strongHits 应 ≥3（实际 ${voice.strongHits}）`)
  assert.ok(
    voice.weightedHitsPer1000 > 1.5,
    `AI 腔样例 weightedHitsPer1000 应 >1.5（PRD v1.5 默认阈值，实际 ${voice.weightedHitsPer1000}）`
  )
  const findings = lintChapterText(textAsChapter(AI_PROSE)).findings
  assertFindingMetadata(findings)
  expectRule(findings, 'VOICE-002')
  expectRule(findings, 'VOICE-011')
  // 模板句密集（不是…而是…/与此同时/就在这时/这一刻/是的，/换句话说/总而言之…）
  expectRule(findings, 'VOICE-003')
})

test('NF-13 改写后样例（≥500 字）：score≥75、strongHits=0、不命中 VOICE-002/011', () => {
  const chars = cjkCount(REWRITTEN_PROSE)
  assert.ok(chars >= 500, `改写后样例正文必须 ≥500 中文字（实际 ${chars}）`)
  const voice = analyzeVoice(REWRITTEN_PROSE)
  assert.ok(voice.score >= 75, `改写后样例 score 应 ≥75（实际 ${voice.score}）`)
  assert.equal(voice.strongHits, 0, '改写后样例 strongHits 必须为 0')
  const findings = lintChapterText(textAsChapter(REWRITTEN_PROSE)).findings
  expectNoRule(findings, 'VOICE-002')
  expectNoRule(findings, 'VOICE-011')
})

test('NF-13 人类负控 ×2（≥500 字、两种不同文体）：每段 score≥70、strongHits=0、不命中 VOICE-002/011', () => {
  const controls = [
    ['沈从文式抒情', HUMAN_LYRIC],
    ['老舍式白描', HUMAN_PLAIN],
  ]
  for (const [label, text] of controls) {
    const chars = cjkCount(text)
    assert.ok(chars >= 500, `${label} 负控正文必须 ≥500 中文字（实际 ${chars}）`)
    const voice = analyzeVoice(text)
    assert.ok(voice.score >= 70, `${label} 负控 score 应 ≥70（实际 ${voice.score}）`)
    assert.equal(voice.strongHits, 0, `${label} 负控 strongHits 必须为 0（实际 ${voice.strongHits}）`)
    const findings = lintChapterText(textAsChapter(text)).findings
    expectNoRule(findings, 'VOICE-002')
    expectNoRule(findings, 'VOICE-011')
  }
})

test('NF-13 元信息样例：VOICE-001 命中且级别 BLOCKER', () => {
  const findings = lintChapterText(textAsChapter(META_PROSE)).findings
  assert.equal(expectRule(findings, 'VOICE-001').severity, 'BLOCKER')
})

test('NF-13 节奏规则：均匀句长命中 VOICE-004(MINOR) 与 VOICE-005(NIT)', () => {
  const voice = analyzeVoice(UNIFORM_RHYTHM)
  assert.ok(voice.rhythmCV !== null && voice.rhythmCV < 0.35, `均匀句长 rhythmCV 应 <0.35（实际 ${voice.rhythmCV}）`)
  assert.ok(voice.paragraphCV !== null && voice.paragraphCV < 0.3, `均匀段长 paragraphCV 应 <0.30（实际 ${voice.paragraphCV}）`)
  const findings = lintChapterText(textAsChapter(UNIFORM_RHYTHM)).findings
  assert.equal(expectRule(findings, 'VOICE-004').severity, 'MINOR')
  assert.equal(expectRule(findings, 'VOICE-005').severity, 'NIT')
})

test('NF-13 模板规则：模板句密集命中 VOICE-003(MINOR)', () => {
  const voice = analyzeVoice(TEMPLATE_PROSE)
  assert.ok(voice.templateHits > 3, `模板样例 templateHits 应 >3（实际 ${voice.templateHits}）`)
  const findings = lintChapterText(textAsChapter(TEMPLATE_PROSE)).findings
  assert.equal(expectRule(findings, 'VOICE-003').severity, 'MINOR')
})

// VOICE-006/007/008/009 靶向样例：词表/正则已在 references/anti-ai-voice.md §2 冻结，
// 冻结引擎实测「每段只命中对应规则」；unit<500 → rhythmCV/paragraphCV=null（§5.3 短文本口径）。
const VOICE_EDGE_SAMPLES = [
  ['VOICE-006', '「走吧。」林烬说道。「去哪儿？」徐岸说道。「码头。」林烬说道。「现在？」徐岸说道。「对。」林烬说道。「好。」徐岸说道。「快点。」林烬说道。'],
  ['VOICE-007', '他感到愤怒。她感到悲伤。他感到恐惧。她感到激动。他感到震惊。她感到绝望。他感到痛苦。她感到兴奋。'],
  ['VOICE-008', '雨停了。一切才刚开始。\n\n他抬头看天。命运的齿轮开始转动。\n\n门开了。多年以后，他会想起这个雨夜。'],
  ['VOICE-009', '作为一个警察，他推开门。当他走进屋子的时候，灯亮着。这是最危险的人之一。'],
]

for (const [edgeRuleId, edgeBody] of VOICE_EDGE_SAMPLES) {
  test(`NF-13 边界规则 ${edgeRuleId}：靶向命中 ${edgeRuleId}(MINOR) 且不连带其它规则`, () => {
    const result = lintChapterText(textAsChapter(edgeBody))
    assertFindingMetadata(result.findings)
    // rule + severity 双断言（expectRule 内部断言 severity/dimension；未命中直接红）
    assert.equal(expectRule(result.findings, edgeRuleId).severity, 'MINOR')
    assert.deepEqual(
      result.findings.map((finding) => finding.rule),
      [edgeRuleId],
      `${edgeRuleId} 样例应只命中该规则，不得连带其它规则`
    )
    assert.equal(result.aiVoice.rhythmCV, null, '短文本 rhythmCV 必须为 null')
    assert.equal(result.aiVoice.paragraphCV, null, '短文本 paragraphCV 必须为 null')
    assert.deepEqual([...result.aiVoice.skipped].sort(), ['paragraph', 'rhythm'], '短文本 skipped 应恰为 rhythm/paragraph')
    // 非空洞自测：同一断言在空 findings 上必须红（即「若不触发则红」）
    assert.throws(
      () => expectRule([], edgeRuleId),
      new RegExp(`应命中 ${edgeRuleId}`),
      `${edgeRuleId} 的命中断言必须能捕获未触发情况`
    )
  })
}

test('NF-13/NF-15 prose CLI：AI 样例退出码 1，人类负控退出码 0 且不误报', async () => {
  await withTmp(async (dir) => {
    const aiPath = path.join(dir, 'sample-ai-prose.md')
    const humanPath = path.join(dir, 'sample-human-prose.md')
    await writeFile(aiPath, AI_PROSE)
    await writeFile(humanPath, HUMAN_LYRIC)
    const ai = await cli(['prose', aiPath, '--json'])
    assert.equal(ai.code, 1, 'prose 对 AI 腔正文应退出码 1')
    const aiJson = JSON.parse(ai.out)
    assert.ok(aiJson.aiVoice.score < 60)
    assert.ok(aiJson.findings.some((finding) => finding.rule === 'VOICE-011'))
    const human = await cli(['prose', humanPath, '--json'])
    assert.equal(human.code, 0, 'prose 对人类负控应退出码 0')
    const humanJson = JSON.parse(human.out)
    assert.ok(humanJson.aiVoice.score >= 70)
    assert.ok(!humanJson.findings.some((finding) => ['VOICE-002', 'VOICE-011'].includes(finding.rule)))
  })
})

test('NF-14 公式自洽：用返回字段按 §5.3 重算 score 必须等于返回 score（±0）', () => {
  const samples = [
    ['AI 腔', AI_PROSE],
    ['改写后', REWRITTEN_PROSE],
    ['人类负控·沈从文式', HUMAN_LYRIC],
    ['人类负控·老舍式', HUMAN_PLAIN],
    ['模板密集', TEMPLATE_PROSE],
    ['均匀句长', UNIFORM_RHYTHM],
  ]
  for (const [label, text] of samples) {
    const voice = analyzeVoice(text)
    assert.equal(voice.score, scoreFromFields(voice, 0.35), `${label} score 必须等于 §5.3 公式重算值（±0）`)
    const expectedHitsPer1000 = ((voice.strongHits + voice.weakHits + voice.forbiddenHits) / voice.unit) * 1000
    assert.ok(
      Math.abs(voice.hitsPer1000 - expectedHitsPer1000) < 0.01,
      `${label} hitsPer1000 与公式不一致（实际 ${voice.hitsPer1000} vs ${expectedHitsPer1000}）`
    )
    const expectedWeighted = voice.strongHits + voice.weakHits * 0.25 + voice.forbiddenHits
    assert.ok(
      Math.abs(voice.weightedHits - expectedWeighted) < 1e-9,
      `${label} weightedHits 与权重公式不一致（实际 ${voice.weightedHits} vs ${expectedWeighted}）`
    )
    const expectedWeightedPer1000 = (voice.weightedHits / voice.unit) * 1000
    assert.ok(
      Math.abs(voice.weightedHitsPer1000 - expectedWeightedPer1000) < 0.01,
      `${label} weightedHitsPer1000 与公式不一致`
    )
    assert.ok(Number.isInteger(voice.score) && voice.score >= 0 && voice.score <= 100, `${label} score 必须是 0-100 整数`)
  }
  // 固定样例计数下限（不依赖未冻结词表的精确命中数）
  assert.ok(analyzeVoice(AI_PROSE).strongHits >= 3, 'AI 腔固定样例 strongHits 下限应为 ≥3')
  assert.equal(analyzeVoice(HUMAN_LYRIC).strongHits, 0, '人类负控固定样例 strongHits 必须为 0')
  assert.equal(analyzeVoice(HUMAN_PLAIN).strongHits, 0, '人类负控固定样例 strongHits 必须为 0')
})

test('NF-14 短文本 unit<500：rhythmCV/paragraphCV=null、skipped 两项、节奏扣分按 0', () => {
  const voice = analyzeVoice('雨停了。他抬头看天。')
  assert.ok(voice.unit < 500, `unit 应 <500（实际 ${voice.unit}）`)
  assert.equal(voice.rhythmCV, null, '短文本 rhythmCV 必须为 null')
  assert.equal(voice.paragraphCV, null, '短文本 paragraphCV 必须为 null')
  assert.deepEqual([...voice.skipped].sort(), ['paragraph', 'rhythm'], 'skipped 必须恰含 rhythm/paragraph 两项')
  assert.equal(voice.score, scoreFromFields(voice, 0.35), '短文本节奏项扣分必须按 0 计')
})

// ---------------------------------------------------------------------------
// 10. NF-15 退出码契约
// ---------------------------------------------------------------------------
test('NF-15 退出码：clean 0 / 故障 1 / --strict 仅 MINOR 1 / prose AI 1', async () => {
  await withFixture('clean', async (project) => {
    assert.equal((await cli(['lint', project, '--json'])).code, 0, 'clean 夹具应退出 0')
  })
  await withFixture('broken-space', async (project) => {
    assert.equal((await cli(['lint', project, '--json'])).code, 1, '有 BLOCKER/MAJOR 应退出 1')
  })
  await withFixture('clean-mini', async (project) => {
    const chapter = path.join(project, 'chapters', 'ch-001.md')
    const text = await readFile(chapter, 'utf8')
    const closeIndex = text.lastIndexOf('\n---\n')
    assert.ok(closeIndex > 0, '夹具章节必须有结束 frontmatter 分隔符')
    await writeFile(chapter, `${text.slice(0, closeIndex + 5)}\n雨停了。\n`)
    const normal = await cli(['lint', project, '--json'])
    assert.equal(normal.code, 0, '仅 MINOR 时 lint 退出码应为 0')
    const strict = await cli(['lint', project, '--strict', '--json'])
    assert.equal(strict.code, 1, '--strict 下仅 MINOR 也必须退出 1')
    const strictReport = JSON.parse(strict.out)
    assert.equal(strictReport.strict, true)
    assert.ok(strictReport.counts.MINOR > 0, '该样例应由 MINOR 触发 strict 失败')
  })
  await withTmp(async (dir) => {
    const aiPath = path.join(dir, 'ai.md')
    await writeFile(aiPath, AI_PROSE)
    assert.equal((await cli(['prose', aiPath])).code, 1, 'prose 对 AI 腔文件应退出 1')
  })
})

test('NF-15 用法错误：--help/无参数/未知命令/缺 --title/目录不存在 → 2', async () => {
  assert.equal((await cli([])).code, 2, '无参数应输出用法并退出 2')
  assert.equal((await cli(['--help'])).code, 2, '--help 退出码应为 2')
  assert.equal((await cli(['-h'])).code, 2, '-h 退出码应为 2')
  assert.equal((await cli(['unknown-command'])).code, 2, '未知命令退出码应为 2')
  await withTmp(async (dir) => {
    assert.equal((await cli(['lint', path.join(dir, 'missing')])).code, 2, 'lint 项目目录不存在应退出 2')
    assert.equal((await cli(['status', path.join(dir, 'missing')])).code, 2, 'status 目录不存在应退出 2')
    assert.equal((await cli(['prose', path.join(dir, 'missing.md')])).code, 2, 'prose 文件不存在应退出 2')
    assert.equal((await cli(['init', path.join(dir, 'p')])).code, 2, 'init 缺 --title 应退出 2')
  })
  await withFixture('clean', async (project) => {
    assert.equal((await cli(['context', project])).code, 2, 'context 缺 --chapter 应退出 2')
  })
})

test('NF-15 非法 --chapter：非数字/≤0/不存在章节 → 2 + stderr 文案', async () => {
  await withFixture('clean', async (project) => {
    const notNumber = await cli(['lint', project, '--chapter', 'abc'])
    assert.equal(notNumber.code, 2, '非数字 --chapter 应退出 2')
    assert.ok(notNumber.err.includes('无效章节号'), `stderr 应含「无效章节号」：${notNumber.err}`)
    assert.equal((await cli(['lint', project, '--chapter', '0'])).code, 2, '--chapter 0 应退出 2')
    assert.equal((await cli(['lint', project, '--chapter', '-1'])).code, 2, '--chapter 负数应退出 2')
    const missing = await cli(['lint', project, '--chapter', '99'])
    assert.equal(missing.code, 2, '不存在的章节号应退出 2')
    assert.ok(missing.err.includes('章节不存在'), `stderr 应含「章节不存在」：${missing.err}`)
    const valid = await cli(['lint', project, '--chapter', '1', '--json'])
    assert.equal(valid.code, 0, '合法 --chapter 应正常判定')
  })
})

// ---------------------------------------------------------------------------
// 11. NF-17 豁免（匹配语义 / reason 必填 / strict 不可豁免）
// ---------------------------------------------------------------------------
async function injectMajorTime005(project) {
  const charsPath = path.join(project, 'bible', 'characters.jsonl')
  const card = JSON.parse((await readFile(charsPath, 'utf8')).trim().split('\n')[0])
  card.age = 20 // storyYear 2026 - birthYear 1991 = 35，差 15 > 容差 1
  await writeFile(charsPath, JSON.stringify(card) + '\n')
}

test('NF-17 豁免：命中项进 dismissed、counts 同步、verdict 翻转、报告 N/M 计数', async () => {
  await withFixture('clean-mini', async (project) => {
    await injectMajorTime005(project)
    const before = await lintProject(project)
    assertReportConsistency(before)
    assert.equal(expectRule(before, 'TIME-005').severity, 'MAJOR')
    assert.equal(before.verdict, 'FAIL')
    await writeExemptions(project, [{ rule: 'TIME-005', reason: '人物年龄为叙事性设定，作者确认' }])
    const after = await lintProject(project)
    assertReportConsistency(after)
    expectNoRule(after, 'TIME-005')
    assert.equal(after.counts.dismissed, 1)
    assert.equal(after.dismissed.length, 1)
    assert.equal(after.dismissed[0].rule, 'TIME-005')
    assert.equal(after.dismissed[0].reason, '人物年龄为叙事性设定，作者确认')
    assert.equal(after.verdict, 'PASS', '唯一 MAJOR 被豁免后 verdict 应翻转为 PASS')
    assert.equal((await cli(['lint', project, '--json'])).code, 0, '豁免后 CLI 退出码应翻转为 0')
    const md = await cli(['lint', project])
    assert.match(md.out, /本次豁免 1 条，跳过 0 条/)
  })
})

test('NF-17 缺 reason 的豁免整条无效并计入跳过', async () => {
  await withFixture('clean-mini', async (project) => {
    await injectMajorTime005(project)
    await writeExemptions(project, [{ rule: 'TIME-005' }])
    const report = await lintProject(project)
    assertReportConsistency(report)
    expectRule(report, 'TIME-005')
    assert.equal(report.dismissed.length, 0, '缺 reason 的条目不得生效')
    assert.equal(report.counts.dismissed, 0)
    assert.equal(report.stats.skippedExemptions, 1, '缺 reason 条目应计入 stats.skippedExemptions')
    const md = await cli(['lint', project])
    assert.match(md.out, /本次豁免 0 条，跳过 1 条/)
  })
})

test('NF-17 匹配语义：rule 必等 / locator 缺省或相等 / messageIncludes 子串', async () => {
  await withFixture('broken-space', async (project) => {
    const baseline = await lintProject(project)
    const targets = baseline.findings.filter((finding) => finding.rule === 'SPACE-003')
    assert.ok(targets.length >= 1, `broken-space 应命中 SPACE-003：${rulesOf(baseline)}`)
    const target = expectRule(baseline, 'SPACE-003')
    assert.ok(
      typeof target.locator === 'string' && target.locator.length > 0,
      'SPACE-003 finding 必须有 locator（PRD §5.2 冻结形状）'
    )
    // rule 必须相等（同 locator、同 message 前缀也不能生效）
    await writeExemptions(project, [{ rule: 'SPACE-002', locator: target.locator, reason: '规则不匹配' }])
    let report = await lintProject(project)
    expectRule(report, 'SPACE-003')
    assert.equal(report.dismissed.length, 0, 'rule 不等的豁免不得生效')
    // locator 缺省 → 匹配该 rule 的全部 findings
    await writeExemptions(project, [{ rule: 'SPACE-003', reason: 'locator 缺省' }])
    report = await lintProject(project)
    expectNoRule(report, 'SPACE-003')
    assert.equal(report.dismissed.length, targets.length, 'locator 缺省时应豁免该 rule 的全部命中')
    // locator 相等才匹配：只豁免同 locator 的命中
    const sameLocator = targets.filter((finding) => finding.locator === target.locator).length
    await writeExemptions(project, [{ rule: 'SPACE-003', locator: target.locator, reason: 'locator 相等' }])
    report = await lintProject(project)
    assert.equal(report.dismissed.length, sameLocator, 'locator 相等的豁免只应命中同 locator 的 findings')
    assert.equal(
      report.findings.filter((finding) => finding.rule === 'SPACE-003').length,
      targets.length - sameLocator,
      '不同 locator 的 SPACE-003 不得被连带豁免'
    )
    // locator 不等 → 不生效
    await writeExemptions(project, [{ rule: 'SPACE-003', locator: `${target.locator}-nope`, reason: 'locator 不等' }])
    report = await lintProject(project)
    assert.equal(report.dismissed.length, 0, 'locator 不等的豁免不得生效')
    expectRule(report, 'SPACE-003')
    // messageIncludes 子串匹配
    const includes = target.message.slice(0, Math.min(6, target.message.length))
    const includesCount = targets.filter((finding) => finding.message.includes(includes)).length
    await writeExemptions(project, [{ rule: 'SPACE-003', messageIncludes: includes, reason: 'message 子串命中' }])
    report = await lintProject(project)
    assert.equal(report.dismissed.length, includesCount, 'messageIncludes 只应豁免 message 含该子串的 findings')
    await writeExemptions(project, [{ rule: 'SPACE-003', messageIncludes: '绝不可能出现的消息子串', reason: 'message 不匹配' }])
    report = await lintProject(project)
    assert.equal(report.dismissed.length, 0, 'messageIncludes 不匹配的豁免不得生效')
    expectRule(report, 'SPACE-003')
  })
})

test('NF-17 scope 语义：命中所属章节匹配 / 不匹配', async () => {
  await withFixture('broken-words', async (project) => {
    const baseline = await lintProject(project)
    expectRule(baseline, 'VOICE-001')
    await writeExemptions(project, [{ rule: 'VOICE-001', scope: 'ch-001', reason: '第一章的元信息标注待删' }])
    let report = await lintProject(project)
    expectNoRule(report, 'VOICE-001')
    await writeExemptions(project, [{ rule: 'VOICE-001', scope: 'ch-099', reason: '章节不匹配' }])
    report = await lintProject(project)
    expectRule(report, 'VOICE-001')
  })
})

test('NF-17 --strict 下 BLOCKER/MAJOR 豁免被跳过并计入跳过数', async () => {
  await withFixture('clean-mini', async (project) => {
    await injectMajorTime005(project)
    await writeExemptions(project, [{ rule: 'TIME-005', reason: '人物年龄为叙事性设定' }])
    const strict = await cli(['lint', project, '--strict', '--json'])
    assert.equal(strict.code, 1, 'strict 下 MAJOR 不可豁免 → 退出 1')
    const report = JSON.parse(strict.out)
    assertReportConsistency(report)
    expectRule(report, 'TIME-005')
    assert.equal(report.dismissed.length, 0, 'strict 下 MAJOR 豁免必须被跳过')
    assert.equal(report.stats.skippedExemptions, 1, 'strict 跳过的豁免应计入 skippedExemptions')
    assert.equal(report.verdict, 'FAIL')
  })
})

// ---------------------------------------------------------------------------
// 12. 导出常量契约（PRD §5 API 冻结）
// ---------------------------------------------------------------------------
test('导出契约：SCHEMA_VERSION/VERSION 常量与 7 个 API 类型', () => {
  assert.equal(SCHEMA_VERSION, 'novel-forge/v1', 'SCHEMA_VERSION 必须逐字冻结')
  assert.equal(VERSION, '1.0.0', 'VERSION 必须逐字冻结')
  const api = { scaffoldProject, lintProject, lintChapterText, analyzeVoice, renderReport, runCli }
  for (const [name, value] of Object.entries(api)) assert.equal(typeof value, 'function', `${name} 必须导出为函数`)
})

// ---------------------------------------------------------------------------
// 13. NF-18 status / context（PRD §5.5 冻结顶层键）
// ---------------------------------------------------------------------------
test('NF-18 status --json：§5.5 冻结顶层键与派生值', async () => {
  await withFixture('clean', async (project) => {
    const res = await cli(['status', project, '--json'])
    assert.equal(res.code, 0)
    let status
    assert.doesNotThrow(() => {
      status = JSON.parse(res.out)
    }, 'status --json 必须是合法 JSON')
    for (const key of [
      'ok',
      'title',
      'chapters',
      'words',
      'perChapter',
      'timeline',
      'hooks',
      'characters',
      'items',
      'injuries',
      'lastChapter',
    ]) {
      assert.ok(key in status, `status 缺顶层键 ${key}`)
    }
    assert.equal(status.title, '雨停之前')
    assert.equal(status.chapters, 2)
    assert.equal(status.lastChapter, 2)
    assert.ok(status.words > 0)
    assert.ok(Array.isArray(status.perChapter) && status.perChapter.length === 2)
    assert.equal(status.timeline.day, 2)
    assert.deepEqual(
      { open: status.hooks.open, paid: status.hooks.paid, stale: status.hooks.stale },
      { open: 1, paid: 1, stale: 0 },
      'hooks 派生计数：h-002 OPEN、h-001 PAID、无超期'
    )
    assert.equal(status.characters.alive, 2, 'clean 夹具应有 2 名 alive 角色')
    assert.equal(status.characters.dead, 1, 'clean 夹具应有 1 名 dead 角色')
    assert.ok(Array.isArray(status.items), 'items 必须是数组')
    assert.ok(Array.isArray(status.injuries), 'injuries 必须是数组')
  })
})

test('NF-18 context --json：§5.5 冻结键 + castCards = 大纲 cast ∪ 上一章 cast（去重排序）', async () => {
  await withFixture('clean', async (project) => {
    const res = await cli(['context', project, '--chapter', '2', '--json'])
    assert.equal(res.code, 0)
    const context = JSON.parse(res.out)
    for (const key of [
      'ok',
      'chapter',
      'outlineCard',
      'previousSummary',
      'castCards',
      'openHooks',
      'facts',
      'places',
      'styleGuide',
    ]) {
      assert.ok(key in context, `context 缺顶层键 ${key}`)
    }
    assert.equal(context.chapter, 2)
    // castCards 选取 = 大纲第 2 章 scenes[].cast ∪ 上一章（第 1 章）frontmatter cast，去重排序；
    // 返回的是角色卡数组，这里取 id 断言集合与顺序（PRD §5.5 只冻结"选取"，未冻结卡内形状）。
    const castIds = context.castCards
      .map((card) => (typeof card === 'string' ? card : card && card.id))
      .filter(Boolean)
    assert.deepEqual(castIds, ['lin-jin', 'xu-an'], 'castCards 选取 = 大纲第 2 章 cast ∪ 上一章 cast，去重排序')
    assert.ok(context.outlineCard && typeof context.outlineCard === 'object', 'outlineCard 必须是对象')
    assert.equal(typeof context.previousSummary, 'string')
    assert.ok(context.previousSummary.length > 0, 'previousSummary 不得为空')
    assert.ok(Array.isArray(context.openHooks), 'openHooks 必须是数组')
    assert.ok(Array.isArray(context.facts), 'facts 必须是数组')
    assert.ok(Array.isArray(context.places), 'places 必须是数组')
  })
})

test('NF-18/v1.5 H1 写前可用：有 ch-1 大纲卡但章节文件不存在 → context exit 0 + 冻结键', async () => {
  await withFixture('clean-mini', async (project) => {
    // 清空 chapters/：只有大纲卡、还没有正文（写前状态）
    await rm(path.join(project, 'chapters', 'ch-001.md'))
    const res = await cli(['context', project, '--chapter', '1', '--json'])
    assert.equal(res.code, 0, 'context 不得要求章节文件已存在（PRD v1.5 H1）')
    const context = JSON.parse(res.out)
    for (const key of ['ok', 'chapter', 'outlineCard', 'previousSummary', 'castCards', 'openHooks', 'facts', 'places', 'styleGuide']) {
      assert.ok(key in context, `context 缺顶层键 ${key}`)
    }
    assert.equal(context.chapter, 1)
    assert.ok(context.outlineCard && typeof context.outlineCard === 'object', 'outlineCard 必须是对象')
    const castIds = context.castCards
      .map((card) => (typeof card === 'string' ? card : card && card.id))
      .filter(Boolean)
    assert.deepEqual(castIds, ['lin-jin'], 'castCards 选取 = 大纲 ch-1 cast ∪ 上一章（无）cast')
  })
})

test('NF-18/v1.5 H1 下一章写前：ch-2 大纲卡存在、ch-002.md 未写 → context exit 0', async () => {
  await withFixture('clean', async (project) => {
    await rm(path.join(project, 'chapters', 'ch-002.md'))
    const res = await cli(['context', project, '--chapter', '2', '--json'])
    assert.equal(res.code, 0, '下一章未写时 context 必须可用（写章闭环第一步，v1.5 H1）')
    const context = JSON.parse(res.out)
    assert.equal(context.chapter, 2)
    const castIds = context.castCards
      .map((card) => (typeof card === 'string' ? card : card && card.id))
      .filter(Boolean)
    assert.deepEqual(castIds, ['lin-jin', 'xu-an'], 'castCards = 大纲 ch-2 cast ∪ 上一章 ch-1 cast，去重排序')
    assert.ok(typeof context.previousSummary === 'string' && context.previousSummary.length > 0, '上一章摘要必须可打包')
  })
})

test('NF-18/v1.5 H1 无大纲卡（章节文件存在）→ exit 2 + stderr 可读原因', async () => {
  await withFixture('clean', async (project) => {
    const outlinePath = path.join(project, 'outline', 'outline.json')
    const outline = JSON.parse(await readFile(outlinePath, 'utf8'))
    outline.chapters = outline.chapters.filter((card) => card.chapter !== 2)
    await writeFile(outlinePath, JSON.stringify(outline, null, 2))
    const res = await cli(['context', project, '--chapter', '2'])
    assert.equal(res.code, 2, 'outline 无对应卡 → 退出码 2（真正覆盖 outline 分支）')
    assert.ok(res.err.trim().length > 0, 'stderr 必须给出一行可读原因')
  })
})

// ---------------------------------------------------------------------------
// 14. NF-19 健壮性：不抛异常 + 可判定问题必须产出 findings
// ---------------------------------------------------------------------------
test('NF-19 空目录 / 缺 project.json / JSON 语法错误 → 结构化结果 + 对应 findings', async () => {
  await withTmp(async (dir) => {
    const empty = path.join(dir, 'empty')
    await mkdir(empty, { recursive: true })
    const emptyReport = await lintProject(empty)
    assert.ok(Array.isArray(emptyReport.findings), '空目录必须返回结构化结果而非异常')
    assert.ok(
      emptyReport.findings.some((finding) => ['DOC-001', 'DOC-002'].includes(finding.rule)),
      `空目录应产出 DOC-001/DOC-002 至少一条：${rulesOf(emptyReport)}`
    )
    assert.equal(emptyReport.verdict, 'FAIL')
    assert.equal((await cli(['lint', empty, '--json'])).code, 1, '空目录 lint 应退出 1（有 BLOCKER）')

    const noProject = path.join(dir, 'no-project')
    await mkdir(path.join(noProject, 'chapters'), { recursive: true })
    await writeFile(path.join(noProject, 'chapters', 'ch-001.md'), '---\nchapter: 1\n---\n正文。\n')
    expectRule(await lintProject(noProject), 'DOC-001')

    const badJson = path.join(dir, 'bad-json')
    await cp(fixturePath('clean-mini'), badJson, { recursive: true })
    await writeFile(path.join(badJson, 'bible', 'space.json'), '{ 这不是合法 JSON')
    expectRule(await lintProject(badJson), 'DOC-002')
  })
})

test('NF-19 缺 frontmatter→DOC-005；CRLF/emoji/超长行/任意文本不抛异常', async () => {
  await withTmp(async (dir) => {
    const noFrontmatter = path.join(dir, 'no-frontmatter')
    await mkdir(path.join(noFrontmatter, 'chapters'), { recursive: true })
    await writeFile(path.join(noFrontmatter, 'project.json'), JSON.stringify({ schema: 'novel-forge/v1', title: '无头' }))
    await writeFile(path.join(noFrontmatter, 'chapters', 'ch-001.md'), '这一章没有 frontmatter，只有正文。\n')
    expectRule(await lintProject(noFrontmatter), 'DOC-005')

    // CRLF 章节：行尾归一化（\r\n → \n）后不得误报 DOC-005
    const crlf = path.join(dir, 'crlf')
    await cp(fixturePath('clean-mini'), crlf, { recursive: true })
    for (const rel of ['chapters/ch-001.md', 'bible/characters.jsonl', 'project.json']) {
      const file = path.join(crlf, rel)
      await writeFile(file, (await readFile(file, 'utf8')).replace(/\r?\n/g, '\r\n'))
    }
    expectNoRule(await lintProject(crlf), 'DOC-005')

    // emoji + 中文标点 / 超长行 / 任意文本：均不得抛异常
    const oddTexts = [
      '---\nchapter: 1\n---\n［表情😀］「引号」……——？？',
      `---\nchapter: 1\n---\n${'长'.repeat(20000)}`,
      '完全不是章节的文本',
    ]
    for (const text of oddTexts) {
      let result
      assert.doesNotThrow(() => {
        result = lintChapterText(text)
      }, '任意文本都不得抛异常')
      assert.ok(Array.isArray(result.findings), 'lintChapterText 必须返回结构化 findings')
    }

    // prose 对任意文本文件可用（不要求项目结构）
    const anyPath = path.join(dir, 'any.txt')
    await writeFile(anyPath, '随便一段文本，没有任何项目结构。')
    const prose = await cli(['prose', anyPath, '--json'])
    assert.equal(prose.code, 0)
    const proseJson = JSON.parse(prose.out)
    assert.ok(Array.isArray(proseJson.findings))
    assert.equal(typeof proseJson.aiVoice.score, 'number')
  })
})

// PRD v1.4（QA-B4 补）：prose 的 DOC-005 义务 —— 对「以 --- 开头但 YAML-lite 解析失败」
// 的文件必须产出 DOC-005 BLOCKER（不得静默只做 voice 体检）；对无 frontmatter 的普通文本不报。
test('NF-19/v1.4 prose DOC-005：tab 缩进 frontmatter → 退出码 1 + DOC-005 BLOCKER（行号 4 / fixRoute prose）', async () => {
  await withTmp(async (dir) => {
    const badPath = path.join(dir, 'bad-frontmatter.md')
    await writeFile(badPath, '---\nchapter: 1\nscenes:\n\t- id: ch1-s1\n---\n正文。\n')
    const res = await cli(['prose', badPath, '--json'])
    assert.equal(res.code, 1, 'prose 对 frontmatter 解析失败文件应退出 1（DOC-005 是 BLOCKER）')
    const report = JSON.parse(res.out)
    // rule + severity + dimension + message 一致性由 expectRule 断言（命中即累积 COVERED）
    const doc005 = expectRule(report.findings, 'DOC-005')
    assert.equal(doc005.severity, 'BLOCKER', 'DOC-005 级别必须为 BLOCKER')
    assert.equal(doc005.fixRoute, 'prose', 'DOC-005 修复路由必须为 prose')
    // N1（PRD §5.5 冻结；Lead 裁决 2026-10-29）：line = frontmatter 内真实解析错误行，
    // 且 prose 的 DOC-005 message 必须含行号信息（本样例 tab 缩进在第 4 行）。
    assert.equal(doc005.line, 4, `tab 缩进样例的 DOC-005 line 应为第 4 行（实际 ${doc005.line}）`)
    const lineMatch = /第\s*(\d+)\s*行/.exec(doc005.message || '')
    assert.ok(lineMatch, `DOC-005 message 必须含行号信息（如「第 4 行」，实际：${doc005.message}）`)
    assert.equal(
      Number(lineMatch[1]),
      doc005.line,
      `message 中的行号必须等于 line（message=${doc005.message}, line=${doc005.line}）`
    )
    // 非空洞自测：同一断言在无 findings 上必须红
    assert.throws(
      () => expectRule([], 'DOC-005'),
      /应命中 DOC-005/,
      'DOC-005 命中断言必须能捕获未触发情况'
    )
  })
})

test('NF-19/v1.4 prose 对照：完全没有 frontmatter 的纯文本不误报 DOC-005', async () => {
  await withTmp(async (dir) => {
    const plainPath = path.join(dir, 'plain.md')
    await writeFile(plainPath, '这只是一段没有任何 frontmatter 的纯文本，用来做对照。')
    const res = await cli(['prose', plainPath, '--json'])
    assert.equal(res.code, 0, '无 frontmatter 纯文本不应有 BLOCKER/MAJOR，退出码 0')
    const report = JSON.parse(res.out)
    assert.ok(Array.isArray(report.findings))
    assert.ok(
      !report.findings.some((finding) => finding.rule === 'DOC-005'),
      `纯文本不得误报 DOC-005（实际命中：${rulesOf(report.findings)}）`
    )
  })
})

// ---------------------------------------------------------------------------
// 14b. PRD v1.5（code-review H2/H3/M1/M2/M5）
// ---------------------------------------------------------------------------

// H2：章级门禁必须包含全局（非章节文件）findings；bible 级 BLOCKER 不得被 --chapter 过滤掉。
test('NF-19/v1.5 H2 章门禁含全局：bible 级坏 JSON → lint --chapter 1 exit 1 且含 DOC-002 BLOCKER', async () => {
  await withFixture('clean', async (project) => {
    const baseline = await cli(['lint', project, '--chapter', '1', '--json'])
    assert.equal(baseline.code, 0, '基线：干净项目章级门禁应 exit 0')
    await writeFile(path.join(project, 'bible', 'hooks.jsonl'), '{"id": "h-broken" 这不是合法 JSONL\n')
    const res = await cli(['lint', project, '--chapter', '1', '--json'])
    assert.equal(res.code, 1, 'bible 级 BLOCKER 必须影响章门禁（v1.5 H2）')
    const report = JSON.parse(res.out)
    const doc002 = expectRule(report.findings, 'DOC-002')
    assert.equal(doc002.severity, 'BLOCKER')
    assert.ok(/hooks\.jsonl/.test(doc002.file || ''), `DOC-002 应指向 bible/hooks.jsonl（实际 ${doc002.file}）`)
  })
})

// H3：报告写盘失败必须 exit 2 + stderr，绝不静默 PASS。
test('NF-19/v1.5 H3 报告写盘失败：reports 为普通文件 → lint exit 2 + stderr 非空', async () => {
  await withFixture('clean', async (project) => {
    await writeFile(path.join(project, 'reports'), '不是目录')
    const res = await cli(['lint', project])
    assert.equal(res.code, 2, '报告写盘失败必须 exit 2（IO 错误），不得静默 PASS')
    assert.ok(res.err.trim().length > 0, 'stderr 必须给出一行原因')
  })
})

test('NF-19/v1.5 H3 --report 副本写盘失败 → lint exit 2 + stderr 非空', async () => {
  await withFixture('clean', async (project, dir) => {
    const blocker = path.join(dir, 'blocker')
    await writeFile(blocker, 'x')
    const res = await cli(['lint', project, '--json', '--report', path.join(blocker, 'out.json')])
    assert.equal(res.code, 2, '--report 副本写盘失败必须 exit 2')
    assert.ok(res.err.trim().length > 0, 'stderr 必须给出一行原因')
  })
})

// M1：prose 与 lintChapterText 规则面一致 —— DOC-006（空正文）不得静默丢失；
// prose findings 只允许 DOC-005/006 + VOICE-001…011，**不含 DOC-007**。
const PROSE_ALLOWED_RULES = new Set([
  'DOC-005',
  'DOC-006',
  ...Array.from({ length: 11 }, (_, index) => `VOICE-${String(index + 1).padStart(3, '0')}`),
])

test('NF-19/v1.5 M1 prose 规则面：空正文 → DOC-006 BLOCKER；findings ⊆ {DOC-005,DOC-006,VOICE-001…011} 且不含 DOC-007', async () => {
  await withTmp(async (dir) => {
    const emptyBodyPath = path.join(dir, 'empty-body.md')
    await writeFile(emptyBodyPath, '---\nchapter: 1\ntitle: 空\n---\n\n   \n')
    const emptyRes = await cli(['prose', emptyBodyPath, '--json'])
    assert.equal(emptyRes.code, 1, '空正文 DOC-006 是 BLOCKER → exit 1')
    const emptyReport = JSON.parse(emptyRes.out)
    assert.equal(expectRule(emptyReport.findings, 'DOC-006').severity, 'BLOCKER')
    const aiPath = path.join(dir, 'ai.md')
    await writeFile(aiPath, AI_PROSE)
    const badFmPath = path.join(dir, 'bad-fm.md')
    await writeFile(badFmPath, '---\nchapter: 1\nscenes:\n\t- id: ch1-s1\n---\n正文。\n')
    const plainPath = path.join(dir, 'plain.md')
    await writeFile(plainPath, '这只是一段没有任何 frontmatter 的纯文本。')
    for (const [label, file] of [
      ['空正文', emptyBodyPath],
      ['AI 腔', aiPath],
      ['坏 frontmatter', badFmPath],
      ['纯文本', plainPath],
    ]) {
      const res = await cli(['prose', file, '--json'])
      const report = JSON.parse(res.out)
      for (const finding of report.findings) {
        assert.ok(PROSE_ALLOWED_RULES.has(finding.rule), `${label} 的 prose findings 出现越界规则 ${finding.rule}`)
        assert.notEqual(finding.rule, 'DOC-007', `${label} 的 prose findings 不得含 DOC-007`)
      }
    }
  })
})

// M2：OUT-004 是集合语义（数量或 id），不是顺序语义：只调换场景顺序不得命中。
test('NF-19/v1.5 M2 OUT-004 集合语义：仅调换场景顺序（id 集合不变）→ 不命中 OUT-004', async () => {
  await withFixture('clean', async (project) => {
    const outlinePath = path.join(project, 'outline', 'outline.json')
    const outline = JSON.parse(await readFile(outlinePath, 'utf8'))
    const card = outline.chapters.find((entry) => entry.chapter === 1)
    const beforeIds = card.scenes.map((scene) => scene.id).sort()
    card.scenes = [card.scenes[1], card.scenes[0]]
    assert.deepEqual(card.scenes.map((scene) => scene.id).sort(), beforeIds, '调换后 id 集合必须不变')
    await writeFile(outlinePath, JSON.stringify(outline, null, 2))
    const report = await lintProject(project)
    assertReportConsistency(report)
    expectNoRule(report, 'OUT-004')
    // 非空洞：OUT-004 正例由 broken-outline 夹具覆盖（场景 id 集合不一致 → 命中）
  })
})

// M5：DOC-004 缺口必须聚合（跨章号区间合成 1 条），不得产生缺口风暴。
test('NF-19/v1.5 M5 DOC-004 聚合：ch-001+ch-999 → 恰 1 条且 message 含区间，findings < 30', async () => {
  await withFixture('clean-mini', async (project) => {
    await writeFile(
      path.join(project, 'chapters', 'ch-999.md'),
      [
        '---',
        'chapter: 999',
        'title: 断档',
        'pov: lin-jin',
        'day: 999',
        'scenes:',
        '  - id: ch999-s1',
        '    place: qiao-dong',
        '    day: 999',
        '    clock: "09:00"',
        '    minutes: 10',
        '    cast: [lin-jin]',
        '    light: day',
        '---',
        '最后一章只有一句。',
        '',
      ].join('\n')
    )
    const report = await lintProject(project)
    assertReportConsistency(report)
    expectRule(report, 'DOC-004')
    const doc004 = report.findings.filter((finding) => finding.rule === 'DOC-004')
    assert.equal(doc004.length, 1, `连续缺口必须聚合为 1 条（实际 ${doc004.length} 条）`)
    assert.equal(doc004[0].severity, 'MAJOR')
    const message = doc004[0].message
    assert.match(message, /ch?-?0*2\b/, `DOC-004 message 应含缺口起点区间（实际：${message}）`)
    assert.match(message, /ch?-?0*998\b/, `DOC-004 message 应含缺口终点区间（实际：${message}）`)
    assert.ok(report.findings.length < 30, `DOC-004 缺口风暴必须收敛（实际 findings ${report.findings.length}）`)
  })
})

// ---------------------------------------------------------------------------
// 14c. PRD v1.7（code-review B2 的 F1/F2/F4，AC-16）
// ---------------------------------------------------------------------------

// F1（阻塞，双向）：计划型断言（OUT-003/FACT-004）不得并入 --chapter 章门禁；
// 全量 lint 仍照常报告（草稿期预期，证明规则未被删除）；H2 的全局 BLOCKER 仍必须拦章门禁。
test('F1/v1.7 计划型断言 × 章门禁：计划卡 + hooks.pay 计划章 → --chapter 1 exit 0；全量仍报；坏账本仍拦', async () => {
  await withTmp(async (dir) => {
    const project = path.join(dir, 'proj')
    await cp(fixturePath('clean-mini'), project, { recursive: true })
    // 1) outline 增加 ch-2/ch-3 计划卡（章节文件未写）
    const outlinePath = path.join(project, 'outline', 'outline.json')
    const outline = JSON.parse(await readFile(outlinePath, 'utf8'))
    for (const chapter of [2, 3]) {
      outline.chapters.push({
        chapter,
        title: `计划第 ${chapter} 章`,
        scenes: [
          {
            id: `ch${chapter}-s1`,
            place: 'qiao-dong',
            cast: ['lin-jin'],
            goal: '计划目标',
            conflict: '计划冲突',
            outcome: '计划结局',
            hooks_plant: [],
            hooks_pay: [],
          },
        ],
      })
    }
    await writeFile(outlinePath, JSON.stringify(outline, null, 2))
    // 2) hooks 增加一条 pay 指向计划第 3 章（章节未写）
    //    注意夹具 JSONL 末尾无换行：用换行前缀避免与上一行拼接成非法 JSON。
    await appendFile(
      path.join(project, 'bible', 'hooks.jsonl'),
      '\n{"id":"h-plan","question":"计划章回收","plant":1,"pay":3,"status":"PAID","staleAfter":null,"notes":"指向计划章"}\n'
    )
    // 3) 章门禁：计划型断言不得拦死已写章（v1.7 F1 / AC-16①）
    const scoped = await lintProject(project, { chapter: 1 })
    assertReportConsistency(scoped)
    expectNoRule(scoped, 'OUT-003')
    expectNoRule(scoped, 'FACT-004')
    assert.equal(scoped.verdict, 'PASS', `计划型断言不得拦死章门禁（实际 FAIL：${rulesOf(scoped)}）`)
    assert.equal(scoped.counts.BLOCKER, 0)
    assert.equal(scoped.counts.MAJOR, 0)
    const scopedCli = await cli(['lint', project, '--chapter', '1', '--json'])
    assert.equal(scopedCli.code, 0, '计划卡/计划型 hooks 存在时 --chapter 1 必须 exit 0（PRD v1.7 F1）')
    // 4) 全量 lint：计划型断言仍照常报告（规则未删除）
    const full = await lintProject(project)
    assertReportConsistency(full)
    assert.equal(expectRule(full, 'OUT-003').severity, 'MAJOR', '全量 lint 仍须报 OUT-003:MAJOR')
    assert.equal(expectRule(full, 'FACT-004').severity, 'MAJOR', '全量 lint 仍须报 FACT-004:MAJOR')
    assert.equal(full.verdict, 'FAIL', '全量 lint 在计划型断言存在时应 FAIL（草稿期预期）')
    // 5) H2 回归：全局 BLOCKER 仍必须拦章门禁
    await writeFile(path.join(project, 'bible', 'hooks.jsonl'), '{"id": "h-broken" 这不是合法 JSONL\n')
    const h2 = await cli(['lint', project, '--chapter', '1', '--json'])
    assert.equal(h2.code, 1, 'H2 回归：坏账本 BLOCKER 仍须拦章门禁')
    const h2Report = JSON.parse(h2.out)
    assert.equal(expectRule(h2Report.findings, 'DOC-002').severity, 'BLOCKER')
  })
})

// F2（fail-closed）：analyzeVoice 内部异常不得返回满分放行；
// 必须 score=0 + VOICE-011 MAJOR（message 注明「语音分析失败」），且全程不抛异常。
test('F2/v1.7 fail-closed：非法 thresholds 触发语音分析失败 → score=0 + VOICE-011:MAJOR，不抛异常', async () => {
  await withFixture('clean-mini', async (project) => {
    const cfgPath = path.join(project, 'project.json')
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'))
    cfg.style = { ...(cfg.style || {}), forbiddenWords: [], thresholds: null }
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2))
    // 不抛异常：await 若 reject 则测试直接失败
    const report = await lintProject(project)
    assertReportConsistency(report)
    assert.equal(report.stats.aiVoice.score, 0, `fail-closed：分析失败时 score 必须为 0（实际 ${report.stats.aiVoice.score}）`)
    const voice011 = expectRule(report.findings, 'VOICE-011')
    assert.equal(voice011.severity, 'MAJOR')
    assert.match(voice011.message, /语音分析失败/, `VOICE-011 message 必须注明「语音分析失败」（实际：${voice011.message}）`)
    assert.equal(report.verdict, 'FAIL', 'fail-closed 必须使门禁 FAIL（不得静默 PASS）')
    // CLI 路径同样 fail-closed：exit 1 + score=0
    const cliRes = await cli(['lint', project, '--json'])
    assert.equal(cliRes.code, 1, '语音分析失败（VOICE-011 MAJOR）必须使 lint 退出 1')
    const cliReport = JSON.parse(cliRes.out)
    assert.equal(cliReport.stats.aiVoice.score, 0)
    assert.ok(
      cliReport.findings.some((finding) => finding.rule === 'VOICE-011' && finding.severity === 'MAJOR'),
      'prose/lint 路径必须产出 VOICE-011:MAJOR'
    )
  })
})

// F4（报告转义）：title 含 | 与换行时，报告必须转义为 \| 且不得注入伪段落/伪表头。
test('F4/v1.7 renderReport：title 含 | 与换行 → 输出 \\| 且不撑破表格/不注入伪段落', async () => {
  await withFixture('clean-mini', async (project) => {
    const cfgPath = path.join(project, 'project.json')
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'))
    cfg.title = '标题|带竖线\n## 伪造小节'
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2))
    const report = await lintProject(project)
    const md = renderReport(report)
    assert.ok(md.includes('\\|'), 'title 中的 | 必须转义为 \\|')
    const firstLine = md.split('\n')[0]
    assert.ok(
      !firstLine.replace(/\\\|/g, '').includes('|'),
      `标题行不得出现裸 |（实际：${firstLine}）`
    )
    assert.ok(!/\n## 伪造小节/.test(md), 'title 中的换行不得注入伪段落/伪表头')
  })
})

// ---------------------------------------------------------------------------
// 15. NF-23 规则覆盖台账（元断言，必须最后运行）
//    COVERED 只由 expectRule 的真实命中累积；NOT_YET 每条显式 {id, reason}。
// ---------------------------------------------------------------------------
test('NF-23 覆盖台账：COVERED ∪ NOT_YET == RULES、交集空、COVERED ≥ 50、NOT_YET 每条带 reason', () => {
  const ruleIds = new Set(ALL_RULE_IDS)
  const notYetIds = new Set(NOT_YET.map((entry) => entry.id))
  assert.equal(notYetIds.size, NOT_YET.length, 'NOT_YET 不得重复声明同一 rule id')
  for (const entry of NOT_YET) {
    assert.ok(ruleIds.has(entry.id), `NOT_YET 含未知 rule id：${entry.id}`)
    assert.equal(typeof entry.reason, 'string')
    assert.ok(entry.reason.trim().length >= 8, `NOT_YET ${entry.id} 的 reason 必须具体（≥8 字），不得空泛`)
  }
  const overlap = [...COVERED].filter((id) => notYetIds.has(id))
  assert.deepEqual(overlap, [], `COVERED 与 NOT_YET 交集必须为空，实际重叠：${overlap.join(', ')}`)
  for (const id of COVERED) assert.ok(ruleIds.has(id), `COVERED 含未知 rule id：${id}`)
  const union = [...new Set([...COVERED, ...notYetIds])].sort()
  assert.deepEqual(
    union,
    [...ruleIds].sort(),
    'COVERED ∪ NOT_YET 必须精确等于 RULES 全 id（任何 id 既未覆盖又未声明 → 红）'
  )
  assert.ok(COVERED.size >= 50, `COVERED 至少 50 条（实际 ${COVERED.size}）`)
  assert.ok(NOT_YET.length <= 12, `NOT_YET 不得滥用（实际 ${NOT_YET.length} 条）`)
  // 非空洞自测：人为制造一个"两边都没有"的洞，并集断言必须失败
  const holed = [...COVERED].filter((id) => id !== 'SPACE-001')
  assert.throws(
    () => assert.deepEqual([...new Set([...holed, ...notYetIds])].sort(), [...ruleIds].sort(), '缺项必须红'),
    /缺项必须红/,
    '台账并集断言必须能捕获「既不在 COVERED 也不在 NOT_YET」的规则'
  )
})

