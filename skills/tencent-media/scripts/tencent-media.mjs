#!/usr/bin/env node
/**
 * tencent-media — zero-dependency driver for Tencent Cloud TokenHub Token Plan
 * image & video generation (Seedream / Hy / Vidu images; MiniMax H3 video).
 *
 * Single source of truth for endpoints, model ids, per-model limits, defaults
 * and degradation chains: SKILL.md and README must reference `constants`
 * output instead of repeating any of these literals (machine-asserted).
 *
 * Security discipline: the API key is read from the environment or from
 * ~/.dsh/.credentials.yaml `refs:` (plain, indent-aware, fail-closed). It is
 * never printed: every surface shows maskKey() form only. The Authorization
 * header is only ever sent to *.tencentmaas.com over https unless
 * --allow-any-base is passed explicitly.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------- constants
export const C = {
  defaultHost: 'tokenhub.tencentmaas.com',
  defaultKeyEnv: 'TENCENT_TOKENHUB_API_KEY',
  ep: {
    seedream: '/v1/wand/si-image/generation',
    hyImage: '/v1/wand/hunyuan-image/v3-generation',
    viduImage: '/v1/wand/vidu-image/generation',
    viduImageTask: '/v1/wand/vidu-image/tasks/',
    videoV1: '/v1/wand/minimax-video/generation',
    videoV1Task: '/v1/wand/minimax-video/tasks/',
    videoV2: '/v1/wand/minimax-video-v2/generation',
    videoV2Task: '/v1/wand/minimax-video-v2/tasks/',
  },
  models: {
    image: ['vidu-image-q2', 'seedream-image-v5.0-pro', 'seedream-image-v5.0-lite', 'hy-image-v3'],
    imageSync: ['seedream-image-v5.0-pro', 'seedream-image-v5.0-lite', 'hy-image-v3'],
    imageAsync: ['vidu-image-q2'],
    videoV2: ['minimax-video-h3-max', 'minimax-video-h3'],
    videoV1: ['minimax-video-v2.3', 'minimax-video-v2.3-fast'],
    video: ['minimax-video-h3-max', 'minimax-video-h3', 'minimax-video-v2.3', 'minimax-video-v2.3-fast'],
  },
  limits: {
    promptChars: { 'vidu-image-q2': 2000, 'seedream-image-v5.0-pro': 600, 'seedream-image-v5.0-lite': 600, 'hy-image-v3': 8192 },
    refImages: { 'vidu-image-q2': 7, 'seedream-image-v5.0-pro': 10, 'seedream-image-v5.0-lite': 14, 'hy-image-v3': 3 },
    refMinSide: 128,
    refMaxAspect: 4,
    imageAspect: ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9', '2:3', '3:2', 'auto'],
    imageResolution: ['1080p', '2K', '4K'],
    seedreamSizeBuckets: ['1K', '1.5K', '2K', '3K', '4K'],
    seedreamPixelWindow: [921600, 4624220],
    seedreamAspectRange: [1 / 16, 16],
    hySideRange: [512, 2048],
    hyAreaMax: 1024 * 1024,
    videoDuration: {
      'minimax-video-h3-max': [5, 15],
      'minimax-video-h3': [4, 15],
      'minimax-video-v2.3': [6, 10],
      'minimax-video-v2.3-fast': [6, 10],
    },
    videoResolution: {
      'minimax-video-h3-max': ['480P', '768P'],
      'minimax-video-h3': ['768P', '2K'],
      'minimax-video-v2.3': ['768P', '1080P'],
      'minimax-video-v2.3-fast': ['768P', '1080P'],
    },
    videoRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
  },
  degrade: {
    image: ['vidu-image-q2', 'seedream-image-v5.0-pro', 'seedream-image-v5.0-lite', 'hy-image-v3'],
    video: ['minimax-video-h3-max', 'minimax-video-h3', 'minimax-video-v2.3'],
  },
  defaults: {
    imageModel: 'seedream-image-v5.0-pro',
    imageAspect: '4:3',
    imageResolution: '2K',
    seedreamSize: '2K',
    hySize: '1024x1024',
    videoModel: 'minimax-video-h3-max',
    videoResolution: '768P',
    videoRatio: '16:9',
    durationDefault: 15,
    segMin: 5,
    segMax: 15,
    pollMs: 5000,
    timeoutImageS: 600,
    timeoutVideoS: 1800,
    outDir: 'outputs/media',
  },
  caps: {
    providerImageBytes: 30 * 1024 * 1024,
    inlineRawBytes: 12 * 1024 * 1024,
    totalEncodedBytes: 20 * 1024 * 1024,
    maxTotalDurationS: 300,
    maxSegments: 20,
  },
  mime: { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' },
  localVideoExts: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
  localAudioExts: ['.mp3', '.wav', '.aac', '.flac', '.m4a'],
}

// ---------------------------------------------------------------- pure helpers
export function maskKey(key) {
  if (typeof key !== 'string' || key.length === 0) return '<none>'
  if (key.length < 12) return `*${key.length}`
  return `${key.slice(0, 4)}…(${key.length})`
}

export function mimeOf(path) {
  const m = C.mime[extname(path).toLowerCase()]
  if (!m) throw Object.assign(new Error(`unsupported image extension: ${extname(path) || '(none)'}`), { code: 'MIME' })
  return m
}

/** Width/height straight out of a PNG IHDR or JPEG SOF header (validation only). */
export function imageHeaderSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  return undefined
}

