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
