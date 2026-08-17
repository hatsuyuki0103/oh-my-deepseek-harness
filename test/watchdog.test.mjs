// SPDX-License-Identifier: MIT
// test/watchdog.test.mjs — Hindsight daemon 守护契约测试。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  shouldWatch,
  isDaemonHealthy,
  resolveDaemonStartPath,
  makeSpawnDaemon,
  runWatchdog,
} from '../lib/watchdog.mjs'

test('shouldWatch：daemon 模式才守护', () => {
  assert.equal(shouldWatch('{"serverMode":"daemon"}'), true)
  assert.equal(shouldWatch('{"serverMode":"daemon","disabled":true}'), false)
  assert.equal(shouldWatch('{"serverMode":"cloud"}'), false)
  assert.equal(shouldWatch('{"serverMode":"self-hosted"}'), false)
  assert.equal(shouldWatch(''), false)
  assert.equal(shouldWatch('not json'), false)
  assert.equal(shouldWatch(null), false)
})

test('isDaemonHealthy：可达且 200 为健康，超时/拒绝为不健康', async () => {
  // 指向必然拒绝连接的地址 → 不健康（不等待 1.5s）
  const unhealthy = await isDaemonHealthy('http://127.0.0.1:1/health', 800)
  assert.equal(unhealthy, false)
  // 用一个临时 HTTP server 证明健康判定
  const http = await import('node:http')
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    const healthy = await isDaemonHealthy(`http://127.0.0.1:${port}/health`, 1500)
    assert.equal(healthy, true)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('resolveDaemonStartPath：配置优先，其次环境变量，再默认 profile 路径', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'omdsh-wd-'))
  try {
    const real = path.join(dir, 'daemon-start.js')
    await writeFile(real, '')
    // 显式配置命中
    assert.equal(resolveDaemonStartPath({ daemonStartPath: real }), real)
    // 配置优先于环境变量
    const prev = process.env.HINDSIGHT_DAEMON_START_PATH
    process.env.HINDSIGHT_DAEMON_START_PATH = real
    try {
      assert.equal(resolveDaemonStartPath({ daemonStartPath: real }), real)
    } finally {
      if (prev === undefined) delete process.env.HINDSIGHT_DAEMON_START_PATH
      else process.env.HINDSIGHT_DAEMON_START_PATH = prev
    }
    // 不存在 → null（用临时 DSH_HOME 隔离默认 profile 路径，避免本机真实文件命中）
    const prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      assert.equal(resolveDaemonStartPath({ daemonStartPath: path.join(dir, 'missing.js') }), null)
    } finally {
      if (prevHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prevHome
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('makeSpawnDaemon：健康时跳过；未健康时用同一条启动链 + windowsHide', async () => {
  let captured = null
  const fakeSpawn = (cmd, args, opts) => {
    captured = { cmd, args, opts }
    return { on: () => {}, unref: () => {} }
  }
  // 不健康（端口 1）→ spawn
  const spawnDaemon = makeSpawnDaemon({ spawnFn: fakeSpawn, healthUrl: 'http://127.0.0.1:1/health', log: () => {} })
  const started = await spawnDaemon('C:/fake/daemon-start.js')
  assert.equal(started, true)
  assert.ok(captured, '应触发 spawn')
  assert.equal(captured.args[0], 'C:/fake/daemon-start.js')
  assert.equal(captured.args[1], '--harness')
  assert.equal(captured.args[2], 'dsh')
  assert.equal(captured.opts.detached, true)
  assert.equal(captured.opts.windowsHide, true)
  assert.equal(captured.opts.env.NO_PROXY, '*')
  assert.equal(captured.opts.env.HF_ENDPOINT, 'https://hf-mirror.com')
})

test('runWatchdog：三态决策端到端（配置驱动）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'omdsh-wdr-'))
  try {
    const cfgPath = path.join(dir, 'coding-agent.json')
    // ① 非 daemon 配置 → 不守护
    await writeFile(cfgPath, '{"serverMode":"cloud"}')
    let r = await runWatchdog({ configPath: cfgPath, healthUrl: 'http://127.0.0.1:1/health' })
    assert.deepEqual(r, { watched: false, reason: 'not-daemon-mode' })
    // ② daemon 配置 + 不健康 → 尝试拉起（spawn 会失败，但决策应走到 spawn 分支）
    await writeFile(cfgPath, '{"serverMode":"daemon"}')
    const startPath = path.join(dir, 'daemon-start.js')
    await writeFile(startPath, '')
    let spawned = false
    r = await runWatchdog({
      configPath: cfgPath,
      daemonStartPath: startPath,
      healthUrl: 'http://127.0.0.1:1/health',
      spawnDaemon: async () => { spawned = true; return true },
    })
    assert.equal(r.watched, true)
    assert.equal(r.reason, 'spawned')
    assert.equal(spawned, true)
    // ③ daemon 配置 + 健康 → 跳过
    const http = await import('node:http')
    const server = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    try {
      r = await runWatchdog({ configPath: cfgPath, daemonStartPath: startPath, healthUrl: `http://127.0.0.1:${port}/health` })
      assert.deepEqual(r, { watched: true, started: false, reason: 'already-healthy' })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
