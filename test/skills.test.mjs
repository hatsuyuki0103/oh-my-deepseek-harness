// SPDX-License-Identifier: MIT
// test/skills.test.mjs — oh-my-deepseek-harness 技能目录卫生契约测试。
// 运行：node --test "test/*.test.mjs"
// 覆盖：SKILL.md 完整性、frontmatter 契约（目录名即规范名）、README 技能表与计数一致性、
// 无「无视觉」过时声明、visual-ralph 无 OMX 残留 + 裁决 JSON 六键、提供方注册挂接。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KEBAB_RE,
  parseFrontmatter,
  makeEmbeddedSkillsProvider,
} from '../lib/skills-provider.mjs'

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = path.join(PKG_ROOT, 'skills')
const README_PATH = path.join(PKG_ROOT, 'README.md')

const skillDirs = async () =>
  (await readdir(SKILLS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

test('技能目录完整性：每个技能目录都有 SKILL.md', async () => {
  const dirs = await skillDirs()
  assert.ok(dirs.length > 0, '技能目录不为空')
  for (const dir of dirs) {
    const md = path.join(SKILLS_DIR, dir, 'SKILL.md')
    const stat = await readFile(md).then(() => true, () => false)
    assert.ok(stat, `缺少 SKILL.md：skills/${dir}/`)
  }
})

test('frontmatter 契约：name 与目录名一致（锁「目录名即规范名」，有意严于 provider 运行时的 kebabName 归一化）且 description 非空', async () => {
  const dirs = await skillDirs()
  for (const dir of dirs) {
    const content = await readFile(path.join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8')
    const { meta } = parseFrontmatter(content)
    assert.equal(meta.name, dir, `frontmatter name 必须等于目录名：${dir}`)
    assert.match(meta.name, KEBAB_RE, `技能名必须 kebab-case：${dir}`)
    assert.ok(meta.description && meta.description.trim().length > 0, `description 非空：${dir}`)
  }
})

test('README 技能表与技能目录一致，且技能计数 == 目录数', async () => {
  const dirs = await skillDirs()
  const dirSet = new Set(dirs)
  const readme = await readFile(README_PATH, 'utf8')

  // 仅解析以 | 开头的表格行中的反引号 token，经 kebab 过滤后与技能集合求交集
  //（表格说明列不应出现技能名以外的反引号 token）
  const tableRows = readme.split('\n').filter((l) => l.trimStart().startsWith('|'))
  const tokens = new Set()
  for (const row of tableRows) {
    for (const m of row.matchAll(/`([^`]+)`/g)) {
      if (KEBAB_RE.test(m[1])) tokens.add(m[1])
    }
  }
  const tableSkills = new Set([...tokens].filter((t) => dirSet.has(t)))
  assert.deepEqual([...tableSkills].sort(), [...dirSet].sort(), 'README 表格技能集合应等于 skills 目录集合（含新增/移除同步）')

  const countMatch = readme.match(/共 (\d+) 技能/)
  assert.ok(countMatch, 'README 应含「共 N 技能」计数')
  assert.equal(Number(countMatch[1]), dirs.length, `README 技能计数应等于目录数（${dirs.length}）`)
})

test('无过时声明：skills 下不存在「无视觉模型 / DSH 无视觉」字样', async () => {
  const dirs = await skillDirs()
  const stale = ['无视觉模型', 'DSH 无视觉']
  for (const dir of dirs) {
    const content = await readFile(path.join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8')
    for (const phrase of stale) {
      assert.equal(content.split(phrase).length - 1, 0, `skills/${dir}/SKILL.md 仍含「${phrase}」`)
    }
  }
})

test('visual-ralph 契约：无 OMX 专有残留 + 裁决 JSON 六键', async () => {
  const content = await readFile(path.join(SKILLS_DIR, 'visual-ralph', 'SKILL.md'), 'utf8')
  const banned = ['$imagegen', 'omx imagegen', '$CODEX_HOME', '$ralph', '$visual-ralph', '$web-clone', 'templates/AGENTS.md']
  for (const s of banned) {
    assert.ok(!content.includes(s), `visual-ralph 不得包含 OMX 专有残留：「${s}」`)
  }

  const fenced = content.match(/```json\r?\n([\s\S]*?)```/)
  assert.ok(fenced, 'visual-ralph 应包含一个 ```json 裁决样例块')
  const verdict = JSON.parse(fenced[1])
  assert.ok(fenced[1].includes('score'), '裁决样例块应包含 score 键')
  assert.deepEqual(
    Object.keys(verdict).sort(),
    ['category_match', 'differences', 'reasoning', 'score', 'suggestions', 'verdict'].sort(),
    '裁决 JSON 必须包含六键：score / verdict / category_match / differences / suggestions / reasoning'
  )
})

test('提供方注册挂接：visual-ralph 出现在提供方候选集中', async () => {
  const provider = makeEmbeddedSkillsProvider({ roots: [SKILLS_DIR] })
  const candidates = await provider.list()
  const byName = new Map(candidates.map((c) => [c.name, c]))
  assert.ok(byName.has('visual-ralph'), '提供方应注册 visual-ralph 候选')
  assert.match(byName.get('visual-ralph').name, KEBAB_RE)
})

// ─────────────────────────────────────────────────────────────────────────────
// omdsh-agent-teams v3.1 契约断言 TA-01…TA-06
// 冻结真源：.omx/plans/test-spec-omdsh-agent-teams.v3.1.md
//   §1 断言总表 / §2 冻结 token / §3 守卫（文件级 + 同句级）/ §4 TA-01 两算法 / §5 TA-02 行锚定
// 内容改动前这 6 条必须全红；红证据：.omx/evidence/omdsh-agent-teams-red.txt
// ─────────────────────────────────────────────────────────────────────────────

const ROLES_DIR = path.join(PKG_ROOT, 'roles')
const TEAM_SKILL_PATH = path.join(SKILLS_DIR, 'team', 'SKILL.md')
const TEAM_DISPATCH_PATH = path.join(SKILLS_DIR, 'team', 'references', 'skill-dispatch.md')
const CAPABILITY_MATRIX_PATH = path.join(PKG_ROOT, 'docs', 'capability-matrix.md')

const TEAM_TOOLS = [
  'spawn_teammate',
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
]

// §2 冻结 token：逐字等于 test-spec v3.1 §2（byte-verified）。禁止改写、禁止放宽为 includes 之外的形式。
// errata（round-2，Lead 裁决走 test-spec §7-4 errata 路径）：COND_REVIEW 换行为「名册含 `spawn_teammate`（**仅 Lead 可调用**）」
// 版本——九工具在每个成员作用域都注册，Lead-only 在调用时（TEAM_LEAD_REQUIRED）强制，旧首支让 teammate 做了它做不到的事。
const PTR_SKILL = '> 可选能力：本技能引用的可选工具（DSH 原生 `ralph` 工具、官方团队九工具、`workflow`、`subagent`/`subagent_fork`）可能在当前 profile 未挂载或被预设停用；探测方式与四级降级阶梯见本包根目录 `docs/capability-matrix.md`（技能目录上两级：`../../docs/capability-matrix.md`）。'
const PTR_ROLE = '> 可选能力：本角色引用的执行通道（官方团队九工具 / `subagent` / `workflow` / `ralph` 工具 / goal 工具）可能在当前 profile 未挂载或被预设停用；探测方式与四级降级阶梯见 `docs/capability-matrix.md`。'
const COND_REVIEW = '> 评审通道（按名册实况）：名册含 `spawn_teammate`（**仅 Lead 可调用**；teammate 需先请 Lead 建队）→ 团队双通道（两名 teammate 各担一通道，`wait_agent` 收证据）；否则名册含 `subagent` → 子代理双通道；否则报告 `independent review unavailable`，不批准。'

const SKILL_PTR_FILES = ['ralph', 'visual-ralph', 'autopilot', 'ralplan', 'plan', 'prometheus-strict', 'deep-interview',
  'ultrawork', 'ecomode', 'security-review', 'ai-slop-cleaner', 'ultraqa', 'code-review', 'team', 'doctor', 'cancel', 'ultragoal']
const ROLE_PTR_FILES = ['planner', 'oracle', 'momus']
const COND_REVIEW_FILES = ['code-review', 'ultraqa', 'ralplan', 'plan']

const MATRIX_HEADER = '| 能力 | 探测方式 | 已挂载时 | 未挂载时降级 | 判别陷阱 |'
const MATRIX_TOKENS = [
  '团队九工具', 'spawn_teammate', 'wait_agent', 'team_task_create', 'team_task_update', 'send_message', 'list_agents',
  'interrupt_agent', 'ralph', 'subagent_fork', 'workflow', '未挂载', 'queued', 'inactive', 'write_scopes',
  'expected_revision', 'cordis_inspect_query', 'maxMembers', 'cordis_inspect_self', 'cordis_stop',
]

// §3 守卫：两条独立断言——(i) 文件级指针；(ii) 同句级降级条件（frontmatter 豁免）
// round-3 B1：提及规则大小写不敏感 + 双侧标识符边界（等价 `\bralph\b`，但把 `-`/`_`/数字算作标识符字符），
// 裸断言 / 大小写 / 英文措辞 / 表格单元格 / 跨行形态全部命中；同时保留 `visual-ralph`、`ralph-progress.json` 排除。
const RALPH_MENTION_RE = /(?:^|[^A-Za-z0-9_-])ralph(?!`?[A-Za-z0-9_-])/i
// claim 选择器：任意大小写的 ralph 提及（`工具`/`tool` 后缀可选）
const RALPH_CLAIM_RE = /(?:^|[^A-Za-z0-9_-])`?ralph`?(?:\s*(?:tool|工具))?(?!`?[A-Za-z0-9_-])/i
// v3.1 冻结形态：显式「ralph 工具 / ralph tool」一律按可用性声明处理（后缀版语义不变）
const RALPH_TOOL_FORM_RE = /(?:^|[^A-Za-z0-9_-])`?ralph`?\s*(?:tool|工具)(?!`?[A-Za-z0-9_-])/i
// 后缀省略的形态要有可用性谓词（挂载/可用/mounted/available…）才算声明——否则技能名枚举会被误判为声明
const AVAILABILITY_RE = /挂载|可用|能用|使用|支持|启用|停用|安装|在场|缺失|mounted|available|enabled|disabled|usable|present|absent/i
// round-4：句界（。；;.!?！？）——可用性谓词必须与提及**同句**，不再用字符距离窗口
const SENTENCE_BOUNDARY_RE = /[。；;.!?！？]/
// rework：删除裸 `若`（`若用户点名则用 \`ralph\` 工具。` 不构成降级条件），只保留真实降级/条件标记。
const DEGRADE_RE = /未挂载|停用|降级|否则|替代|不可用|会话内|以名册|缺失时|capability-matrix/
const RALPH_GUARD_MSG = '提及 ralph 的文件必须给出降级指针'
const assertRalphPointer = (content, label) => {
  if (!RALPH_MENTION_RE.test(content)) return
  assert.ok(content.includes('docs/capability-matrix.md'), `${RALPH_GUARD_MSG}：${label}`)
}
// round-4：取提及所在的整句——向左/向右找句界；本行未收句（无句界）时句子续写到下一行直到其句界
const sentenceAround = (lines, idx, from, to) => {
  const line = lines[idx]
  let left = 0
  for (let i = from - 1; i >= 0; i--) if (SENTENCE_BOUNDARY_RE.test(line[i])) { left = i + 1; break }
  let right = line.length
  let closed = false
  for (let i = to; i < line.length; i++) if (SENTENCE_BOUNDARY_RE.test(line[i])) { right = i + 1; closed = true; break }
  let text = line.slice(left, right)
  if (!closed && idx + 1 < lines.length) {
    const nextLine = lines[idx + 1]
    let nr = nextLine.length
    for (let i = 0; i < nextLine.length; i++) if (SENTENCE_BOUNDARY_RE.test(nextLine[i])) { nr = i + 1; break }
    text += `\n${nextLine.slice(0, nr)}`
  }
  return text
}
// 命中「可用性声明」时返回降级检查文本，否则 null
const ralphClaimAt = (lines, idx) => {
  const line = lines[idx]
  const m = RALPH_CLAIM_RE.exec(line)
  if (!m) return null
  const sentence = sentenceAround(lines, idx, m.index, m.index + m[0].length)
  // 后缀省略版：可用性谓词必须出现在**同句**（句界分割，不再用字符距离窗口）
  if (!RALPH_TOOL_FORM_RE.test(line) && !AVAILABILITY_RE.test(sentence)) return null
  // 降级检查保持 v3.1 的行级语义；仅当句子跨行续写时把续写部分并入
  return sentence.includes('\n') ? sentence : line
}
const assertRalphSameLine = (content, label) => {
  const lines = content.split(/\r?\n/)
  let fmEnd = -1
  if (lines[0] === '---') for (let i = 1; i < lines.length; i++) if (lines[i] === '---') { fmEnd = i; break }
  for (let idx = 0; idx < lines.length; idx++) {
    if (fmEnd > 0 && idx <= fmEnd) continue                       // frontmatter 豁免（结构化块）
    const sentence = ralphClaimAt(lines, idx)
    if (!sentence) continue
    assert.match(sentence, DEGRADE_RE, `ralph 可用性声明必须同句给出降级条件：${label}:${idx + 1}`)
  }
}

const roleFiles = async () =>
  (await readdir(ROLES_DIR)).filter((f) => f.endsWith('.md')).sort().map((f) => path.join(ROLES_DIR, f))

// round-4：扫描面补全——skills/*/references/*.md（当前恰 1 个：skills/team/references/skill-dispatch.md）
const referenceFiles = async () => {
  const out = []
  for (const d of await skillDirs()) {
    const dir = path.join(SKILLS_DIR, d, 'references')
    for (const f of (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md')).sort()) out.push(path.join(dir, f))
  }
  return out
}

const PARALLELISM_TOKENS = ['serial', 'fan-out', 'staged', 'lead-only']
const ROLE_VOCAB = ['analyst', 'architect', 'code-reviewer', 'critic', 'executor', 'lead', 'momus', 'oracle', 'planner', 'test-engineer', 'verifier']
const ROLE_QUALIFIERS = ['lanes']   // PRD 冻结行的量词（`executor lanes`），不是角色名

// round-3 B2 / round-4：冻结逐行映射（列 2/3/4/5 = 建议角色 / 并行性 / 写入范围 / 证据要求），逐字取自
// PRD v3.1 §3-WS-A「矩阵内容（26 行，本 PRD 定稿，执行者照抄）」；行体对调 / 首列改名 / 语义反转 / 第 5 列漂移都必须红。
const CANONICAL_MATRIX = {
  'ai-slop-cleaner': ['executor+verifier', 'staged', '每 lane 独占文件', '`node --test` + 清理前后 diff'],
  'aliyun-media': ['executor', 'serial', '`skills/aliyun-media/**`', 'CLI dry-run（零付费）'],
  'analyze': ['analyst', 'fan-out', '只读', 'file:line 清单'],
  'autopilot': ['planner+executor+verifier', 'staged', '阶段独占、lead 汇总', '各阶段闸输出'],
  'build-fix': ['executor', 'serial', '受影响模块独占', '复现命令 + 修复后同命令'],
  'cancel': ['lead', 'lead-only', '状态文件独占', '终态文件 + `job_list`'],
  'code-review': ['code-reviewer+architect', 'fan-out(2 独立)', '只读', '双通道结论（APPROVE/CLEAR）'],
  'deep-interview': ['analyst+lead', 'serial', '`.omx/interviews` / `.omx/specs`', '访谈产物 + 歧义评分'],
  'design': ['executor+verifier', 'staged', '`DESIGN.md` 独占', '设计证据清单'],
  'doctor': ['verifier', 'serial', '只读', '探测输出摘要'],
  'ecomode': ['lead', 'lead-only', '无写入', '委派计数对比'],
  'git-master': ['executor', 'serial', 'git 操作单写者', '`git log/show` 回执'],
  'note': ['lead', 'lead-only', '`.omx/notepad.md` 独占', '追加条目'],
  'plan': ['planner(+architect+critic)', 'staged(强制串行评审)', '`.omx/plans`', 'PRD/test-spec'],
  'prometheus-strict': ['analyst(Metis)+momus+oracle', 'staged', '`.omx/plans/prometheus-strict`', '三声部产物'],
  'ralph': ['executor+architect', 'staged', '每轮独占切片', '轮次报告 + 复核签字'],
  'ralplan': ['planner→architect→critic', 'staged(强制串行)', '`.omx/{plans,specs,context}`', 'PRD+test-spec+handoff'],
  'security-review': ['verifier+architect', 'fan-out', '只读', '分级发现清单'],
  'skill-authoring': ['executor+test-engineer', 'staged', '`skills/<name>/**` 独占（**本轮禁止新增目录**）', '契约测试红→绿'],
  'tdd': ['test-engineer+executor', 'staged', '测试/实现文件分 lane', '红→绿输出'],
  'team': ['lead+verifier', 'fan-out/staged', '每 teammate 独占文件集', '`team_task_list`+`list_agents` 见证'],
  'tencent-media': ['executor', 'serial', '`skills/tencent-media/**`', 'CLI dry-run（零付费）'],
  'ultragoal': ['lead(目标所有人)+executor lanes', 'staged', 'worker 不碰 `.omx/ultragoal`', '`ledger.jsonl` + `get_goal` 快照'],
  'ultraqa': ['executor+architect', 'staged 循环', '每轮独占修复切片', '场景矩阵 + 退出码'],
  'ultrawork': ['executor lanes', 'fan-out', '每 lane 独占文件', '验收命令输出'],
  'visual-ralph': ['executor+verifier(视觉判分)', 'staged', '前端文件独占', '`read_image` 判分 JSON'],
}

// rework：逐格加固——5 列非空、并行性取自词表、建议角色只认已知角色 token、单元格内禁裸半角 |。
const assertDispatchMatrix = (md, label, dirs) => {
  assert.ok(md.includes('| 技能 | 建议角色 | 并行性 | 写入范围策略 | 证据要求 |'), `${label} 缺少表头`)
  const rows = md.split('\n').filter((l) => /^\|\s*`[a-z0-9-]+`\s*\|/.test(l))
  const names = rows.map((l) => l.match(/^\|\s*`([^`]+)`/)[1])
  assert.equal(rows.length, 26, `${label} 数据行应为 26（实际 ${rows.length}）`)
  assert.deepEqual([...names].sort(), dirs, `${label} 技能集合应等于 skills 目录集合`)
  assert.deepEqual(Object.keys(CANONICAL_MATRIX).sort(), dirs, 'PRD 冻结映射必须恰好覆盖 26 个技能目录')
  for (const r of rows) {
    // round-2 修复：旧 `cells.includes('|')` 在 split 后恒假（死断言）。裸/转义半角 | 都会撑破列，
    // 故先在原行上统计「未转义半角 |」——5 列行必须恰 6 个——再切格。
    const unescapedPipes = (r.replace(/\\\|/g, '').match(/\|/g) ?? []).length
    assert.equal(unescapedPipes, 6, `${label} 未转义半角 | 数应为 6（5 列行；stray | 会撑破列，实际 ${unescapedPipes}）：${r}`)
    const cells = r.split('|').slice(1, -1).map((c) => c.trim())
    const at = `${label} 行 ${cells[0] ?? r}`
    assert.equal(cells.length, 5, `${label} 每行必须 5 列：${r}`)
    for (const c of cells) assert.ok(c.length > 0, `${at} 单元格不得为空：${r}`)
    // round-3 B2 / round-4：五列中的后四列必须逐字等于 PRD 冻结映射（行体对调 / 首列改名 / 语义反转 / 第 5 列漂移都会在此红）
    const frozen = CANONICAL_MATRIX[cells[0].replace(/`/g, '')]
    assert.ok(frozen, `${at} PRD 冻结映射缺少该技能行`)
    assert.deepEqual(cells.slice(1, 5), frozen,
      `${at} 五列（建议角色/并行性/写入范围/证据要求）必须逐字等于 PRD 冻结映射：实际 ${JSON.stringify(cells.slice(1, 5))}，期望 ${JSON.stringify(frozen)}`)
    // 并行性：`/` 连接的每一段都必须取自词表（允许 PRD 冻结的括号/空格限定语，如 `staged(强制串行)`、`staged 循环`）
    const parallel = cells[2]
    for (const part of parallel.split('/')) {
      const p = part.trim()
      assert.ok(
        PARALLELISM_TOKENS.some((t) => p === t || p.startsWith(`${t}(`) || p.startsWith(`${t}（`) || p.startsWith(`${t} `)),
        `${at} 并行性必须取自词表 ${PARALLELISM_TOKENS.join('|')}（实际：${parallel}）`
      )
    }
    // 建议角色：至少一个已知角色；所有 ASCII 角色样 token 必须在词表（或量词白名单）内
    const roleTokens = cells[1].replace(/[（(][^（()）]*[)）]/g, '').split(/[+→,\s/]+/).map((t) => t.trim()).filter((t) => /^[A-Za-z][A-Za-z-]*$/.test(t))
    assert.ok(roleTokens.some((t) => ROLE_VOCAB.includes(t)),
      `${at} 建议角色必须含已知角色（词表：${ROLE_VOCAB.join('/')}）：${cells[1]}`)
    for (const t of roleTokens) {
      assert.ok(ROLE_VOCAB.includes(t) || ROLE_QUALIFIERS.includes(t),
        `${at} 建议角色含未知 token「${t}」（词表：${ROLE_VOCAB.join('/')}）：${cells[1]}`)
    }
  }
}

const assertPointerLine = (content, file, expected, withCondReview) => {
  const lines = content.split(/\r?\n/)
  const i = lines.findIndex((l) => l.startsWith('# '))
  assert.ok(i >= 0, `缺少 H1：${file}`)
  assert.equal(lines[i + 1], '', `H1 后应为空行：${file}`)
  assert.equal(lines[i + 2], expected, `指针行必须逐字等于冻结 token：${file}\n期望：${expected}\n实际：${lines[i + 2]}`)
  if (withCondReview) {
    assert.equal(lines[i + 3], COND_REVIEW, `评审通道条件行必须逐字等于冻结 token：${file}\n期望：${COND_REVIEW}\n实际：${lines[i + 3]}`)
  }
}

test('team 技能团队原生化：九工具 + 四级降级次序 + 无失效前提', async () => {
  const file = 'skills/team/SKILL.md'
  const content = await readFile(TEAM_SKILL_PATH, 'utf8')
  const lines = content.split(/\r?\n/)

  // (a) tasks.json 同句守卫：任何含 tasks.json 的行必须同句声明只读/审计口径
  const TASKSJSON_GUARD_RE = /(只读|留档|不删|禁止|旧|legacy|审计)/
  lines.forEach((l, i) => {
    if (!l.includes('tasks.json')) return
    assert.match(l, TASKSJSON_GUARD_RE, `tasks.json 行必须同句声明只读/审计口径：${file}:${i + 1}`)
  })

  // (b) 四级次序：标题独占匹配 → 下一个 ^## 之前的小节体；禁用全文 indexOf（指针行本身含第 1/3 级词）
  const HEAD = '## 通道选择：团队优先，四级降级'
  const FOUR = ['官方团队九工具', 'workflow', 'subagent', '会话内串行']
  const bodyOf = (ls) => {
    const s = ls.findIndex((l) => l === HEAD)
    if (s < 0) return null
    let e = -1
    for (let i = s + 1; i < ls.length; i++) if (ls[i].startsWith('## ')) { e = i; break }
    const body = ls.slice(s + 1, e < 0 ? ls.length : e).join('\n')
    return body.trim() ? body : null
  }
  const body = bodyOf(lines)
  assert.ok(body, '缺少小节体（标题独占匹配 + 非空）')
  // round-4：四级必须落在**不同行**且行号严格递增（防「别处按序提到四词」或反序阶梯用首个 indexOf 蒙混）
  const bodyLines = body.split('\n')
  const lineOf = FOUR.map((t) => bodyLines.findIndex((l) => l.includes(t)))
  lineOf.forEach((v, i) => assert.ok(v >= 0, `小节体内缺少第 ${i + 1} 级 token：${FOUR[i]}`))
  assert.equal(new Set(lineOf).size, FOUR.length, `四级 token 必须分居不同行：${JSON.stringify(lineOf)}`)
  for (let i = 1; i < lineOf.length; i++) assert.ok(lineOf[i] > lineOf[i - 1], `降级阶梯次序不符（需行号严格递增）：${JSON.stringify(lineOf)}`)
  // 级别标记（第 1 级…第 4 级）是 shipped 文本的一部分，必须同样分居不同行且在序
  const LEVELS = ['第 1 级', '第 2 级', '第 3 级', '第 4 级']
  const levelLines = LEVELS.map((t) => bodyLines.findIndex((l) => l.includes(t)))
  levelLines.forEach((v, i) => assert.ok(v >= 0, `小节体内缺少级别标记：${LEVELS[i]}`))
  for (let i = 1; i < levelLines.length; i++) assert.ok(levelLines[i] > levelLines[i - 1], `级别标记次序不符（需行号严格递增）：${JSON.stringify(levelLines)}`)

  // (c) 九工具名逐一
  for (const tool of TEAM_TOOLS) assert.ok(content.includes(tool), `team 技能缺少团队工具：${tool}`)

  // 降级真源指针 + 共享命名空间声明（M4）
  assert.ok(content.includes('docs/capability-matrix.md'), `team 技能缺少能力矩阵指针：${file}`)
  assert.ok(content.includes('manifest.v2.json'), `team 技能缺少共享命名空间声明（manifest.v2.json）：${file}`)

  // 三条失效前提串必须消失
  for (const stale of ['没有 worker 长生命周期', 'DSH 无此运行时', 'tmux 类需求']) {
    assert.equal(content.split(stale).length - 1, 0, `team 技能仍含失效前提串：「${stale}」`)
  }
})

test('技能调度矩阵：26/26 行锚定覆盖（SKILL.md 正文 + references 全表）', async () => {
  const dirs = await skillDirs()
  const teamMd = await readFile(TEAM_SKILL_PATH, 'utf8')
  assert.ok(teamMd.includes('| 技能 | 建议角色 | 并行性 | 写入范围策略 | 证据要求 |'), 'team SKILL.md 缺少调度矩阵表')
  assert.ok(teamMd.includes('references/skill-dispatch.md'), 'team SKILL.md 应指向 references/skill-dispatch.md')
  assertDispatchMatrix(teamMd, 'team SKILL.md', dirs)

  const refMd = await readFile(TEAM_DISPATCH_PATH, 'utf8').catch(() => null)
  assert.ok(refMd, '缺少 skills/team/references/skill-dispatch.md')
  assertDispatchMatrix(refMd, 'skills/team/references/skill-dispatch.md', dirs)
})

test('能力矩阵：docs/capability-matrix.md 存在且含四类能力、降级列与判别陷阱', async () => {
  const md = await readFile(CAPABILITY_MATRIX_PATH, 'utf8').catch(() => null)
  assert.ok(md, '缺少 docs/capability-matrix.md（R3 能力降级矩阵）')
  assert.ok(md.includes(MATRIX_HEADER), `能力矩阵缺少冻结表头：${MATRIX_HEADER}`)
  for (const token of MATRIX_TOKENS) assert.ok(md.includes(token), `能力矩阵缺少 token：${token}`)

  // round-4：H2 行锚定——「团队双通道」+ `spawn_teammate` 必须与 subagent/subagent_fork 在**同一张表格行**上（禁止跨行或文件任意位置拼凑）
  const lines = md.split(/\r?\n/)
  const subagentCapRows = lines.filter((l) => l.trimStart().startsWith('|') && l.includes('subagent') && l.includes('subagent_fork'))
  assert.ok(subagentCapRows.length > 0, 'H2：能力矩阵缺少 subagent + subagent_fork 能力行')
  assert.ok(subagentCapRows.some((l) => l.includes('团队双通道') && l.includes('spawn_teammate')),
    'H2：subagent/subagent_fork 能力行必须同一行含「团队双通道」与 spawn_teammate（禁止跨行拼凑）')

  // 配对：同一行同时含 send_message + target + agent_id（团队版 / 旧全局版判别）
  assert.ok(lines.some((l) => l.includes('send_message') && l.includes('target') && l.includes('agent_id')),
    '缺少 send_message 判别行（须同行含 target 与 agent_id）')
})

test('降级指针契约：20 文件逐字指针 + review 通道条件行 + ralph 提及守卫（非空洞自测）', async () => {
  // 17 skills + 3 roles：指针行 H1+2 逐字相等；4 个评审技能另有 H1+3 条件行
  for (const name of SKILL_PTR_FILES) {
    const file = `skills/${name}/SKILL.md`
    const content = await readFile(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')
    assertPointerLine(content, file, PTR_SKILL, COND_REVIEW_FILES.includes(name))
  }
  for (const name of ROLE_PTR_FILES) {
    const file = `roles/${name}.md`
    const content = await readFile(path.join(ROLES_DIR, `${name}.md`), 'utf8')
    assertPointerLine(content, file, PTR_ROLE, false)
  }

  // 非空洞自测：夹具只含反引号写法、无条件、无矩阵路径
  const FIXTURE = '# x\n\n正文：DSH 原生 `ralph` 工具 可直接使用。\n'
  assert.ok(RALPH_MENTION_RE.test(FIXTURE) && RALPH_CLAIM_RE.test(FIXTURE), '守卫必须命中反引号写法（夹具自测）')
  assert.throws(() => assertRalphPointer(FIXTURE, 'fixture'), /必须给出降级指针/, '缺指针的夹具必须失败（非空洞自测）')
  assert.throws(() => assertRalphSameLine(FIXTURE, 'fixture'), /必须同句给出降级条件/, '无条件 claim 夹具必须失败（非空洞自测）')

  // rework 反例夹具：锁住两个已修绕过
  // (a) 裸提及以全角句号结尾（旧尾部类别漏判 → 文件级规则静默）
  const PUNCT_FIXTURE = '# x\n\n正文：可用 `ralph`。\n'
  assert.ok(RALPH_MENTION_RE.test(PUNCT_FIXTURE), '守卫必须命中以全角句号结尾的裸提及（夹具自测）')
  assert.throws(() => assertRalphPointer(PUNCT_FIXTURE, 'fixture'), /必须给出降级指针/, '全角标点结尾的裸提及也必须给出指针（非空洞自测）')
  assert.throws(() => assertRalphSameLine(PUNCT_FIXTURE, 'fixture'), /必须同句给出降级条件/, '全角标点结尾的裸提及也必须同句给出降级（非空洞自测）')
  // (b) 裸 `若` 不是降级条件（旧 DEGRADE_RE 会误放行）
  const RUO_FIXTURE = '# x\n\n正文：若用户点名则用 `ralph` 工具。\n'
  assert.ok(RALPH_CLAIM_RE.test(RUO_FIXTURE), '同句规则必须命中该 claim 行（夹具自测）')
  assert.throws(() => assertRalphSameLine(RUO_FIXTURE, 'fixture'), /必须同句给出降级条件/, '裸「若」不构成降级条件（非空洞自测）')

  // round-3 B1：QA 判定为「通过但为假」的 4 类形态（+跨行变体）必须全部被守卫拒绝（RED 夹具）
  const QA_FIXTURES = [
    ['裸断言', '# x\n\n正文：ralph 已挂载。\n'],
    ['大小写', '# x\n\n正文：Ralph 工具已挂载，可直接用。\n'],
    ['英文措辞', '# x\n\n正文：the ralph tool is mounted and available.\n'],
    ['表格单元格', '# x\n\n| 能力 | 状态 |\n| --- | --- |\n| `ralph` | 已挂载 |\n'],
    ['跨行', '# x\n\n能力：`ralph`\n已挂载，可直接用。\n'],
  ]
  for (const [shape, fixture] of QA_FIXTURES) {
    assert.ok(RALPH_MENTION_RE.test(fixture), `mentions 规则必须命中 QA 形态：${shape}`)
    assert.ok(RALPH_CLAIM_RE.test(fixture), `claim 规则必须命中 QA 形态：${shape}`)
    assert.throws(() => assertRalphPointer(fixture, 'fixture'), /必须给出降级指针/, `QA 形态必须因缺指针失败：${shape}`)
    assert.throws(() => assertRalphSameLine(fixture, 'fixture'), /必须同句给出降级条件/, `QA 形态必须因缺同句降级失败：${shape}`)
  }
  // 排除项仍须成立：`visual-ralph` 与 ralph 标识符不触发提及规则
  assert.equal(RALPH_MENTION_RE.test('# x\n\n见 visual-ralph 技能。\n'), false, '`visual-ralph` 不得触发提及规则（排除项）')
  assert.equal(RALPH_MENTION_RE.test('# x\n\n读 ralph-progress.json。\n'), false, '`ralph-progress.json` 标识符不得触发提及规则（排除项）')

  // (i) 文件级 + (ii) 同句级：扫全部 skills/*/SKILL.md + roles/*.md + skills/*/references/*.md
  const targets = (await skillDirs()).map((d) => path.join(SKILLS_DIR, d, 'SKILL.md'))
  for (const f of await roleFiles()) targets.push(f)
  const refs = await referenceFiles()
  assert.ok(refs.length > 0, '扫描面必须包含 skills/*/references/*.md（当前应含 skills/team/references/skill-dispatch.md）')
  for (const f of refs) targets.push(f)
  for (const abs of targets) {
    const label = path.relative(PKG_ROOT, abs).split(path.sep).join('/')
    const content = await readFile(abs, 'utf8')
    assertRalphPointer(content, label)
    assertRalphSameLine(content, label)
  }
})

test('团队桥接：doctor 探测面与动态插件降级 / cancel 任务板收尾 / ultragoal R5 三层分工', async () => {
  const DYNAMIC_PLUGIN_RE = /动态插件[^\n]{0,160}(未挂载|否则|替代|不可用)/

  const doctor = await readFile(path.join(SKILLS_DIR, 'doctor', 'SKILL.md'), 'utf8')
  for (const token of ['可选能力探测', 'cordis_inspect_query', 'cordis_inspect_self', 'cordis_stop',
    'subagent_codex', 'subagent_claude_code', 'docs/capability-matrix.md']) {
    assert.ok(doctor.includes(token), `doctor 缺 ${token}`)
  }
  assert.match(doctor, DYNAMIC_PLUGIN_RE, 'doctor 动态插件行缺少邻近降级表述（未挂载/否则/替代/不可用）')

  const cancel = await readFile(path.join(SKILLS_DIR, 'cancel', 'SKILL.md'), 'utf8')
  for (const token of ['team_task_list', 'manifest.v2.json', 'tasks.json', 'inbox.md', 'interrupt_agent']) {
    assert.ok(cancel.includes(token), `cancel 缺 ${token}`)
  }
  assert.match(cancel, DYNAMIC_PLUGIN_RE, 'cancel 动态插件行缺少邻近降级表述（未挂载/否则/替代/不可用）')

  const ultragoal = await readFile(path.join(SKILLS_DIR, 'ultragoal', 'SKILL.md'), 'utf8')
  for (const token of ['team_task_create', 'team_task_list', 'team_task_update', 'spawn_teammate',
    '执行任务', '审计证据', '目标状态', 'docs/capability-matrix.md']) {
    assert.ok(ultragoal.includes(token), `ultragoal 缺 ${token}`)
  }
})

test('元数据与文档一致性：version 1.5.0 / files / dshVersions / capability 见证 / CHANGELOG / docs entry / README.zh', async () => {
  const pkgRaw = await readFile(path.join(PKG_ROOT, 'package.json'), 'utf8')
  const pkg = JSON.parse(pkgRaw)
  assert.equal(pkg.version, '1.5.0')
  for (const f of ['test', 'CHANGELOG.md', 'docs']) {
    assert.ok(pkg.files.includes(f), `package.json files 应含 ${f}（实际：${JSON.stringify(pkg.files)}）`)
  }
  assert.ok(pkg.dshWorkshop.compatibility.dshVersions.includes('0.2.0-rc.1'),
    `dshVersions 应含 0.2.0-rc.1（实际：${JSON.stringify(pkg.dshWorkshop.compatibility.dshVersions)}）`)
  assert.ok(pkgRaw.includes('spawn_teammate'), 'package.json 原文应含 spawn_teammate 能力见证（L5）')

  const changelog = await readFile(path.join(PKG_ROOT, 'CHANGELOG.md'), 'utf8')
  assert.ok(changelog.includes('## [1.5.0]'), 'CHANGELOG 应含 ## [1.5.0]')
  assert.ok(changelog.includes('releases/tag/v1.5.0'), 'CHANGELOG 应含 releases/tag/v1.5.0')

  const readme = await readFile(README_PATH, 'utf8')
  assert.ok(readme.includes('共 26 技能'), 'README.md 应含「共 26 技能」（回归项）')
  assert.ok(readme.includes('docs/capability-matrix.md'), 'README.md 应含能力矩阵指针')

  const readmeZh = await readFile(path.join(PKG_ROOT, 'README.zh.md'), 'utf8')
  assert.ok(readmeZh.includes('docs/capability-matrix.md'), 'README.zh.md 应含能力矩阵指针')
  assert.equal(readmeZh.includes('v0.1.0 pilot'), false, 'README.zh.md 不得含陈旧「v0.1.0 pilot」句')

  const entry = await readFile(path.join(PKG_ROOT, 'docs', 'awesome-dsh-plugin-entry.yml'), 'utf8')
  assert.ok(entry.includes('and 19 more'), 'awesome entry 应含 and 19 more')
  assert.ok(entry.includes('26 个技能'), 'awesome entry 应含 26 个技能')
})
