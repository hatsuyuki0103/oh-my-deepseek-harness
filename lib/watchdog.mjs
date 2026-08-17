// SPDX-License-Identifier: MIT
// lib/watchdog.mjs — Hindsight 本地 daemon 守护（oh-my-deepseek-harness 的升级免疫兜底）。
//
// 与 Hindsight 插件的自动拉起同一条启动链（node daemon-start.js --harness dsh），
// 幂等由 daemon-start.js 内部的健康自守卫背书；本守护只做三件事：
//   1. shouldWatch —— 配置是 daemon 模式才守护；
//   2. isDaemonHealthy —— 9077 /health 探活；
//   3. spawnDaemon —— 未健康时静默拉起（detached + windowsHide + 关键环境变量）。
// 决策逻辑纯函数化，便于契约测试；apply 时只跑一次，不设定时器。

import { spawn } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HINDSIGHT_CONFIG_PATH = process.env.HINDSIGHT_CONFIG || join(homedir(), '.hindsight', 'coding-agent.json')
export const DEFAULT_HEALTH_URL = 'http://127.0.0.1:9077/health'

/**
 * 决策一：配置是否要求守护（serverMode==='daemon' 且未 disabled）。
 * @param {string} configText - ~/.hindsight/coding-agent.json 原文。
 * @returns {boolean}
 */
export function shouldWatch(configText) {
  if (typeof configText !== 'string' || !configText.trim()) return false
  try {
    const cfg = JSON.parse(configText)
    return cfg.serverMode === 'daemon' && cfg.disabled !== true
  } catch {
    return false
  }
}

/**
 * 探活：GET /health，超时视为不健康。
 * @param {string} healthUrl
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function isDaemonHealthy(healthUrl = DEFAULT_HEALTH_URL, timeoutMs = 1500) {
  try {
    const r = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch {
    return false
  }
}

/**
 * 定位 hindsight daemon-start.js：配置 → 环境变量 → profiles/* glob 首命中，返回第一个存在的。
 * @param {{ daemonStartPath?: string }} overrides
 * @returns {string | null}
 */
export function resolveDaemonStartPath(overrides = {}) {
  const candidates = []
  if (overrides.daemonStartPath) candidates.push(overrides.daemonStartPath)
  const envPath = process.env.HINDSIGHT_DAEMON_START_PATH
  if (envPath) candidates.push(envPath)
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profilesRoot = join(dshHome, 'profiles')
  if (existsSync(profilesRoot)) {
    try {
      for (const profile of readdirSync(profilesRoot, { withFileTypes: true })) {
        if (!profile.isDirectory()) continue
        candidates.push(
          join(profilesRoot, profile.name, 'node_modules', '@vectorize-io', 'hindsight-coding-agents', 'dist', 'daemon-start.js')
        )
      }
    } catch {
      // 扫描失败则回落到下方候选
    }
  }
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return null
}

/**
 * 构造 spawnDaemon：健康则跳过；否则 detached + windowsHide 拉起同一条启动链。
 * 可注入 spawnFn 便于测试断言参数形状。
 * @param {{ spawnFn?: Function, healthUrl?: string, log?: Function }} opts
 * @returns {(startPath: string, env?: object) => Promise<boolean>}
 */
export function makeSpawnDaemon({ spawnFn = spawn, healthUrl = DEFAULT_HEALTH_URL, log = console.error } = {}) {
  return async function spawnDaemon(startPath, env = {}) {
    if (!startPath) {
      log('[omdsh-watchdog] daemon-start.js not found; skip')
      return false
    }
    if (await isDaemonHealthy(healthUrl)) return true
    return new Promise((resolve) => {
      try {
        const child = spawnFn(process.execPath, [startPath, '--harness', 'dsh'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: { ...process.env, NO_PROXY: '*', HF_ENDPOINT: 'https://hf-mirror.com', ...env },
        })
        child.on('error', (e) => {
          log('[omdsh-watchdog] spawn error: ' + e.message)
          resolve(false)
        })
        child.unref()
        resolve(true)
      } catch (e) {
        log('[omdsh-watchdog] ' + e.message)
        resolve(false)
      }
    })
  }
}

/**
 * 守护入口：读取配置 → 决策 → 探活 → 拉起。返回结构化结果供测试/日志。
 * @param {{ configText?: string, configPath?: string, healthUrl?: string, timeoutMs?: number, daemonStartPath?: string, spawnDaemon?: Function, spawnEnv?: object }} opts
 */
export async function runWatchdog(opts = {}) {
  try {
    const configPath = opts.configPath ?? HINDSIGHT_CONFIG_PATH
    const configText = opts.configText ?? (existsSync(configPath) ? readFileSync(configPath, 'utf8') : '')
    if (!shouldWatch(configText)) return { watched: false, reason: 'not-daemon-mode' }
    const startPath = resolveDaemonStartPath(opts)
    if (!startPath) return { watched: true, started: false, reason: 'daemon-start-not-found' }
    const healthy = await isDaemonHealthy(opts.healthUrl ?? DEFAULT_HEALTH_URL, opts.timeoutMs ?? 1500)
    if (healthy) return { watched: true, started: false, reason: 'already-healthy' }
    const spawnDaemon = opts.spawnDaemon ?? makeSpawnDaemon(opts)
    const started = await spawnDaemon(startPath, opts.spawnEnv)
    return { watched: true, started, reason: started ? 'spawned' : 'spawn-failed' }
  } catch (e) {
    return { watched: false, reason: 'error:' + e.message }
  }
}
