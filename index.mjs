// SPDX-License-Identifier: MIT
// index.mjs — oh-my-deepseek-harness host 插件入口。
//
// 两件事：
// 1. 把包内 skills/*/SKILL.md 注册为 DSH 技能提供方（惰性加载）。
//    技能目录只暴露 name/description 摘要，正文在 skill 工具加载时按需读取；
//    新增技能 = 往 skills/ 目录加一个 <name>/SKILL.md，无需改任何代码。
// 2. Hindsight 本地 daemon 守护（升级免疫兜底）：daemon 模式且 9077 未健康时静默拉起。
//
// 只消费公开服务：skills（硬依赖）。所有生命周期贡献（registerProvider）
// 都随 Fiber 自动拆除，无进程级副作用。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeEmbeddedSkillsProvider } from './lib/skills-provider.mjs'
import { runWatchdog } from './lib/watchdog.mjs'

export const name = 'omdsh-skills'

export const inject = ['skills']

/**
 * 挂载插件：注册嵌入式技能提供方 + Hindsight daemon 守护。
 * @param ctx - Cordis 上下文。
 * @param config - cordis.yml 行内配置（可覆盖）：
 *   - enableSkills: boolean（默认 true）
 *   - extraSkillDirs: string[]（额外技能根目录，默认空）
 *   - maxSkills: number（目录条目上限，默认 100）
 *   - enableHindsightWatchdog: boolean（默认 true；false 关闭守护）
 *   - daemonStartPath: string（daemon-start.js 显式路径，覆盖自动解析）
 */
export function apply(ctx, config = {}) {
  if (config.enableSkills === false) return
  const roots = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills'),
    ...(Array.isArray(config.extraSkillDirs) ? config.extraSkillDirs : []),
  ]
  ctx.skills.registerProvider(() => makeEmbeddedSkillsProvider({
    roots,
    provider: 'omdsh-skills',
    maxSkills: Number.isInteger(config.maxSkills) ? config.maxSkills : 100,
  }))
  if (config.enableHindsightWatchdog !== false) {
    runWatchdog({ daemonStartPath: config.daemonStartPath }).catch((e) => {
      console.error('[omdsh] hindsight watchdog:', String((e && e.message) || e))
    })
  }
}