export function readDataUri(path, { capBytes = C.caps.inlineRawBytes } = {}) {
  const buf = readFileSync(path)
  if (buf.length > capBytes) {
    throw Object.assign(new Error(`image ${basename(path)} is ${buf.length} bytes > inline cap ${capBytes}; compress it first`), { code: 'IMAGE_TOO_LARGE', bytes: buf.length })
  }
  const mime = mimeOf(path)
  const data = `data:${mime};base64,${buf.toString('base64')}`
  return { mime, bytes: buf.length, encodedLen: data.length, uri: data, size: imageHeaderSize(buf) }
}

/** Parse "WxH" (either separator) into numbers; throws USAGE. */
export function parseSize(size) {
  const m = /^(\d{3,5})\s*[xX*×]\s*(\d{3,5})$/.exec(String(size ?? '').trim())
  if (!m) throw Object.assign(new Error(`--size must look like 2352x1760, got ${JSON.stringify(size)}`), { code: 'USAGE' })
  return { width: Number(m[1]), height: Number(m[2]) }
}

/** Per-model size legality, enforced before any paid call. */
export function assertSizeForModel(model, flags) {
  if (model === 'hy-image-v3') {
    const size = flags.size ?? C.defaults.hySize
    const { width, height } = parseSize(size)
    const area = width * height
    if (area > C.limits.hyAreaMax) {
      throw Object.assign(new Error(`${model}: ${size} is ${area}px, over the ${C.limits.hyAreaMax}px ceiling (1024x1024); pick a smaller canvas or another model (see constants)`), { code: 'USAGE', area, cap: C.limits.hyAreaMax })
    }
    const [lo, hi] = C.limits.hySideRange
    if (width < lo || width > hi || height < lo || height > hi) {
      throw Object.assign(new Error(`${model}: width/height must be within [${lo},${hi}], got ${size}`), { code: 'USAGE' })
    }
    return size
  }
  if (model.startsWith('seedream-image')) {
    const size = flags.size ?? C.defaults.seedreamSize
    if (C.limits.seedreamSizeBuckets.includes(size)) {
      if (model.endsWith('-pro') && ['3K', '4K'].includes(size)) {
        throw Object.assign(new Error(`${model}: bucket ${size} is not offered by the pro model (1K/1.5K/2K)`), { code: 'USAGE' })
      }
      return size
    }
    const { width, height } = parseSize(size)
    const total = width * height
    const [pLo, pHi] = C.limits.seedreamPixelWindow
    if (total < pLo || total > pHi) {
      throw Object.assign(new Error(`${model}: total pixels ${total} outside [${pLo},${pHi}]`), { code: 'USAGE' })
    }
    const [aLo, aHi] = C.limits.seedreamAspectRange
    if (width / height < aLo || width / height > aHi) {
      throw Object.assign(new Error(`${model}: aspect ${(width / height).toFixed(3)} outside [${aLo},${aHi}]`), { code: 'USAGE' })
    }
    return size
  }
  if (flags.size !== undefined) {
    throw Object.assign(new Error(`${model} takes --aspect/--resolution, not --size`), { code: 'USAGE' })
  }
  const aspect = flags.aspect ?? C.defaults.imageAspect
  const resolution = flags.resolution ?? C.defaults.imageResolution
  if (!C.limits.imageAspect.includes(aspect)) {
    throw Object.assign(new Error(`--aspect must be one of ${C.limits.imageAspect.join('/')}, got ${aspect}`), { code: 'USAGE' })
  }
  if (!C.limits.imageResolution.includes(resolution)) {
    throw Object.assign(new Error(`--resolution must be one of ${C.limits.imageResolution.join('/')}, got ${resolution}`), { code: 'USAGE' })
  }
  return undefined
}

export function assertPromptForModel(model, prompt) {
  const cap = C.limits.promptChars[model]
  if (cap === undefined) return
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw Object.assign(new Error(`${model}: --prompt is required`), { code: 'USAGE' })
  }
  if (prompt.length > cap) {
    throw Object.assign(new Error(`${model}: prompt is ${prompt.length} chars, over the ${cap}-char limit; shorten it or pick another model (see constants)`), { code: 'USAGE', promptChars: prompt.length, cap })
  }
}

/** Split a target duration into server-legal segments, evenly. */
export function planSegments(target, { min = C.defaults.segMin, max = C.defaults.segMax, model } = {}) {
  const range = model ? C.limits.videoDuration[model] : undefined
  const lo = range ? range[0] : min
  const hi = range ? range[1] : max
  if (!Number.isFinite(target)) throw Object.assign(new Error('--duration must be a number'), { code: 'USAGE' })
  const t = Math.max(lo, Math.round(target))
  if (t > C.caps.maxTotalDurationS) {
    throw Object.assign(new Error(`total duration ${t}s exceeds cap ${C.caps.maxTotalDurationS}s`), { code: 'USAGE' })
  }
  const n = Math.ceil(t / hi)
  if (n > C.caps.maxSegments) throw Object.assign(new Error(`segment count ${n} exceeds cap ${C.caps.maxSegments}`), { code: 'USAGE' })
  const base = Math.floor(t / n)
  const rem = t % n
  return Array.from({ length: n }, (_, i) => Math.min(hi, Math.max(lo, base + (i < rem ? 1 : 0))))
}

const NON_RESULT_KEYS = /^(request_id|task_id|id|callback_url|trace_id|session_id)$/i
const NON_RESULT_URL = /\/(tasks?|generation)\b|\/callback\b|tencentmaas\.com\/v1\//i
const MEDIA_EXT = /\.(png|jpe?g|webp|bmp|gif|mp4|mov|webm|m4v)(\?|$)/i

