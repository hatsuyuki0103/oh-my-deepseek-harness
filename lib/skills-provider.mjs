// SPDX-License-Identifier: MIT
// lib/skills-provider.mjs — 包内嵌入式技能提供方（零 DSH 依赖，只读 node:fs）。
//
// 对齐当前 DSH 技能契约（@deepseek-ai/dsh-skill）：
// - 提供方对象 `{ name, list(options), get(candidate, options) }`，工厂同步运行；
// - list() 返回完整发现的候选数组（或 `{ candidates, complete: false }`）；
// - 候选与定义均为只读借用，get() 用候选对象身份（locator.path + 同一分配名）
//   校验归属，拒绝任何非本提供方产出的 candidate；
// - 技能名必须 kebab-case；frontmatter 的 name/description 缺失或为空则跳过该文件
//   （与官方 dsh-skill-filesystem 的「warn + ignore」一致，绝不产出非法候选）。
//
// 发现约定：`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`；
// 显式排除 MEMORY.md / README.md（索引/说明文档，误注册会令技能目录整体失败）。

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export const OMDH_SKILLS_PROVIDER = 'omdsh-skills'

/** 全局技能 rank：低于项目级（280+）与用户根目录（400/500），高于运行时（250）。 */
export const OMDH_SKILLS_RANK = 275

/** DSH 技能名的 kebab-case 模式。 */
export const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 极简 YAML frontmatter 解析：只处理 `---` 包裹的头部与逐行标量键值
 * （支持双/单引号）。无法识别时按「无 meta、正文全文」处理。
 * @param content - 文件全文。
 * @returns `{ meta, body }`。
 */
export function parseFrontmatter(content) {
  if (typeof content !== 'string' || !content.startsWith('---')) return { meta: {}, body: content ?? '' }
  const end = content.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: content }
  const head = content.slice(3, end)
  const body = content.slice(end + 4).replace(/^[\r\n]+/, '')
  const meta = {}
  for (const raw of head.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    meta[m[1]] = value
  }
  return { meta, body }
}

/**
 * 把任意技能名归一化为 kebab-case。
 * @param raw - 原始名称。
 * @param fallback - 归一化结果为空时使用。
 * @returns kebab-case 名称。
 */
export function kebabName(raw, fallback = 'skill') {
  const slug = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return slug.length > 0 ? slug : fallback
}

/**
 * 发现一个技能根目录下的全部技能文件。
 * @param root - 技能根目录。
 * @returns 技能文件绝对路径数组；目录缺失返回空数组。
 */
export async function discoverSkillFiles(root) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const NON_SKILL_FILES = /^(memory|readme)\.md$/i
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(path.join(root, entry.name, 'SKILL.md'))
    } else if (entry.isFile() && entry.name.endsWith('.md') && !NON_SKILL_FILES.test(entry.name)) {
      files.push(path.join(root, entry.name))
    }
  }
  return files
}

/**
 * 读取一个技能文件（SKILL.md 或扁平 .md）。
 * @param file - 绝对路径。
 * @returns `{ name, description, argumentHint?, content, path, meta }` 或 null。
 */
export async function readSkillFile(file) {
  try {
    const content = await readFile(file, 'utf8')
    const { meta, body } = parseFrontmatter(content)
    if (!body.trim()) return null
    const name = String(meta.name ?? path.basename(file).replace(/\.md$/, '')).trim()
    const description = String(meta.description ?? '').trim()
    if (!name || !description) return null
    const argumentHint = typeof meta['argument-hint'] === 'string' ? meta['argument-hint'].trim() : undefined
    return {
      name,
      description,
      ...(argumentHint ? { argumentHint } : {}),
      content: body,
      path: file,
      meta,
    }
  } catch {
    return null
  }
}

/**
 * 构造包内嵌入式技能 SkillProvider。
 * @param options - `{ roots: string[], provider?: string, rank?: number, maxSkills?: number }`。
 * @returns `{ name, list, get }`；candidate.locator 为 `{ path }`。
 */
export function makeEmbeddedSkillsProvider({
  roots,
  provider = OMDH_SKILLS_PROVIDER,
  rank = OMDH_SKILLS_RANK,
  maxSkills = 100,
}) {
  // path → { candidate, assignedName }：跨 list() 调用保持候选对象身份稳定。
  const owned = new Map()

  return {
    name: provider,
    async list(options = {}) {
      const signal = options?.signal
      signal?.throwIfAborted()

      const files = []
      for (const root of roots) {
        signal?.throwIfAborted()
        for (const file of await discoverSkillFiles(root)) files.push(file)
      }

      const skills = []
      for (const file of files) {
        signal?.throwIfAborted()
        const skill = await readSkillFile(file)
        if (skill) skills.push(skill)
      }

      // 全集上分配 kebab 名：冲突（含字面 -2 撞名）追加 -2/-3 后缀。
      const taken = new Set()
      const assigned = new Map()
      for (const skill of skills) {
        const base = kebabName(skill.name)
        let finalName = base
        let n = 2
        while (taken.has(finalName)) finalName = `${base}-${n++}`
        taken.add(finalName)
        assigned.set(skill.path, finalName)
      }

      const candidates = []
      const seen = new Set()
      for (const skill of skills) {
        signal?.throwIfAborted()
        const finalName = assigned.get(skill.path)
        const prev = owned.get(skill.path)
        if (prev && prev.assignedName === finalName) {
          candidates.push(prev.candidate)
        } else {
          const candidate = {
            name: finalName,
            description: skill.description,
            ...(skill.argumentHint ? { whenToUse: `argument hint: ${skill.argumentHint}` } : {}),
            invocation: { modelInvocable: true, userInvocable: true },
            provider,
            source: 'omdsh',
            resourceBase: { kind: 'directory', path: path.dirname(skill.path) },
            rank,
            locator: { path: skill.path },
            path: skill.path,
            metadata: skill.meta,
          }
          owned.set(skill.path, { candidate, assignedName: finalName })
          candidates.push(candidate)
        }
        seen.add(skill.path)
      }
      for (const filePath of [...owned.keys()]) {
        if (!seen.has(filePath)) owned.delete(filePath)
      }
      return candidates.sort((a, b) => a.name.localeCompare(b.name)).slice(0, maxSkills)
    },
    async get(candidate, options = {}) {
      options?.signal?.throwIfAborted()
      const prev = candidate?.locator?.path ? owned.get(candidate.locator.path) : undefined
      if (!prev || prev.candidate !== candidate) return undefined
      const skill = await readSkillFile(candidate.locator.path)
      if (!skill) return undefined
      return {
        name: candidate.name,
        description: candidate.description,
        ...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
        invocation: { modelInvocable: true, userInvocable: true },
        provider,
        source: candidate.source,
        resourceBase: candidate.resourceBase,
        content: skill.content,
        path: skill.path,
        metadata: skill.meta,
      }
    },
  }
}
