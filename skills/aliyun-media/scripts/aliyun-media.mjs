#!/usr/bin/env node
/**
 * aliyun-media — zero-dependency driver for Aliyun Token Plan (Model Studio /
 * DashScope-style gateway) image & video generation, with local-backend
 * fallback probes. Single source of truth for endpoints, model ids, defaults
 * and degradation chains: SKILL.md and README must reference `constants`
 * output instead of repeating any of these literals.
 *
 * Security discipline: the API key is read from the environment or from
 * ~/.dsh/.credentials.yaml `refs:` (plain, indent-aware, fail-closed). It is
 * never printed: every surface shows maskKey() form only.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs'
import { join, extname, basename, resolve as resolvePath } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------- constants
export const C = {
  defaultHost: 'token-plan.cn-beijing.maas.aliyuncs.com',
  defaultKeyEnv: 'QWEN_TOKEN_PLAN_CN_API_KEY',
  ep: {
    imageAsync: '/api/v1/services/aigc/image-generation/generation',
    imageSync: '/api/v1/services/aigc/multimodal-generation/generation',
    video: '/api/v1/services/aigc/video-generation/video-synthesis',
    task: '/api/v1/tasks/',
  },
  models: {
    image: ['wan2.7-image-pro', 'wan2.7-image', 'qwen-image-3.0-pro'],
    imageSync: ['qwen-image-3.0-pro'],
    video: {
      t2v: 'happyhorse-1.1-t2v',
      i2v: 'happyhorse-1.1-i2v',
      r2v: 'happyhorse-1.1-r2v',
      edit: 'happyhorse-1.0-video-edit',
    },
  },
  degrade: {
    image: ['wan2.7-image-pro', 'wan2.7-image', 'qwen-image-3.0-pro'],
    video: ['happyhorse-1.1-t2v', 'happyhorse-1.1-i2v', 'happyhorse-1.1-r2v'],
    videoEdit: ['happyhorse-1.0-video-edit', 'i2v-first-frame-regen'],
  },
  defaults: {
    imageSizeT2i: '4096*2304',
    imageSizeT2iAlt: '2304*4096',
    imageSizeEdit: '2048*2048',
    imageSizeSync: '2048*2048',
    resolution: '1080P',
    segMax: 15,
    segMin: 3,
    durationDefault: 30,
    watermark: false,
    pollMs: 5000,
    timeoutImageS: 600,
    timeoutVideoS: 900,
    outDir: 'outputs/media',
  },
  caps: {
    singleEncodedBytes: 10 * 1024 * 1024,
    totalEncodedBytes: 24 * 1024 * 1024,
    maxRefImages: 9,
    maxTotalDurationS: 300,
    maxSegments: 20,
  },
  mime: { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.bmp': 'image/bmp', '.webp': 'image/webp' },
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

export function readDataUri(path, { capBytes = C.caps.singleEncodedBytes } = {}) {
  const buf = readFileSync(path)
  const uri = `data:${mimeOf(path)};base64,${buf.toString('base64')}`
  const encodedLen = uri.length
  if (encodedLen > capBytes) {
    throw Object.assign(new Error(`base64 payload ${encodedLen} bytes exceeds self-imposed cap ${capBytes}; compress the input first`), { code: 'BASE64_TOO_LARGE', encodedLen })
  }
  return { mime: mimeOf(path), bytes: buf.length, encodedLen, uri }
}

/** Split a target duration into server-legal segments ([3,15] each), evenly. */
export function planSegments(target, { min = C.defaults.segMin, max = C.defaults.segMax } = {}) {
  if (!Number.isFinite(target)) throw Object.assign(new Error('--duration must be a number'), { code: 'USAGE' })
  const t = Math.max(min, Math.round(target))
  if (t > C.caps.maxTotalDurationS) {
    throw Object.assign(new Error(`total duration ${t}s exceeds cap ${C.caps.maxTotalDurationS}s (paid segments are unbounded otherwise)`), { code: 'USAGE' })
  }
  const n = Math.ceil(t / max)
  if (n > C.caps.maxSegments) throw Object.assign(new Error(`segment count ${n} exceeds cap ${C.caps.maxSegments}`), { code: 'USAGE' })
  const base = Math.floor(t / n)
  const rem = t % n
  const segs = Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
  return segs.map(s => Math.min(max, Math.max(min, s)))
}