/**
 * Deep-walk a provider response and collect produced-media URLs.
 * Guards: skips id-ish keys, task/callback endpoints and any URL passed in
 * `exclude` (so echoed reference images are never mistaken for results).
 */
export function collectUrls(json, { exclude = [] } = {}) {
  const skip = new Set(exclude.filter(u => typeof u === 'string'))
  const loose = []
  const strong = []
  const visit = (node, key) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string') {
      if (!/^https?:\/\//i.test(node)) return
      if (skip.has(node)) return
      if (NON_RESULT_URL.test(node)) return
      if (/^(video_url|url|image_url|download_url)$/i.test(key) || MEDIA_EXT.test(node)) strong.push(node)
      else loose.push(node)
      return
    }
    if (Array.isArray(node)) { for (const item of node) visit(item, key); return }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (NON_RESULT_KEYS.test(k)) continue
        visit(v, k)
      }
    }
  }
  visit(json, '')
  return [...new Set([...strong, ...loose])]
}

export function parseArgs(argv) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) { push(flags, a.slice(2, eq), a.slice(eq + 1)); continue }
      const name = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) { flags[name] = true } else { push(flags, name, next); i++ }
    } else positionals.push(a)
  }
  return { cmd: positionals[0], sub: positionals[1], flags, positionals }
}
function push(flags, name, value) {
  if (flags[name] === undefined) flags[name] = value
  else if (Array.isArray(flags[name])) flags[name].push(value)
  else flags[name] = [flags[name], value]
}
export const listFlag = v => (v === undefined ? [] : Array.isArray(v) ? v : [v])

export function numFlag(flags, name, { def, min = 1, int = false } = {}) {
  const raw = flags[name]
  if (raw === undefined) return def
  if (raw === true) throw Object.assign(new Error(`--${name} requires a value`), { code: 'USAGE' })
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min) {
    throw Object.assign(new Error(`--${name} must be a number >= ${min}, got ${JSON.stringify(raw)}`), { code: 'USAGE' })
  }
  return int ? Math.round(n) : n
}

const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/
export const sanitizeId = id => String(id).replace(/[^A-Za-z0-9._-]/g, '_')

/** Redact a request body for --dry-run: base64 blobs collapse to their length. */
export function redact(value, depth = 0) {
  if (depth > 12) return '<deep>'
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `${value.slice(0, value.indexOf(';') + 1)}base64,<${value.length} bytes>`
    if (value.length > 400) return `${value.slice(0, 80)}…<${value.length} chars>`
    return value
  }
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, depth + 1)
    return out
  }
  return value
}

