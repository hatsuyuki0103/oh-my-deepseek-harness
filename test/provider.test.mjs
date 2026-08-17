// SPDX-License-Identifier: MIT
// test/provider.test.mjs — oh-my-deepseek-harness 技能提供方契约测试。
// 运行：node --test "test/*.test.mjs"
// 覆盖：frontmatter 解析、kebab 归一化、技能发现、候选/定义形状、
// 候选对象身份校验、重名去重，以及插件入口的导出形态。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OMDH_SKILLS_PROVIDER,
  OMDH_SKILLS_RANK,
  KEBAB_RE,
  parseFrontmatter,
  kebabName,
  discoverSkillFiles,
  readSkillFile,
  makeEmbeddedSkillsProvider,
} from '../lib/skills-provider.mjs'
import * as plugin from '../index.mjs'

const PKG_SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills')

test('插件入口导出形态符合 cordis 约定', () => {
  assert.equal(plugin.name, 'omdsh-skills')
  assert.deepEqual(plugin.inject, ['skills'])
  assert.equal(typeof plugin.apply, 'function')
})

test('parseFrontmatter：标准头部 + 引号值 + 无头部', () => {
  const doc = [
    '---',
    'name: demo-skill',
    'description: "带引号的描述"',
    "argument-hint: '[--fast] <arg>'",
    'level: 2',
    '---',
    '',
    '# 正文',
  ].join('\n')
  const { meta, body } = parseFrontmatter(doc)
  assert.equal(meta.name, 'demo-skill')
  assert.equal(meta.description, '带引号的描述')
  assert.equal(meta['argument-hint'], '[--fast] <arg>')
  assert.equal(meta.level, '2')
  assert.equal(body, '# 正文')
})

test('parseFrontmatter：无头部时正文全文返回', () => {
  const { meta, body } = parseFrontmatter('# 没有头部\n正文')
  assert.deepEqual(meta, {})
  assert.equal(body, '# 没有头部\n正文')
})

test('kebabName：归一化与兜底', () => {
  assert.equal(kebabName('Deep Interview'), 'deep-interview')
  assert.equal(kebabName('deep_interview'), 'deep-interview')
  assert.equal(kebabName('  Deep--Interview!! '), 'deep-interview')
  assert.equal(kebabName('---'), 'skill')
})

test('真实技能目录：全部技能被发现且 frontmatter 合法、kebab 唯一', async () => {
  const files = await discoverSkillFiles(PKG_SKILLS_DIR)
  const EXPECTED_SKILLS = [
    'deep-interview', 'plan', 'ralplan', 'prometheus-strict',
    'ralph', 'autopilot', 'team', 'ultrawork', 'ultragoal', 'ultraqa',
    'code-review', 'security-review', 'analyze', 'build-fix', 'tdd',
    'ai-slop-cleaner', 'git-master', 'design',
    'cancel', 'doctor', 'note', 'skill-authoring', 'ecomode',
  ]
  assert.ok(files.length >= EXPECTED_SKILLS.length, `至少应发现 ${EXPECTED_SKILLS.length} 个技能，实际 ${files.length}`)
  const names = new Set()
  for (const file of files) {
    const skill = await readSkillFile(file)
    assert.ok(skill, `技能文件可解析：${file}`)
    assert.ok(skill.name.length > 0 && skill.description.length > 0, `name/description 非空：${file}`)
    assert.match(skill.name, KEBAB_RE, `技能名必须 kebab-case：${skill.name}`)
    assert.ok(!names.has(skill.name), `技能名重复：${skill.name}`)
    names.add(skill.name)
    assert.ok(skill.content.length > 0, `正文非空：${skill.name}`)
  }
  for (const expected of EXPECTED_SKILLS) {
    assert.ok(names.has(expected), `应包含技能 ${expected}，实际：${[...names].join(', ')}`)
  }
})