/** Pull result URLs out of either async task output or sync multimodal output. */
export function extractUrls(json) {
  const out = json?.output ?? {}
  const urls = []
  if (typeof out.video_url === 'string') urls.push(out.video_url)
  if (Array.isArray(out.results)) for (const r of out.results) if (r && typeof r.url === 'string') urls.push(r.url)
  if (Array.isArray(out.choices)) {
    for (const ch of out.choices) {
      const content = ch?.message?.content
      if (Array.isArray(content)) for (const part of content) if (part && typeof part.image === 'string') urls.push(part.image)
    }
  }
  return urls
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

/** Numeric flag with finite/positive validation; throws USAGE otherwise. */
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

export function detect({ dshHome, env = process.env, keyEnv = C.defaultKeyEnv } = {}) {
  const home = dshHome ?? join(env.USERPROFILE ?? env.HOME ?? '.', '.dsh')
  const base = `https://${C.defaultHost}`
  const fromEnv = env[keyEnv]
  if (fromEnv) return { configuredIntent: true, keyAccessible: true, source: 'env', baseUrl: base, keyHint: maskKey(fromEnv), reason: '' }
  let refsKey
  let settingsIntent = false
  try { refsKey = readRefsKey(readFileSync(join(home, '.credentials.yaml'), 'utf8'), keyEnv) } catch { refsKey = undefined }
  try {
    const s = readFileSync(join(home, 'settings.yaml'), 'utf8')
    settingsIntent = /token-plan/i.test(s) || new RegExp(`apiKeyEnv:[ \\t]*${escapeRe(keyEnv)}`).test(s)
  } catch { settingsIntent = false }
  if (refsKey) return { configuredIntent: true, keyAccessible: true, source: 'credentials', baseUrl: base, keyHint: maskKey(refsKey), reason: '' }
  if (settingsIntent) {
    return {
      configuredIntent: true, keyAccessible: false, source: 'settings', baseUrl: base, keyHint: '<none>',
      reason: `settings declare the provider but no readable key (set ${keyEnv} in your shell, or fix ~/.dsh/.credentials.yaml refs)`,
    }
  }
  return { configuredIntent: false, keyAccessible: false, source: 'none', baseUrl: base, keyHint: '<none>', reason: 'no Token Plan configuration found' }
}

export function resolveKey({ dshHome, env = process.env, keyEnv = C.defaultKeyEnv } = {}) {
  const d = detect({ dshHome, env, keyEnv })
  if (!d.keyAccessible) {
    throw Object.assign(new Error(`no usable Token Plan key: ${d.reason}`), { code: 'KEY_NOT_FOUND', detect: d })
  }
  const key = d.source === 'env' ? env[keyEnv] : readRefsKey(readFileSync(join(dshHome ?? join(env.USERPROFILE ?? env.HOME ?? '.', '.dsh'), '.credentials.yaml'), 'utf8'), keyEnv)
  return { key, detect: d }
}

// ---------------------------------------------------------------- http / tasks
function assertBase(base, allowAny) {
  let u
  try { u = new URL(base) } catch { throw Object.assign(new Error(`invalid --base: ${base}`), { code: 'USAGE' }) }
  if (allowAny) return base
  if (u.protocol !== 'https:') {
    throw Object.assign(new Error(`refusing to send the Authorization header over ${u.protocol}; use https or pass --allow-any-base`), { code: 'BASE_NOT_ALLOWED' })
  }
  if (!(u.host === C.defaultHost || u.host.endsWith('.aliyuncs.com'))) {
    throw Object.assign(new Error(`refusing to send the Authorization header to ${u.host}; pass --allow-any-base to override`), { code: 'BASE_NOT_ALLOWED' })
  }
  return base
}

async function httpJson(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}

async function submit(base, key, body, { sync = false } = {}) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
  if (!sync) headers['X-DashScope-Async'] = 'enable'
  const url = base + (sync ? C.ep.imageSync : body.__ep)
  delete body.__ep
  const { status, json } = await httpJson(url, { method: 'POST', headers, body })
  if (status !== 200) {
    throw Object.assign(new Error(`provider rejected the request (HTTP ${status}): ${json?.code ?? ''} ${json?.message ?? JSON.stringify(json).slice(0, 300)}`), { code: 'PROVIDER', status, provider: json })
  }
  if (sync) return { sync: true, urls: extractUrls(json), taskId: `sync-${Date.now()}` }
  const taskId = json?.output?.task_id
  if (typeof taskId !== 'string' || !SAFE_ID_RE.test(taskId)) {
    throw Object.assign(new Error('provider response carried no usable task_id'), { code: 'PROVIDER', provider: json })
  }
  return { sync: false, taskId }
}