// ---------------------------------------------------------------- credentials
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Fail-closed plain lookup of a top-level `refs:` block in ~/.dsh/.credentials.yaml. */
export function readRefsKey(text, keyName) {
  const m = /(^|\n)refs:[ \t]*\n((?:[ \t]{2,}\S[^\n]*\n?)+)/.exec(text)
  if (!m) return undefined
  const line = new RegExp(`^[ \\t]{2,}${escapeRe(keyName)}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(m[2])
  if (!line) return undefined
  return line[1].replace(/^["']|["']$/g, '').replace(/[ \t]+#.*$/, '')
}

export function dshHomeOf({ dshHome, env = process.env } = {}) {
  return dshHome ?? join(env.USERPROFILE ?? env.HOME ?? '.', '.dsh')
}

export function detect({ dshHome, env = process.env, keyEnv = C.defaultKeyEnv } = {}) {
  const home = dshHomeOf({ dshHome, env })
  const base = `https://${C.defaultHost}`
  const fromEnv = env[keyEnv]
  if (fromEnv) return { configuredIntent: true, keyAccessible: true, source: 'env', baseUrl: base, keyHint: maskKey(fromEnv), reason: '' }
  let refsKey
  let settingsIntent = false
  try { refsKey = readRefsKey(readFileSync(join(home, '.credentials.yaml'), 'utf8'), keyEnv) } catch { refsKey = undefined }
  try {
    const s = readFileSync(join(home, 'settings.yaml'), 'utf8')
    settingsIntent = new RegExp(`apiKeyEnv:[ \\t]*${escapeRe(keyEnv)}`).test(s) || /tokenhub/i.test(s)
  } catch { settingsIntent = false }
  if (refsKey) return { configuredIntent: true, keyAccessible: true, source: 'credentials', baseUrl: base, keyHint: maskKey(refsKey), reason: '' }
  if (settingsIntent) {
    return {
      configuredIntent: true, keyAccessible: false, source: 'settings', baseUrl: base, keyHint: '<none>',
      reason: `settings declare a TokenHub provider but no readable key (set ${keyEnv} in your shell, or fix ~/.dsh/.credentials.yaml refs)`,
    }
  }
  return { configuredIntent: false, keyAccessible: false, source: 'none', baseUrl: base, keyHint: '<none>', reason: 'no TokenHub configuration found' }
}

export function resolveKey({ dshHome, env = process.env, keyEnv = C.defaultKeyEnv } = {}) {
  const d = detect({ dshHome, env, keyEnv })
  if (!d.keyAccessible) throw Object.assign(new Error(`no usable TokenHub key: ${d.reason}`), { code: 'KEY_NOT_FOUND', detect: d })
  const key = d.source === 'env' ? env[keyEnv] : readRefsKey(readFileSync(join(dshHomeOf({ dshHome, env }), '.credentials.yaml'), 'utf8'), keyEnv)
  return { key, detect: d }
}

// ---------------------------------------------------------------- http / tasks
export function assertBase(base, allowAny) {
  let u
  try { u = new URL(base) } catch { throw Object.assign(new Error(`invalid --base: ${base}`), { code: 'USAGE' }) }
  if (allowAny) return base
  if (u.protocol !== 'https:') {
    throw Object.assign(new Error(`refusing to send the Authorization header over ${u.protocol}; use https or pass --allow-any-base`), { code: 'BASE_NOT_ALLOWED' })
  }
  if (!(u.host === C.defaultHost || u.host.endsWith('.tencentmaas.com'))) {
    throw Object.assign(new Error(`refusing to send the Authorization header to ${u.host}; pass --allow-any-base to override`), { code: 'BASE_NOT_ALLOWED' })
  }
  return base.replace(/\/$/, '')
}

async function httpJson(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}

const authHeaders = key => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` })

function providerError(status, json, what = 'request') {
  const code = json?.code ?? json?.error?.code ?? json?.Error?.Code ?? ''
  const message = json?.message ?? json?.error?.message ?? json?.Error?.Message ?? JSON.stringify(json).slice(0, 400)
  return Object.assign(new Error(`provider rejected the ${what} (HTTP ${status}): ${code} ${message}`.trim()), { code: 'PROVIDER', status, provider: json })
}

/** POST a generation request; returns { async, taskId?, urls? }. */
async function submit(base, key, path, body, { async: isAsync, exclude = [] }) {
  const payload = JSON.stringify(body)
  if (payload.length > C.caps.totalEncodedBytes) {
    throw Object.assign(new Error(`request body is ${payload.length} bytes, over the ${C.caps.totalEncodedBytes}-byte ceiling; inline fewer/smaller reference images (url: passthrough avoids inlining entirely)`), { code: 'PAYLOAD_TOO_LARGE', bytes: payload.length, cap: C.caps.totalEncodedBytes })
  }
  const { status, json } = await httpJson(base + path, { method: 'POST', headers: authHeaders(key), body })
  if (status !== 200) throw providerError(status, json, 'submission')
  if (!isAsync) {
    const urls = collectUrls(json, { exclude })
    if (urls.length === 0) throw Object.assign(new Error('provider returned no media URL'), { code: 'PROVIDER', provider: json })
    return { async: false, urls, raw: json }
  }
  const taskId = json?.task_id ?? json?.data?.task_id ?? json?.id ?? json?.data?.id
  if (typeof taskId !== 'string' || !SAFE_ID_RE.test(taskId)) {
    throw Object.assign(new Error(`provider response carried no usable task_id: ${JSON.stringify(json).slice(0, 300)}`), { code: 'PROVIDER', provider: json })
  }
  return { async: true, taskId, raw: json }
}

const okStatuses = new Set(['succeeded', 'success', 'completed', 'finished'])
const badStatuses = new Set(['failed', 'fail', 'cancelled', 'canceled', 'unknown', 'error'])
export function statusOf(json) {
  for (const k of ['task_status', 'state', 'status', 'taskStatus']) {
    const v = json?.[k] ?? json?.data?.[k] ?? json?.output?.[k]
    if (typeof v === 'string') return v.toLowerCase()
  }
  return undefined
}

async function pollTask(base, key, path, taskId, { pollMs = C.defaults.pollMs, timeoutS, kind, exclude = [] } = {}) {
  const t0 = Date.now()
  const deadline = t0 + timeoutS * 1000
  let transient = 0
  let backoff = 1
  for (;;) {
    if (Date.now() > deadline) {
      throw Object.assign(new Error(`task ${taskId} still running after ${timeoutS}s; re-check later for free with: tencent-media task ${taskId} (task ids stay queryable for a while)`), { code: 'TIMEOUT', taskId })
    }
    const { status, json } = await httpJson(base + path + taskId, { headers: { Authorization: `Bearer ${key}` } })
    if (status === 429 || status >= 500) {
      transient++
      if (transient > 3) throw Object.assign(new Error(`polling failed ${transient} times in a row (last HTTP ${status})`), { code: 'POLL_FAILED', taskId })
      await sleep(pollMs * backoff); backoff *= 2; continue
    }
    if (status !== 200) throw providerError(status, json, 'poll')
    transient = 0; backoff = 1
    const st = statusOf(json)
    log({ phase: 'poll', kind, task_id: taskId, status: st ?? 'unknown', elapsed_ms: Date.now() - t0 })
    if (st && okStatuses.has(st)) {
      const urls = collectUrls(json, { exclude })
      if (urls.length === 0) throw Object.assign(new Error(`task ${taskId} succeeded but carried no media URL`), { code: 'PROVIDER', taskId, provider: json })
      return { urls, raw: json }
    }
    if (st && badStatuses.has(st)) {
      throw Object.assign(new Error(`task ${taskId} ${st}: ${JSON.stringify(json).slice(0, 300)}`), { code: 'TASK_FAILED', taskId, provider: json })
    }
    await sleep(pollMs)
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function downloadAll(urls, outDir, kind, taskId) {
  mkdirSync(outDir, { recursive: true })
  const safe = sanitizeId(taskId)
  const files = []
  for (let i = 0; i < urls.length; i++) {
    const t0 = Date.now()
    const res = await fetch(urls[i])
    if (!res.ok) throw Object.assign(new Error(`download failed HTTP ${res.status} for result ${i} of task ${taskId}`), { code: 'DOWNLOAD', taskId })
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) throw Object.assign(new Error(`result ${i} of task ${taskId} downloaded as an empty file`), { code: 'DOWNLOAD', taskId })
    const head = buf.slice(0, 12).toString('latin1')
    const isPng = head.startsWith('\x89PNG')
    const isJpg = head.startsWith('\xff\xd8')
    const isMp4 = buf.length > 12 && buf.slice(4, 8).toString('latin1') === 'ftyp'
    const ext = isPng ? '.png' : isJpg ? '.jpg' : isMp4 ? '.mp4' : kind === 'video' ? '.bin' : '.bin'
    if (kind === 'video' && !isMp4) log({ phase: 'warn', kind, task_id: taskId, i, message: 'downloaded payload is not an ISO-BMFF (ftyp) video; inspect before shipping' })
    const file = join(outDir, `${kind}-${safe}-${i}${ext}`)
    writeFileSync(file, buf)
    files.push(file)
    log({ phase: 'download', kind, task_id: taskId, i, bytes: buf.length, file, elapsed_ms: Date.now() - t0 })
  }
  return files
}

// ---------------------------------------------------------------- ffmpeg
export function ffmpegAvailable() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false }
}
function ffmpegRun(args) {
  try { execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }); return true } catch (e) {
    const tail = String(e.stderr ?? e.message ?? '').slice(-400)
    throw Object.assign(new Error(`ffmpeg ${args.slice(0, 3).join(' ')} failed: ${tail}`), { code: 'LOCAL_BACKEND' })
  }
}
function probeDuration(video) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' })
    const d = Number.parseFloat(out.trim())
    return Number.isFinite(d) ? d : undefined
  } catch { return undefined }
}
/** Extract the last decodable frame; output-seek first (reliable), -sseof as fallback. */
export function ffmpegLastFrame(video, outPng) {
  if (!existsSync(video)) throw Object.assign(new Error(`missing video: ${video}`), { code: 'LOCAL_BACKEND' })
  const d = probeDuration(video)
  const attempts = []
  if (d !== undefined) attempts.push(['-y', '-i', video, '-ss', String(Math.max(0, d - 0.2)), '-update', '1', '-frames:v', '1', outPng])
  attempts.push(['-y', '-sseof', '-0.5', '-i', video, '-update', '1', '-frames:v', '1', outPng])
  let lastErr = ''
  for (const args of attempts) {
    try { execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) { lastErr = String(e.stderr ?? e.message).slice(-300); continue }
    if (existsSync(outPng) && statSync(outPng).size > 0) return outPng
    lastErr = 'ffmpeg exited 0 but produced no frame (empty output)'
  }
  throw Object.assign(new Error(`cannot extract the last frame of ${basename(video)}: ${lastErr}`), { code: 'LOCAL_BACKEND' })
}

/** Measured facts of a produced artefact (width/height/duration/audio) for the success line. */
export function probeMediaFacts(file) {
  const facts = { file }
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'json', file], { encoding: 'utf8' })
    const stream = JSON.parse(out)?.streams?.[0] ?? {}
    if (stream.width) facts.width = stream.width
    if (stream.height) facts.height = stream.height
    const d = Number.parseFloat(stream.duration)
    if (Number.isFinite(d)) facts.duration_s = Number(d.toFixed(2))
  } catch { /* ffprobe is advisory only */ }
  try {
    const a = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { encoding: 'utf8' })
    facts.has_audio = a.trim().length > 0
  } catch { /* no audio stream */ }
  return facts
}

/** Persist a recoverable record so a crash after a paid submit never loses the artefact. */
function writeSidecar(outDir, kind, id, payload) {
  try {
    mkdirSync(outDir, { recursive: true })
    const file = join(outDir, `${kind}-${sanitizeId(id)}.task.json`)
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), result_urls_expire_hours: 12, ...payload }, null, 2))
    return file
  } catch { return undefined }
}
export function ffmpegConcat(files, out) {
  const dir = join(out, '..')
  mkdirSync(dir, { recursive: true })
  const list = `${out}.txt`
  writeFileSync(list, files.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
  try { ffmpegRun(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]) } catch { ffmpegRun(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-c:a', 'aac', out]) }
  rmSync(list, { force: true })
  return out
}

// ---------------------------------------------------------------- cli plumbing
function log(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`) }
function fail(err) {
  const { code, message, ...rest } = err ?? {}
  log({ ok: false, code: code ?? 'ERROR', message: message ?? String(err), ...rest })
  process.exitCode = 1
}