test('提供方 list/get 契约：候选形状、惰性加载、身份校验', async () => {
  const provider = makeEmbeddedSkillsProvider({ roots: [PKG_SKILLS_DIR] })
  assert.equal(provider.name, OMDH_SKILLS_PROVIDER)

  const candidates = await provider.list()
  const EXPECTED_SKILLS = [
    'deep-interview', 'plan', 'ralplan', 'prometheus-strict',
    'ralph', 'autopilot', 'team', 'ultrawork', 'ultragoal', 'ultraqa',
    'code-review', 'security-review', 'analyze', 'build-fix', 'tdd',
    'ai-slop-cleaner', 'git-master', 'design',
    'cancel', 'doctor', 'note', 'skill-authoring', 'ecomode',
  ]
  assert.ok(Array.isArray(candidates) && candidates.length >= EXPECTED_SKILLS.length)
  const byName = new Map(candidates.map((c) => [c.name, c]))
  for (const expected of EXPECTED_SKILLS) {
    assert.ok(byName.has(expected), `候选目录应包含 ${expected}`)
    assert.equal(byName.get(expected).provider, OMDH_SKILLS_PROVIDER)
    assert.equal(byName.get(expected).source, 'omdsh')
    assert.equal(byName.get(expected).rank, OMDH_SKILLS_RANK)
    assert.deepEqual(byName.get(expected).invocation, { modelInvocable: true, userInvocable: true })
    assert.ok(byName.get(expected).locator && typeof byName.get(expected).locator.path === 'string')
  }

  const di = byName.get('deep-interview')
  const loaded = await provider.get(di)
  assert.ok(loaded)
  assert.equal(loaded.name, 'deep-interview')
  assert.ok(loaded.content.includes('ask_user_question'))
  assert.deepEqual(loaded.invocation, { modelInvocable: true, userInvocable: true })

  const rp = byName.get('ralplan')
  const loadedRp = await provider.get(rp)
  assert.ok(loadedRp)
  assert.ok(loadedRp.content.includes('Architect'))

  const ug = byName.get('ultragoal')
  const loadedUg = await provider.get(ug)
  assert.ok(loadedUg)
  assert.ok(loadedUg.content.includes('create_goal'))

  // 伪造候选：不属于本提供方，必须拒绝。
  const forged = await provider.get({ name: 'deep-interview', locator: { path: di.locator.path } })
  assert.equal(forged, undefined)
})

test('重名技能：kebab 冲突追加 -2 后缀', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'omdsh-test-'))
  try {
    await mkdir(path.join(dir, 'a-skill'))
    await mkdir(path.join(dir, 'a.skill'))
    await writeFile(path.join(dir, 'a-skill', 'SKILL.md'), '---\nname: a-skill\ndescription: 第一个\n---\n# 一\n')
    await writeFile(path.join(dir, 'a.skill', 'SKILL.md'), '---\nname: a.skill\ndescription: 第二个\n---\n# 二\n')
    const provider = makeEmbeddedSkillsProvider({ roots: [dir] })
    const candidates = await provider.list()
    const names = candidates.map((c) => c.name).sort()
    assert.deepEqual(names, ['a-skill', 'a-skill-2'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('非法技能文件（缺 name/description）被跳过而不报错', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'omdsh-bad-'))
  try {
    await mkdir(path.join(dir, 'no-desc'))
    await mkdir(path.join(dir, 'good'))
    await writeFile(path.join(dir, 'no-desc', 'SKILL.md'), '---\nname: no-desc\n---\n正文')
    await writeFile(path.join(dir, 'good', 'SKILL.md'), '---\nname: good\ndescription: ok\n---\n正文')
    await writeFile(path.join(dir, 'README.md'), '不是技能')
    const provider = makeEmbeddedSkillsProvider({ roots: [dir] })
    const candidates = await provider.list()
    assert.deepEqual(candidates.map((c) => c.name), ['good'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