async function pollTask(base, key, taskId, { pollMs = C.defaults.pollMs, timeoutS, kind } = {}) {
  const t0 = Date.now()
  const deadline = t0 + timeoutS * 1000
  let transient = 0
  let backoff = 1
  for (;;) {
    if (Date.now() > deadline) {
      throw Object.assign(new Error(`task ${taskId} still running after ${timeoutS}s; re-check later for free with: GET ${base}${C.ep.task}${taskId} (task ids stay valid 24h)`), { code: 'TIMEOUT', taskId })
    }
    const { status, json } = await httpJson(base + C.ep.task + taskId, { headers: { Authorization: `Bearer ${key}` } })
    if (status === 429 || status >= 500) {
      transient++
      if (transient > 3) throw Object.assign(new Error(`polling failed ${transient} times in a row (last HTTP ${status})`), { code: 'POLL_FAILED', taskId })
      await sleep(pollMs * backoff); backoff *= 2; continue
    }
    if (status !== 200) throw Object.assign(new Error(`poll HTTP ${status}: ${json?.code ?? ''} ${json?.message ?? ''}`), { code: 'PROVIDER', taskId, provider: json })
    transient = 0; backoff = 1
    const st = json?.output?.task_status
    log({ phase: 'poll', kind, task_id: taskId, status: st, elapsed_ms: Date.now() - t0 })
    if (st === 'SUCCEEDED') return extractUrls(json)
    if (st === 'FAILED' || st === 'UNKNOWN') {
      throw Object.assign(new Error(`task ${taskId} ${st}: ${json?.output?.code ?? json?.output?.message ?? JSON.stringify(json?.output ?? {}).slice(0, 300)}`), { code: 'TASK_FAILED', taskId, provider: json })
    }
    await sleep(pollMs)
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
/** Placeholder standing in for the previous segment's last frame in --dry-run mode. */
export const DRY_LASTFRAME = 'data:image/png;base64,<previous-segment-last-frame>'

async function downloadAll(urls, outDir, kind, taskId) {
  mkdirSync(outDir, { recursive: true })
  const safe = sanitizeId(taskId)
  const files = []
  for (let i = 0; i < urls.length; i++) {
    const t0 = Date.now()
    const res = await fetch(urls[i])
    if (!res.ok) throw Object.assign(new Error(`download failed HTTP ${res.status} for result ${i} of task ${taskId}`), { code: 'DOWNLOAD', taskId })
    const buf = Buffer.from(await res.arrayBuffer())
    const ext = kind === 'video' ? '.mp4' : kind === 'image' ? '.png' : '.bin'
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
  try {
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    return true
  } catch (e) {
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
/** Extract the last decodable frame; output-seek first (reliable), -sseof as fallback. Throws LOCAL_BACKEND when neither yields a frame. */
export function ffmpegLastFrame(video, outPng) {
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
  throw Object.assign(new Error(`cannot extract last frame of ${basename(video)}: ${lastErr}`), { code: 'LOCAL_BACKEND' })
}
function ffmpegConcat(videos, out) {
  const list = `${out}.concat.txt`
  writeFileSync(list, videos.map(v => `file '${v.replace(/'/g, "'\\''")}'`).join('\n'))
  try {
    ffmpegRun(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out])
  } catch (first) {
    // segments may carry mismatching codecs: fall back to re-encode once.
    ffmpegRun(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-c:a', 'aac', out])
  } finally {
    try { rmSync(list, { force: true }) } catch { /* best effort */ }
  }
  return out
}

// ---------------------------------------------------------------- commands
function log(obj) { console.log(JSON.stringify(obj)) }
function die(err) {
  const provider = err.provider === undefined ? undefined : JSON.stringify(err.provider).slice(0, 2000)
  log({
    ok: false, code: err.code ?? 'ERROR', message: err.message,
    ...(err.taskId ? { task_id: err.taskId } : {}),
    ...(err.partial_files?.length ? { partial_files: err.partial_files } : {}),
    ...(provider ? { provider } : {}),
  })
  process.exitCode = 1
}

function commonFlags(flags) {
  return {
    base: assertBase(flags.base ? String(flags.base).replace(/\/$/, '') : `https://${C.defaultHost}`, flags['allow-any-base'] === true),
    keyEnv: flags['key-env'] ?? C.defaultKeyEnv,
    dshHome: flags['dsh-home'],
    out: resolvePath(flags.out ?? C.defaults.outDir),
    dry: flags['dry-run'] === true,
    pollMs: numFlag(flags, 'poll-ms', { def: C.defaults.pollMs, min: 200 }),
  }
}

function mediaRef(p, { capBytes } = {}) {
  if (typeof p === 'string' && p.startsWith('url:')) return p.slice(4)
  return readDataUri(p, capBytes === undefined ? {} : { capBytes }).uri
}

function imageBody(flags, { withImages = false } = {}) {
  const model = flags.model ?? C.models.image[0]
  const sync = C.models.imageSync.includes(model)
  const images = listFlag(flags.image)
  const size = flags.size ?? (withImages ? C.defaults.imageSizeEdit : sync ? C.defaults.imageSizeSync : C.defaults.imageSizeT2i)
  const content = [{ text: String(flags.prompt ?? '') }]
  let total = 0
  for (const p of images) {
    if (typeof p === 'string' && p.startsWith('url:')) { content.push({ image: p.slice(4) }); continue }
    const d = readDataUri(p); total += d.encodedLen; content.push({ image: d.uri })
  }
  if (images.length > C.caps.maxRefImages) throw Object.assign(new Error(`at most ${C.caps.maxRefImages} reference images`), { code: 'USAGE' })
  if (total > C.caps.totalEncodedBytes) throw Object.assign(new Error(`total base64 ${total} bytes exceeds cap ${C.caps.totalEncodedBytes}`), { code: 'BASE64_TOO_LARGE' })
  const parameters = { size, n: numFlag(flags, 'n', { def: 1, int: true }), watermark: C.defaults.watermark }
  if (model.startsWith('wan2.7')) parameters.thinking_mode = true // source: Model Studio wan2.7 image guide (thinking_mode improves quality)
  if (sync) parameters.prompt_extend = true // source: Model Studio qwen-image sync (multimodal-generation) guide; DPE rewrite default
  const body = { model, input: { messages: [{ role: 'user', content }] }, parameters }
  body.__ep = sync ? C.ep.imageSync : C.ep.imageAsync
  return { body, sync, model }
}

async function cmdImage(flags, cm) {
  if (!flags.prompt) throw Object.assign(new Error('--prompt is required'), { code: 'USAGE' })
  const { body, sync, model } = imageBody(flags, { withImages: listFlag(flags.image).length > 0 })
  if (cm.dry) {
    const ep = body.__ep
    delete body.__ep
    log({ ok: true, dryRun: true, endpoint: ep, async: !sync, model, request: redact(body) })
    return
  }
  const { key } = resolveKey(cm)
  const t0 = Date.now()
  const sub = await submit(cm.base, key, body, { sync })
  log({ phase: 'submit', kind: 'image', model, sync, task_id: sub.taskId, elapsed_ms: Date.now() - t0 })
  const urls = sub.sync ? sub.urls : await pollTask(cm.base, key, sub.taskId, { pollMs: cm.pollMs, timeoutS: numFlag(flags, 'timeout-s', { def: C.defaults.timeoutImageS }), kind: 'image' })
  if (urls.length === 0) throw Object.assign(new Error(`task ${sub.taskId} succeeded but returned no result URLs`), { code: 'PROVIDER', taskId: sub.taskId })
  const files = await downloadAll(urls, cm.out, 'image', sub.taskId)
  log({ ok: true, model, files })
}

async function cmdVideo(flags, cm, mode) {
  const models = C.models.video
  if (mode === 'edit') {
    const video = String(flags.video ?? '')
    if (!video.startsWith('url:')) throw Object.assign(new Error('video edit needs a public/OSS url: video input (local video cannot be base64-encoded); see OSS upload guidance'), { code: 'USAGE' })
    const media = [{ type: 'video', url: video.slice(4) }]
    assertRefCap(listFlag(flags.reference))
    for (const r of listFlag(flags.reference)) media.push({ type: 'reference_image', url: mediaRef(r) })
    let editDuration = numFlag(flags, 'duration', { def: C.defaults.segMax })
    if (editDuration > C.defaults.segMax) {
      log({ phase: 'warn', message: `video edit clamps duration ${editDuration}s to ${C.defaults.segMax}s (server per-call cap)` })
      editDuration = C.defaults.segMax
    }
    const body = { model: models.edit, input: { prompt: String(flags.prompt ?? ''), media }, parameters: { resolution: flags.resolution ?? C.defaults.resolution, duration: editDuration, watermark: C.defaults.watermark } }
    body.__ep = C.ep.video
    const seed = numFlag(flags, 'seed', { def: undefined, min: 0, int: true })
    if (seed !== undefined) body.parameters.seed = seed
    if (cm.dry) {
      const ep = body.__ep
      delete body.__ep
      log({ ok: true, dryRun: true, endpoint: ep, async: true, model: body.model, request: redact(body) })
      return
    }
    const { key } = resolveKey(cm)
    const editT0 = Date.now()
    const sub = await submit(cm.base, key, body)
    log({ phase: 'submit', kind: 'video', model: body.model, mode: 'edit', task_id: sub.taskId, elapsed_ms: Date.now() - editT0 })
    const urls = await pollTask(cm.base, key, sub.taskId, { pollMs: cm.pollMs, timeoutS: numFlag(flags, 'timeout-s', { def: C.defaults.timeoutVideoS }), kind: 'video' })
    if (urls.length === 0) throw Object.assign(new Error(`task ${sub.taskId} succeeded but returned no result URLs`), { code: 'PROVIDER', taskId: sub.taskId })
    log({ ok: true, model: body.model, files: await downloadAll(urls, cm.out, 'video', sub.taskId) })
    return
  }
  const target = numFlag(flags, 'duration', { def: C.defaults.durationDefault })
  const noStitch = flags['no-stitch'] === true
  if (mode === 'r2v') {
    if (listFlag(flags.reference).length === 0) throw Object.assign(new Error('r2v requires at least one --reference image'), { code: 'USAGE' })
    assertRefCap(listFlag(flags.reference))
  }
  if (noStitch && target > C.defaults.segMax) {
    log({ phase: 'warn', message: `--no-stitch clamps duration ${target}s to ${C.defaults.segMax}s (server per-segment cap)` })
  }
  const segs = noStitch ? [Math.min(C.defaults.segMax, Math.max(C.defaults.segMin, Math.round(target)))] : planSegments(target)
  log({ phase: 'plan', mode, segments: segs, resolution: flags.resolution ?? C.defaults.resolution })
  if (cm.dry) {
    for (let i = 0; i < segs.length; i++) {
      const b = segmentBody(flags, mode, i, segs[i], i > 0 ? DRY_LASTFRAME : undefined)
      const ep = b.__ep
      delete b.__ep
      log({ ok: true, dryRun: true, segment: `${i + 1}/${segs.length}`, endpoint: ep, async: true, model: b.model, request: redact(b) })
    }
    return
  }
  const { key } = resolveKey(cm)
  const haveFfmpeg = ffmpegAvailable()
  const segFiles = []
  let prevFile
  try {
    for (let i = 0; i < segs.length; i++) {
      const segT0 = Date.now()
      if (i > 0 && !haveFfmpeg) { log({ phase: 'warn', message: 'ffmpeg missing: stopping after first segment (no last-frame chaining, no concat)' }); break }
      let lastFrame
      if (i > 0) {
        try { lastFrame = ffmpegLastFrame(prevFile, `${prevFile}.lastframe.png`) } catch (e) {
          log({ phase: 'warn', message: `last-frame extraction failed (${e.code}); delivering ${segFiles.length} segment(s) without chaining: ${e.message}` })
          break
        }
      }
      const body = segmentBody(flags, mode, i, segs[i], lastFrame)
      const subT0 = Date.now()
      const sub = await submit(cm.base, key, body)
      log({ phase: 'submit', kind: 'video', model: sub.model ?? body.model, segment: `${i + 1}/${segs.length}`, task_id: sub.taskId, elapsed_ms: Date.now() - subT0 })
      const urls = await pollTask(cm.base, key, sub.taskId, { pollMs: cm.pollMs, timeoutS: numFlag(flags, 'timeout-s', { def: C.defaults.timeoutVideoS }), kind: 'video' })
      if (urls.length === 0) throw Object.assign(new Error(`task ${sub.taskId} succeeded but returned no result URLs`), { code: 'PROVIDER', taskId: sub.taskId })
      const files = await downloadAll(urls, cm.out, 'video', sub.taskId)
      segFiles.push(...files)
      prevFile = files[0]
      log({ phase: 'segment', i: i + 1, n: segs.length, task_id: sub.taskId, files, elapsed_ms: Date.now() - segT0 })
    }
  } catch (e) {
    if (segFiles.length) e.partial_files = segFiles
    throw e
  }
  let out = segFiles
  if (segFiles.length > 1 && haveFfmpeg) {
    const joined = join(cm.out, `video-stitched-${Date.now()}.mp4`)
    mkdirSync(cm.out, { recursive: true })
    ffmpegConcat(segFiles, joined)
    for (const f of segFiles) for (const side of [`${f}.lastframe.png`]) try { rmSync(side, { force: true }) } catch { /* best effort */ }
    out = [joined]
    log({ phase: 'stitch', files: out })
  }
  log({ ok: true, files: out })
}

function segmentBody(flags, mode, i, duration, lastFrame) {
  const models = C.models.video
  const parameters = { resolution: flags.resolution ?? C.defaults.resolution, duration, watermark: C.defaults.watermark }
  const seed = numFlag(flags, 'seed', { def: undefined, min: 0, int: true })
  if (seed !== undefined) parameters.seed = seed
  const prompt = String(flags.prompt ?? '')
  let model, media
  if (i === 0) {
    if (mode === 'i2v') { model = models.i2v; media = [{ type: 'first_frame', url: mediaUrl(flags.image) }] }
    else if (mode === 'r2v') { model = models.r2v; media = listFlag(flags.reference).map(mediaUrlRef) }
    else { model = models.t2v; media = undefined }
  } else {
    // continuation segments chain through the previous segment's last frame;
    // r2v keeps its reference images for cross-segment consistency.
    model = models.i2v
    media = [{ type: 'first_frame', url: lastFrame === DRY_LASTFRAME ? DRY_LASTFRAME : readDataUri(lastFrame).uri }]
    if (mode === 'r2v') media.push(...listFlag(flags.reference).map(mediaUrlRef))
  }
  const input = { prompt }
  if (media) input.media = media
  const body = { model, input, parameters }
  body.__ep = C.ep.video
  return body
}
function mediaUrlRef(p) { return { type: 'reference_image', url: mediaRef(p) } }
/** Enforce the self-imposed total-request cap over base64 reference images (url: refs are server-side). */
function assertRefCap(refs) {
  let total = 0
  for (const p of refs) {
    if (typeof p === 'string' && p.startsWith('url:')) continue
    total += readDataUri(p).encodedLen
  }
  if (total > C.caps.totalEncodedBytes) {
    throw Object.assign(new Error(`total base64 references ${total} bytes exceed cap ${C.caps.totalEncodedBytes}`), { code: 'BASE64_TOO_LARGE' })
  }
}
function mediaUrl(p) {
  const v = listFlag(p)[0]
  if (v === undefined) throw Object.assign(new Error('--image is required for i2v'), { code: 'USAGE' })
  return mediaRef(v)
}

export function redact(body) {
  const clone = JSON.parse(JSON.stringify(body))
  const walk = node => {
    if (Array.isArray(node)) { for (const x of node) walk(x); return }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string' && v.startsWith('data:')) node[k] = `${v.slice(0, v.indexOf(',') + 1)}<${v.length - v.indexOf(',') - 1} bytes>`
        else walk(v)
      }
    }
  }
  walk(clone)
  return clone
}

function rejectLocalAv(path) {
  if (typeof path === 'string' && path.startsWith('url:')) return
  const e = extname(path).toLowerCase()
  if (C.localVideoExts.includes(e) || C.localAudioExts.includes(e)) {
    throw Object.assign(new Error(`local ${e} input is not supported (server accepts public/OSS URLs only for audio/video); upload to OSS first or pass url:`), { code: 'USAGE' })
  }
}

async function cmdScan() {
  const out = []
  const probe = async (kind, url, path) => {
    let running = false, apiOk = false, note = ''
    try {
      const r = await fetch(url + path, { signal: AbortSignal.timeout(2500) })
      running = true; apiOk = r.ok || r.status === 401
      if (!apiOk) note = `HTTP ${r.status}`
    } catch (e) { note = e.cause?.code ?? 'unreachable' }
    out.push({ kind, url, running, apiOk, note })
  }
  await probe('sd-webui', 'http://127.0.0.1:7860', '/sdapi/v1/options')
  await probe('comfyui', 'http://127.0.0.1:8188', '/system_stats')
  const ff = ffmpegAvailable()
  out.push({ kind: 'ffmpeg', path: 'ffmpeg', running: ff, apiOk: ff, note: ff ? '' : 'not on PATH' })
  log({ ok: true, backends: out })
}

async function cmdSd(flags, cm) {
  const url = flags.url ?? 'http://127.0.0.1:7860'
  const body = { prompt: String(flags.prompt ?? ''), steps: 20, width: 1024, height: 1024 }
  if (cm.dry) { log({ ok: true, dryRun: true, endpoint: `${url}/sdapi/v1/txt2img`, request: body }); return }
  const res = await httpJson(`${url}/sdapi/v1/txt2img`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const b64 = res.json?.images?.[0]?.image
  if (res.status !== 200 || !b64) throw Object.assign(new Error(`sd-webui txt2img failed HTTP ${res.status}`), { code: 'LOCAL_BACKEND' })
  mkdirSync(cm.out, { recursive: true })
  const file = join(cm.out, `sd-txt2img-${Date.now()}.png`)
  writeFileSync(file, Buffer.from(b64, 'base64'))
  log({ ok: true, files: [file] })
}

async function cmdComfy(flags, cm) {
  const url = flags.url ?? 'http://127.0.0.1:8188'
  if (!flags.workflow) throw Object.assign(new Error('--workflow FILE is required (bring your own workflow JSON)'), { code: 'USAGE' })
  const workflow = JSON.parse(readFileSync(String(flags.workflow), 'utf8'))
  if (cm.dry) { log({ ok: true, dryRun: true, endpoint: `${url}/prompt`, request: { prompt: '<workflow>' } }); return }
  const sub = await httpJson(`${url}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { prompt: workflow } })
  const id = sub.json?.prompt_id
  if (sub.status !== 200 || !id) throw Object.assign(new Error(`comfy /prompt failed HTTP ${sub.status}`), { code: 'LOCAL_BACKEND' })
  for (let i = 0; i < 240; i++) {
    await sleep(3000)
    const h = await httpJson(`${url}/history/${id}`)
    const outputs = h.json?.[id]?.outputs
    if (outputs) {
      const files = []
      mkdirSync(cm.out, { recursive: true })
      for (const node of Object.values(outputs)) for (const img of node.images ?? []) {
        const r = await fetch(`${url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${img.type}`)
        const file = join(cm.out, `comfy-${sanitizeId(id)}-${files.length}.png`)
        writeFileSync(file, Buffer.from(await r.arrayBuffer()))
        files.push(file)
      }
      log({ ok: true, files }); return
    }
  }
  throw Object.assign(new Error(`comfy task ${id} did not finish in time`), { code: 'TIMEOUT', taskId: id })
}

function cmdConstants() { log({ ok: true, constants: C }) }

// ---------------------------------------------------------------- main
async function main() {
  const { cmd, sub, flags } = parseArgs(process.argv.slice(2))
  const cm = commonFlags(flags)
  for (const p of [...listFlag(flags.image), ...listFlag(flags.reference)]) rejectLocalAv(p)
  switch (cmd) {
    case 'detect': log({ ok: true, ...detect({ dshHome: cm.dshHome, keyEnv: cm.keyEnv }) }); break
    case 'scan': await cmdScan(); break
    case 'constants': cmdConstants(); break
    case 'image': await cmdImage(flags, cm); break
    case 'edit':
      if (!flags.image) throw Object.assign(new Error('edit requires at least one --image (otherwise use `image` for text-to-image)'), { code: 'USAGE' })
      await cmdImage(flags, cm)
      break
    case 'video':
      if (sub === 't2v') await cmdVideo(flags, cm, 't2v')
      else if (sub === 'i2v') await cmdVideo(flags, cm, 'i2v')
      else if (sub === 'r2v') await cmdVideo(flags, cm, 'r2v')
      else if (sub === 'edit') await cmdVideo(flags, cm, 'edit')
      else if (sub === 'stitch') {
        const segs = String(flags.segments ?? '').split(',').filter(Boolean)
        if (segs.length < 2 || !flags.out) throw Object.assign(new Error('--segments a,b --out out.mp4 required'), { code: 'USAGE' })
        if (!ffmpegAvailable()) throw Object.assign(new Error('ffmpeg not on PATH'), { code: 'LOCAL_BACKEND' })
        log({ ok: true, files: [ffmpegConcat(segs, String(flags.out))] })
      } else throw Object.assign(new Error('video subcommand must be t2v|i2v|r2v|edit|stitch'), { code: 'USAGE' })
      break
    case 'sd-txt2img': await cmdSd(flags, cm); break
    case 'comfy-run': await cmdComfy(flags, cm); break
    default:
      log({ ok: false, code: 'USAGE', message: 'commands: detect | scan | constants | image | edit | video t2v|i2v|r2v|edit|stitch | sd-txt2img | comfy-run' })
      process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(die)
}