function commonFlags(flags) {
  return {
    base: assertBase(flags.base ? String(flags.base) : `https://${C.defaultHost}`, flags['allow-any-base'] === true),
    keyEnv: flags['key-env'] ?? C.defaultKeyEnv,
    dshHome: flags['dsh-home'],
    out: flags.out ?? C.defaults.outDir,
    dry: flags['dry-run'] === true,
    pollMs: numFlag(flags, 'poll-ms', { def: C.defaults.pollMs, min: 200 }),
  }
}

function imageRefs(flags, model) {
  const refs = listFlag(flags.image)
  const cap = C.limits.refImages[model]
  if (refs.length > cap) {
    throw Object.assign(new Error(`${model} accepts at most ${cap} reference images, got ${refs.length}`), { code: 'USAGE' })
  }
  let total = 0
  const uris = []
  for (const ref of refs) {
    if (String(ref).startsWith('url:')) { uris.push(String(ref).slice(4)); continue }
    const ext = extname(String(ref)).toLowerCase()
    if (C.localVideoExts.includes(ext)) throw Object.assign(new Error(`local video input is not supported for images: ${ref}`), { code: 'USAGE' })
    if (C.localAudioExts.includes(ext)) throw Object.assign(new Error(`local audio input is not supported: ${ref}`), { code: 'USAGE' })
    const d = readDataUri(ref)
    if (model === 'vidu-image-q2') {
      if (d.size) {
        if (d.size.width < C.limits.refMinSide || d.size.height < C.limits.refMinSide) {
          throw Object.assign(new Error(`vidu-image-q2 needs reference images >= ${C.limits.refMinSide}px per side, got ${d.size.width}x${d.size.height}`), { code: 'USAGE' })
        }
        const ratio = Math.max(d.size.width / d.size.height, d.size.height / d.size.width)
        if (ratio >= C.limits.refMaxAspect) {
          throw Object.assign(new Error(`vidu-image-q2 reference aspect must be under ${C.limits.refMaxAspect}:1, got ${ratio.toFixed(2)}`), { code: 'USAGE' })
        }
      }
    }
    total += d.encodedLen
    uris.push(d.uri)
  }
  if (total > C.caps.totalEncodedBytes) {
    throw Object.assign(new Error(`total inline payload ${total} bytes exceeds cap ${C.caps.totalEncodedBytes}; compress the references`), { code: 'BASE64_TOO_LARGE', total })
  }
  return { uris, refCount: refs.length }
}

// ---------------------------------------------------------------- commands
function cmdDetect(flags) {
  const cm = commonFlags(flags)
  log({ ok: true, ...detect({ dshHome: cm.dshHome, keyEnv: cm.keyEnv }), baseUrl: cm.base })
}

function cmdConstants() { log({ ok: true, constants: C }) }

function imageBody(model, flags, refUris) {
  const prompt = String(flags.prompt ?? '')
  assertPromptForModel(model, prompt)
  const size = assertSizeForModel(model, flags)
  if (model === 'vidu-image-q2') {
    const body = {
      model,
      prompt,
      aspect_ratio: flags.aspect ?? C.defaults.imageAspect,
      resolution: flags.resolution ?? C.defaults.imageResolution,
    }
    if (refUris.length) body.images = refUris
    if (flags.seed !== undefined) body.seed = numFlag(flags, 'seed', { def: 0, min: 0, int: true })
    return { body, path: C.ep.viduImage, async: true, taskPath: C.ep.viduImageTask, model }
  }
  if (model === 'hy-image-v3') {
    const body = { model, prompt, size }
    if (refUris.length) body.images = refUris
    if (flags.seed !== undefined) body.seed = numFlag(flags, 'seed', { def: 0, min: 0, int: true })
    if (flags.revise === true) body.revise = true
    if (flags.footnote !== undefined) {
      const f = String(flags.footnote)
      if (f.length > 16) throw Object.assign(new Error('--footnote is limited to 16 characters'), { code: 'USAGE' })
      body.footnote = f
    }
    return { body, path: C.ep.hyImage, async: false, model }
  }
  // seedream pro / lite
  const body = { model, prompt, size }
  if (refUris.length) body.images = refUris
  if (flags['output-format'] !== undefined) body.output_format = String(flags['output-format'])
  body.response_format = 'url'
  if (flags.background !== undefined) body.background = String(flags.background)
  if (flags['optimize-mode'] !== undefined) body.optimize_prompt_options = { mode: String(flags['optimize-mode']) }
  return { body, path: C.ep.seedream, async: false, model }
}

async function cmdImage(flags) {
  const cm = commonFlags(flags)
  const model = String(flags.model ?? C.defaults.imageModel)
  if (!C.models.image.includes(model)) {
    throw Object.assign(new Error(`unknown image model ${model}; see constants for the roster`), { code: 'USAGE' })
  }
  const { uris, refCount } = imageRefs(flags, model)
  const { body, path, async: isAsync, taskPath } = imageBody(model, flags, uris)
  const n = numFlag(flags, 'n', { def: 1, min: 1, int: true })
  if (cm.dry) {
    log({ ok: true, dryRun: true, endpoint: path, model, async: isAsync, refImages: refCount, copies: n, request: redact(body) })
    return
  }
  const { key } = resolveKey({ dshHome: cm.dshHome, keyEnv: cm.keyEnv })
  const t0 = Date.now()
  const files = []
  for (let copy = 0; copy < n; copy++) {
    const sub = await submit(cm.base, key, path, body, { async: isAsync, exclude: uris.filter(u => /^https?:/i.test(u)) })
    const jobId = sub.taskId ?? `sync-${copy}`
    log({ phase: 'submit', kind: 'image', model, async: isAsync, task_id: jobId, copy: copy + 1, of: n, elapsed_ms: Date.now() - t0 })
    let urls = sub.urls
    if (isAsync) {
      const done = await pollTask(cm.base, key, taskPath, sub.taskId, { pollMs: cm.pollMs, timeoutS: numFlag(flags, 'timeout-s', { def: C.defaults.timeoutImageS }), kind: 'image', exclude: uris.filter(u => /^https?:/i.test(u)) })
      urls = done.urls
    }
    const downloaded = await downloadAll(urls, cm.out, 'image', jobId)
    files.push(...downloaded)
    writeSidecar(cm.out, 'image', jobId, { model, urls, files: downloaded })
  }
  log({ ok: true, model, files, measured: files.map(probeMediaFacts) })
}

function videoBody(model, flags, firstUri, lastUri) {
  const prompt = String(flags.prompt ?? '')
  if (prompt.trim() === '') throw Object.assign(new Error('--prompt is required'), { code: 'USAGE' })
  const [dMin, dMax] = C.limits.videoDuration[model] ?? [C.defaults.segMin, C.defaults.segMax]
  const duration = numFlag(flags, 'duration', { def: C.defaults.durationDefault, min: dMin, int: true })
  if (duration > dMax) throw Object.assign(new Error(`${model}: duration must be within [${dMin},${dMax}]s; longer targets are auto-segmented by the driver`), { code: 'USAGE' })
  const resolution = flags.resolution ?? C.defaults.videoResolution
  const allowedRes = C.limits.videoResolution[model] ?? []
  if (allowedRes.length && !allowedRes.includes(String(resolution))) {
    throw Object.assign(new Error(`${model}: --resolution must be one of ${allowedRes.join('/')}, got ${resolution}`), { code: 'USAGE' })
  }
  const isV2 = C.models.videoV2.includes(model)
  if (isV2) {
    const content = [{ type: 'text', text: prompt }]
    if (firstUri) content.push({ type: 'image_url', image_url: { url: firstUri }, role: 'first_frame' })
    if (lastUri) content.push({ type: 'image_url', image_url: { url: lastUri }, role: 'last_frame' })
    const body = { model, content, duration, resolution }
    if (!firstUri) {
      const ratio = flags.ratio ?? C.defaults.videoRatio
      if (ratio === 'adaptive') throw Object.assign(new Error('text-to-video requires a concrete --ratio (adaptive is only valid with a first frame)'), { code: 'USAGE' })
      if (!C.limits.videoRatios.includes(String(ratio))) throw Object.assign(new Error(`--ratio must be one of ${C.limits.videoRatios.join('/')}`), { code: 'USAGE' })
      body.ratio = ratio
    }
    return { body, path: C.ep.videoV2, taskPath: C.ep.videoV2Task, isV2 }
  }
  const body = { model, prompt, duration, resolution: String(resolution).toUpperCase() }
  if (firstUri) body.first_frame_image = firstUri
  if (model === 'minimax-video-v2.3-fast' && !firstUri) {
    throw Object.assign(new Error('minimax-video-v2.3-fast only supports image-to-video; pass --image'), { code: 'USAGE' })
  }
  return { body, path: C.ep.videoV1, taskPath: C.ep.videoV1Task, isV2: false }
}

function assertVideoInputs(flags) {
  for (const p of [...listFlag(flags.image), ...listFlag(flags['last-frame'])]) {
    const ext = extname(String(p)).toLowerCase()
    if (C.localVideoExts.includes(ext)) throw Object.assign(new Error(`video input must be an image, got ${p}`), { code: 'USAGE' })
    if (C.localAudioExts.includes(ext)) throw Object.assign(new Error(`audio input is not supported: ${p}`), { code: 'USAGE' })
  }
}

function resolveMediaRef(value) {
  if (value === undefined) return undefined
  const s = String(value)
  if (s.startsWith('url:')) return s.slice(4)
  if (/^https?:\/\//i.test(s)) return s
  return readDataUri(s).uri
}

async function cmdVideo(flags, sub) {
  const cm = commonFlags(flags)
  const model = String(flags.model ?? C.defaults.videoModel)
  if (!C.models.video.includes(model)) {
    throw Object.assign(new Error(`unknown video model ${model}; see constants for the roster`), { code: 'USAGE' })
  }
  assertVideoInputs(flags)
  const mode = sub ?? (listFlag(flags.image).length ? 'i2v' : 't2v')
  if (mode === 'i2v' && listFlag(flags.image).length === 0) {
    throw Object.assign(new Error('video i2v requires --image (the first frame)'), { code: 'USAGE' })
  }
  if (mode === 't2v' && listFlag(flags.image).length > 0) {
    throw Object.assign(new Error('video t2v must not carry --image; use i2v'), { code: 'USAGE' })
  }
  const firstUri = listFlag(flags.image).length ? resolveMediaRef(listFlag(flags.image)[0]) : undefined
  const lastUri = listFlag(flags['last-frame']).length ? resolveMediaRef(listFlag(flags['last-frame'])[0]) : undefined
  if (lastUri && !C.models.videoV2.includes(model)) {
    throw Object.assign(new Error(`${model} does not accept a last frame; use a minimax-video-h3* model`), { code: 'USAGE' })
  }
  const total = numFlag(flags, 'duration', { def: C.defaults.durationDefault, min: 1, int: true })
  const [dMin, dMax] = C.limits.videoDuration[model]
  const segments = total > dMax ? planSegments(total, { model }) : [Math.max(dMin, total)]
  const planned = segments.slice(0, flags['no-stitch'] === true ? 1 : segments.length)
  const exclude = [firstUri, lastUri].filter(u => typeof u === 'string' && /^https?:/i.test(u))
  if (cm.dry) {
    let carried = firstUri
    planned.forEach((dur, i) => {
      const { body, path, taskPath, isV2 } = videoBody(model, { ...flags, duration: String(dur) }, carried, i === 0 ? lastUri : undefined)
      log({
        ok: true, dryRun: true, endpoint: path, taskEndpoint: taskPath, model, style: isV2 ? 'content-array' : 'flat',
        segment: `${i + 1}/${planned.length}`, request: redact(body),
      })
      carried = `data:image/png;base64,<previous-segment-last-frame>`
    })
    return
  }
  const { key } = resolveKey({ dshHome: cm.dshHome, keyEnv: cm.keyEnv })
  const t0 = Date.now()
  const segFiles = []
  let carried = firstUri
  for (let i = 0; i < planned.length; i++) {
    const dur = planned[i]
    const { body, path, taskPath } = videoBody(model, { ...flags, duration: String(dur) }, carried, i === 0 ? lastUri : undefined)
    const sub = await submit(cm.base, key, path, body, { async: true, exclude })
    log({ phase: 'submit', kind: 'video', model, segment: `${i + 1}/${planned.length}`, task_id: sub.taskId, elapsed_ms: Date.now() - t0 })
    const done = await pollTask(cm.base, key, taskPath, sub.taskId, { pollMs: cm.pollMs, timeoutS: numFlag(flags, 'timeout-s', { def: C.defaults.timeoutVideoS }), kind: 'video', exclude })
    const downloaded = await downloadAll(done.urls, cm.out, 'video', sub.taskId)
    segFiles.push(...downloaded)
    writeSidecar(cm.out, 'video', sub.taskId, { model, segment: `${i + 1}/${planned.length}`, resolution: body.resolution, duration: dur, urls: done.urls, files: downloaded })
    if (i < planned.length - 1) {
      if (!ffmpegAvailable()) throw Object.assign(new Error('multi-segment chaining needs ffmpeg on PATH; stopped after this segment'), { code: 'LOCAL_BACKEND', files: segFiles })
      carried = readDataUri(ffmpegLastFrame(segFiles[segFiles.length - 1], join(cm.out, `lastframe-${i}.png`))).uri
    }
  }
  let files = segFiles
  if (segFiles.length > 1) {
    const stitched = join(cm.out, `video-${sanitizeId(basename(segFiles[0]))}-stitched.mp4`)
    files = [ffmpegConcat(segFiles, stitched)]
    log({ phase: 'stitch', files, segments: segFiles.length })
  }
  log({ ok: true, model, duration: planned.reduce((a, b) => a + b, 0), files, measured: files.map(probeMediaFacts) })
}

async function cmdTask(flags, taskId) {
  const cm = commonFlags(flags)
  if (!taskId || !SAFE_ID_RE.test(String(taskId))) throw Object.assign(new Error('task requires a task id'), { code: 'USAGE' })
  // The detail path is family-scoped, so never derive it from the id alone.
  const family = flags.family === undefined ? undefined : String(flags.family)
  if (family !== undefined && !['vidu-image', 'video-v1', 'video-v2'].includes(family)) {
    throw Object.assign(new Error('--family must be one of vidu-image / video-v1 / video-v2'), { code: 'USAGE' })
  }
  const model = String(flags.model ?? (family === 'vidu-image' ? C.models.imageAsync[0] : family === 'video-v1' ? C.models.videoV1[0] : C.defaults.videoModel))
  const resolvedFamily = family ?? (C.models.imageAsync.includes(model) ? 'vidu-image' : C.models.videoV1.includes(model) ? 'video-v1' : 'video-v2')
  const taskPath = resolvedFamily === 'vidu-image' ? C.ep.viduImageTask : resolvedFamily === 'video-v1' ? C.ep.videoV1Task : C.ep.videoV2Task
  const { key } = resolveKey({ dshHome: cm.dshHome, keyEnv: cm.keyEnv })
  const { status, json } = await httpJson(cm.base + taskPath + taskId, { headers: { Authorization: `Bearer ${key}` } })
  if (status !== 200) throw providerError(status, json, 'task query')
  const urls = collectUrls(json)
  log({ ok: true, task_id: taskId, family: resolvedFamily, model, status: statusOf(json) ?? 'unknown', urls, note: 'result URLs stay valid ~12h — download promptly' })
}

function cmdStitch(flags) {
  const files = listFlag(flags.files).map(String)
  if (files.length < 2) throw Object.assign(new Error('stitch requires --files a.mp4 --files b.mp4 ...'), { code: 'USAGE' })
  for (const f of files) if (!existsSync(f)) throw Object.assign(new Error(`missing input: ${f}`), { code: 'USAGE' })
  if (!ffmpegAvailable()) throw Object.assign(new Error('stitch needs ffmpeg on PATH'), { code: 'LOCAL_BACKEND' })
  const out = String(flags.out ?? join(C.defaults.outDir, 'stitched.mp4'))
  const written = ffmpegConcat(files, out)
  log({ ok: true, files: [written] })
}

const USAGE = 'commands: detect | constants | image | video t2v|i2v | task <task_id> | stitch'

async function main(argv) {
  const { cmd, sub, flags, positionals } = parseArgs(argv)
  if (!cmd || cmd === 'help' || flags.help === true) { log({ ok: false, code: 'USAGE', message: USAGE }); process.exitCode = 1; return }
  switch (cmd) {
    case 'detect': return cmdDetect(flags)
    case 'constants': return cmdConstants()
    case 'image': return cmdImage(flags)
    case 'video': return cmdVideo(flags, sub)
    case 'task': return cmdTask(flags, sub ?? positionals[1])
    case 'stitch': return cmdStitch(flags)
    default: throw Object.assign(new Error(`${USAGE} (got ${cmd})`), { code: 'USAGE' })
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('tencent-media.mjs')) {
  main(process.argv.slice(2)).catch(fail)
}
