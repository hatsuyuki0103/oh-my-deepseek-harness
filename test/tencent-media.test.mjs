/**
 * Unit + offline CLI contract tests for the tencent-media skill driver
 * (zero-dep, node:test). Network-free: fixtures via --dsh-home temp dirs and
 * --dry-run. Covers test-spec T1-T13.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import {
  C, maskKey, mimeOf, readDataUri, imageHeaderSize, parseSize, assertSizeForModel, assertPromptForModel,
  parseArgs, listFlag, numFlag, sanitizeId, redact, collectUrls, statusOf, planSegments,
  detect, readRefsKey, assertBase, ffmpegAvailable, ffmpegLastFrame,
} from '../skills/tencent-media/scripts/tencent-media.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = join(here, '..', 'skills', 'tencent-media', 'scripts', 'tencent-media.mjs')
const SKILL_MD = join(here, '..', 'skills', 'tencent-media', 'SKILL.md')
const README_MD = join(here, '..', 'skills', 'tencent-media', 'README.md')
const KEY_ENV = 'TENCENT_TOKENHUB_API_KEY'

const pngBytes = (w, h, pad = 0) => {
  const b = Buffer.alloc(33 + pad)
  b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b
}
const jpegBytes = (w, h) => {
  const b = Buffer.alloc(20)
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xc0
  b.writeUInt16BE(0x0011, 4); b[6] = 0x08
  b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9)
  return b
}

test('T1 maskKey masks everything but prefix+length', () => {
  assert.equal(maskKey('sk-abcdefghijklmnop'), 'sk-a…(19)')
  assert.equal(maskKey('short'), '*5')
  assert.equal(maskKey(''), '<none>')
  assert.equal(maskKey(undefined), '<none>')
})

test('T2 mime mapping', () => {
  assert.equal(mimeOf('a.png'), 'image/png')
  assert.equal(mimeOf('a.JPG'), 'image/jpeg')
  assert.equal(mimeOf('a.webp'), 'image/webp')
  assert.throws(() => mimeOf('a.txt'), e => e.code === 'MIME')
})

test('T3 data URI head, length cap and header sniffing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-'))
  const p = join(dir, 'x.png')
  writeFileSync(p, pngBytes(512, 256))
  const d = readDataUri(p)
  assert.ok(d.uri.startsWith('data:image/png;base64,'))
  assert.ok(!d.uri.includes('\n'))
  assert.deepEqual(d.size, { width: 512, height: 256 })
  assert.throws(() => readDataUri(p, { capBytes: 4 }), e => e.code === 'IMAGE_TOO_LARGE')
  const j = join(dir, 'y.jpg')
  writeFileSync(j, jpegBytes(256, 512))
  assert.deepEqual(imageHeaderSize(readFileSync(j)), { width: 256, height: 512 })
  assert.equal(imageHeaderSize(Buffer.from([1, 2, 3])), undefined)
})

test('T4 arg parsing and numeric-flag guards', () => {
  const a = parseArgs(['image', '--prompt', 'hi', '--image', 'a.png', '--image', 'url:https://e/x.png', '--duration=30'])
  assert.equal(a.cmd, 'image')
  assert.deepEqual(listFlag(a.flags.image), ['a.png', 'url:https://e/x.png'])
  assert.equal(a.flags.duration, '30')
  assert.throws(() => numFlag({ duration: 'abc' }, 'duration', { def: 15 }), e => e.code === 'USAGE')
  assert.throws(() => numFlag({ 'poll-ms': 'xyz' }, 'poll-ms', { def: 5000, min: 200 }), e => e.code === 'USAGE')
  assert.throws(() => numFlag({ n: true }, 'n', { def: 1, int: true }), e => e.code === 'USAGE')
  assert.equal(numFlag({}, 'duration', { def: 15 }), 15)
  assert.equal(sanitizeId('ab/cd..\\ef'), 'ab_cd.._ef')
})

test('T5 collectUrls across response shapes, with guards', () => {
  assert.deepEqual(collectUrls({ data: [{ url: 'https://cdn/a.png' }] }), ['https://cdn/a.png'])
  assert.deepEqual(collectUrls({ content: { video_url: 'https://cdn/v.mp4' } }), ['https://cdn/v.mp4'])
  assert.deepEqual(collectUrls({ video_url: 'https://cdn/v.mp4' }), ['https://cdn/v.mp4'])
  assert.deepEqual(collectUrls({ result: { urls: ['https://cdn/b.jpg'] } }), ['https://cdn/b.jpg'])
  assert.deepEqual(collectUrls({}), [])
  // guards: ids and control-plane URLs never become results
  const noisy = {
    request_id: 'https://x/request/1', task_id: 'https://x/tasks/9',
    callback_url: 'https://x/callback', data: [{ url: 'https://cdn/ok.png' }],
  }
  assert.deepEqual(collectUrls(noisy), ['https://cdn/ok.png'])
  // echoed reference images are excluded
  assert.deepEqual(collectUrls({ data: [{ url: 'https://cdn/ref.png' }] }, { exclude: ['https://cdn/ref.png'] }), [])
  // media-looking URLs sort ahead of opaque ones; duplicates collapse
  assert.deepEqual(collectUrls({ a: 'https://cdn/opaque', b: 'https://cdn/x.mp4', c: 'https://cdn/x.mp4' }), ['https://cdn/x.mp4', 'https://cdn/opaque'])
  // status reader tolerates the three documented key spellings
  assert.equal(statusOf({ task_status: 'SUCCEEDED' }), 'succeeded')
  assert.equal(statusOf({ data: { state: 'processing' } }), 'processing')
  assert.equal(statusOf({ output: { status: 'Fail' } }), 'fail')
  assert.equal(statusOf({}), undefined)
})

test('T6 per-model prompt caps are enforced before any call', () => {
  assert.throws(() => assertPromptForModel('seedream-image-v5.0-pro', 'x'.repeat(601)), e => e.code === 'USAGE' && e.cap === 600)
  assert.doesNotThrow(() => assertPromptForModel('seedream-image-v5.0-pro', 'x'.repeat(600)))
  assert.doesNotThrow(() => assertPromptForModel('vidu-image-q2', 'x'.repeat(2000)))
  assert.throws(() => assertPromptForModel('vidu-image-q2', 'x'.repeat(2001)), e => e.code === 'USAGE')
  assert.throws(() => assertPromptForModel('hy-image-v3', '   '), e => e.code === 'USAGE')
  assert.doesNotThrow(() => assertPromptForModel('hy-image-v3', 'x'.repeat(8192)))
})

test('T7 size legality per model (buckets, pixel window, 1MP ceiling)', () => {
  assert.equal(assertSizeForModel('vidu-image-q2', {}), undefined)
  assert.equal(assertSizeForModel('vidu-image-q2', { aspect: '4:3', resolution: '2K' }), undefined)
  assert.throws(() => assertSizeForModel('vidu-image-q2', { aspect: '5:4' }), e => e.code === 'USAGE')
  assert.throws(() => assertSizeForModel('vidu-image-q2', { resolution: '720p' }), e => e.code === 'USAGE')
  assert.throws(() => assertSizeForModel('vidu-image-q2', { size: '1024x1024' }), e => e.code === 'USAGE')

  assert.equal(assertSizeForModel('seedream-image-v5.0-pro', { size: '2352x1760' }), '2352x1760')
  assert.equal(assertSizeForModel('seedream-image-v5.0-pro', {}), C.defaults.seedreamSize)
  assert.throws(() => assertSizeForModel('seedream-image-v5.0-pro', { size: '800x600' }), e => e.code === 'USAGE', 'below pixel window')
  assert.throws(() => assertSizeForModel('seedream-image-v5.0-pro', { size: '4096x3072' }), e => e.code === 'USAGE', 'above pixel window')
  assert.throws(() => assertSizeForModel('seedream-image-v5.0-pro', { size: '4K' }), e => e.code === 'USAGE', 'pro has no 4K bucket')
  assert.equal(assertSizeForModel('seedream-image-v5.0-lite', { size: '4K' }), '4K')

  assert.equal(assertSizeForModel('hy-image-v3', { size: '1024x1024' }), '1024x1024')
  assert.throws(() => assertSizeForModel('hy-image-v3', { size: '2352x1760' }), e => e.code === 'USAGE', 'hy is capped at 1MP and 2048 per side')
  assert.throws(() => assertSizeForModel('hy-image-v3', { size: '256x256' }), e => e.code === 'USAGE')
  assert.deepEqual(parseSize('2048X2048'), { width: 2048, height: 2048 })
  assert.throws(() => parseSize('big'), e => e.code === 'USAGE')
})

test('T8 segment planning respects per-model duration ranges', () => {
  assert.deepEqual(planSegments(30, { model: 'minimax-video-h3-max' }), [15, 15])
  assert.deepEqual(planSegments(15, { model: 'minimax-video-h3-max' }), [15])
  assert.deepEqual(planSegments(4, { model: 'minimax-video-h3-max' }), [5], 'h3-max floors at 5s (no 4s)')
  assert.deepEqual(planSegments(4, { model: 'minimax-video-h3' }), [4], 'h3 allows 4s')
  assert.deepEqual(planSegments(20, { model: 'minimax-video-h3-max' }), [10, 10])
  for (const t of [5, 12, 15, 16, 30, 45]) {
    const segs = planSegments(t, { model: 'minimax-video-h3-max' })
    assert.ok(segs.every(s => s >= 5 && s <= 15), `bounds for ${t}`)
    assert.equal(segs.reduce((a, b) => a + b, 0), t, `sum for ${t}`)
  }
  assert.throws(() => planSegments(NaN), e => e.code === 'USAGE')
  assert.throws(() => planSegments(100000), e => e.code === 'USAGE')
})

test('T9 detect three-valued chain and fail-closed refs parsing', () => {
  const dEnv = detect({ dshHome: mkdtempSync(join(tmpdir(), 'tm-e-')), env: { [KEY_ENV]: 'sk-abcdefghijklmnop' } })
  assert.deepEqual([dEnv.configuredIntent, dEnv.keyAccessible, dEnv.source], [true, true, 'env'])
  assert.equal(dEnv.keyHint, 'sk-a…(19)')

  const h1 = mkdtempSync(join(tmpdir(), 'tm-r-'))
  writeFileSync(join(h1, '.credentials.yaml'), `version: 1\nrefs:\n  ${KEY_ENV}: "sk-abcdefghijklmnop"\n  OTHER: x\nrecords: []\n`)
  assert.deepEqual([detect({ dshHome: h1, env: {} }).configuredIntent, detect({ dshHome: h1, env: {} }).keyAccessible], [true, true])

  const h2 = mkdtempSync(join(tmpdir(), 'tm-s-'))
  writeFileSync(join(h2, 'settings.yaml'), `providers:\n  tencent-tokenhub:\n    apiKeyEnv: ${KEY_ENV}\n`)
  const dSet = detect({ dshHome: h2, env: {} })
  assert.deepEqual([dSet.configuredIntent, dSet.keyAccessible, dSet.source], [true, false, 'settings'])
  assert.ok(dSet.reason.length > 0)

  const dNone = detect({ dshHome: mkdtempSync(join(tmpdir(), 'tm-n-')), env: {} })
  assert.deepEqual([dNone.configuredIntent, dNone.keyAccessible], [false, false])
  assert.equal(readRefsKey('version: 1\nrefs: notablock\n', KEY_ENV), undefined)
})

test('T10 base guard keeps the Authorization header on the vendor domain', () => {
  assert.equal(assertBase('https://tokenhub.tencentmaas.com', false), 'https://tokenhub.tencentmaas.com')
  assert.equal(assertBase('https://tokenhub.tencentmaas.com/', false), 'https://tokenhub.tencentmaas.com')
  assert.throws(() => assertBase('http://tokenhub.tencentmaas.com', false), e => e.code === 'BASE_NOT_ALLOWED')
  assert.throws(() => assertBase('https://evil-tencentmaas.com', false), e => e.code === 'BASE_NOT_ALLOWED')
  assert.throws(() => assertBase('https://evil.example.com', false), e => e.code === 'BASE_NOT_ALLOWED')
  assert.equal(assertBase('https://evil.example.com', true), 'https://evil.example.com')
})

test('T11 redaction collapses base64 blobs', () => {
  const r = redact({ content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(5000)}` } }], model: 'x' })
  const s = JSON.stringify(r)
  assert.ok(!s.includes('A'.repeat(100)))
  assert.ok(s.includes('bytes>'))
  assert.equal(r.model, 'x')
})

test('T12 single source of truth: no model ids or endpoints in SKILL.md / README.md', () => {
  const floor = ['vidu-image-q2', 'seedream-image-v5.0-pro', 'seedream-image-v5.0-lite', 'hy-image-v3', 'minimax-video-h3-max', 'minimax-video-h3', 'minimax-video-v2.3', '/v1/wand/']
  const forbidden = [...new Set([...floor, ...C.models.image, ...C.models.video, ...Object.values(C.ep)])]
  for (const file of [SKILL_MD, README_MD]) {
    const text = readFileSync(file, 'utf8')
    for (const lit of forbidden) assert.ok(!text.includes(lit), `${file} must not contain ${lit}`)
  }
  assert.ok(JSON.stringify(C.degrade).includes('minimax-video-h3-max'), 'constants carry the degrade chain')
  assert.ok(JSON.stringify(C.ep).includes('/v1/wand/'), 'constants carry the endpoints')
})

// ------------------------------------------------------- offline CLI ring
const NODE = process.execPath
function cli(args, env = {}) {
  try {
    const out = execFileSync(NODE, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

test('T13 offline CLI ring: dry-run shapes, guards, zero cost', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-cli-'))
  const ref = join(dir, 'ref.png')
  writeFileSync(ref, pngBytes(512, 512))
  const tiny = join(dir, 'tiny.png')
  writeFileSync(tiny, pngBytes(64, 64))
  const flat = join(dir, 'flat.png')
  writeFileSync(flat, pngBytes(1024, 128))

  let r = cli(['image', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /"code":"USAGE"/)

  r = cli(['image', '--prompt', 'x', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /\/v1\/wand\/si-image\/generation/)
  assert.match(r.out, /"async":false/)
  assert.match(r.out, /"size":"2K"/)
  assert.match(r.out, /"response_format":"url"/)

  r = cli(['image', '--prompt', 'x', '--model', 'vidu-image-q2', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /\/v1\/wand\/vidu-image\/generation/)
  assert.match(r.out, /"async":true/)
  assert.match(r.out, /"aspect_ratio":"4:3"/)
  assert.match(r.out, /"resolution":"2K"/)

  r = cli(['image', '--prompt', 'x', '--model', 'seedream-image-v5.0-pro', '--size', '2352x1760', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /\/v1\/wand\/si-image\/generation/)
  assert.match(r.out, /"async":false/)
  assert.match(r.out, /"size":"2352x1760"/)
  assert.match(r.out, /"response_format":"url"/)

  r = cli(['image', '--prompt', 'x'.repeat(601), '--model', 'seedream-image-v5.0-pro', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /600-char limit/)

  r = cli(['image', '--prompt', 'x', '--model', 'hy-image-v3', '--size', '2352x1760', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /1024x1024/)

  r = cli(['image', '--prompt', 'x', '--image', ref, '--dry-run'])
  assert.equal(r.code, 0); assert.equal((r.out.match(/data:image\/png;base64,/g) ?? []).length, 1)

  // reference-image guards are model-scoped: exercise them on the model that documents them
  r = cli(['image', '--prompt', 'x', '--model', 'vidu-image-q2', '--image', tiny, '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, />= 128px/)

  r = cli(['image', '--prompt', 'x', '--model', 'vidu-image-q2', '--image', flat, '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /aspect must be under 4:1/)

  const refs8 = Array.from({ length: 8 }, (_, i) => { const p = join(dir, `r${i}.png`); writeFileSync(p, pngBytes(512, 512)); return p })
  r = cli(['image', '--prompt', 'x', '--model', 'vidu-image-q2', ...refs8.flatMap(p => ['--image', p]), '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /at most 7/)

  const refs11 = Array.from({ length: 11 }, (_, i) => refs8[i % refs8.length])
  r = cli(['image', '--prompt', 'x', ...refs11.flatMap(p => ['--image', p]), '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /at most 10/, 'seedream default caps references at 10')

  r = cli(['image', '--prompt', 'x', '--base', 'https://evil-tencentmaas.com', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /BASE_NOT_ALLOWED/)

  r = cli(['image', '--prompt', 'x', '--image', join(dir, 'v.mp4'), '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /local video input/)

  r = cli(['video', 't2v', '--prompt', 'x', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /\/v1\/wand\/minimax-video-v2\/generation/)
  assert.match(r.out, /"style":"content-array"/)
  assert.match(r.out, /"resolution":"768P"/)
  assert.match(r.out, /"ratio":"16:9"/)
  assert.match(r.out, /"duration":15/)

  r = cli(['video', 'i2v', '--image', ref, '--prompt', 'x', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /"role":"first_frame"/)
  assert.doesNotMatch(r.out, /"ratio"/, 'first-frame jobs let the image decide the ratio')

  r = cli(['video', 'i2v', '--image', ref, '--last-frame', ref, '--prompt', 'x', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /"role":"last_frame"/)

  r = cli(['video', 't2v', '--prompt', 'x', '--ratio', 'adaptive', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /adaptive is only valid with a first frame/)

  r = cli(['video', 'i2v', '--prompt', 'x', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /requires --image/)

  r = cli(['video', 't2v', '--prompt', 'x', '--duration', '30', '--dry-run'])
  assert.equal(r.code, 0); assert.match(r.out, /"segment":"2\/2"/)

  r = cli(['video', 't2v', '--prompt', 'x', '--duration', '30', '--no-stitch', '--dry-run'])
  assert.equal(r.code, 0); assert.equal((r.out.match(/"segment":/g) ?? []).length, 1)

  r = cli(['video', 't2v', '--prompt', 'x', '--duration', '5', '--model', 'minimax-video-v2.3-fast', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /only supports image-to-video/)

  r = cli(['video', 't2v', '--prompt', 'x', '--model', 'minimax-video-v2.3', '--duration', '6', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /\/v1\/wand\/minimax-video\/generation/)
  assert.match(r.out, /"style":"flat"/)

  r = cli(['video', 't2v', '--prompt', 'x', '--model', 'nope-model', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /unknown video model/)

  r = cli(['image', '--prompt', 'x', '--image', join(dir, 'a.mp4'), '--dry-run'])
  assert.notEqual(r.code, 0)

  r = cli(['task', 'bad id!', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /task requires a task id/)

  // no key material may ever appear in output (dry-run needs no key at all)
  r = cli(['image', '--prompt', 'x', '--dry-run'], { [KEY_ENV]: 'sk-supersecret-abcdefghijklmnop' })
  assert.equal(r.code, 0)
  assert.ok(!r.out.includes('supersecret'))
  assert.ok(!/Bearer/i.test(r.out))
})

test('T14 ffmpegLastFrame regression lock (lavfi fixture)', t => {
  if (!ffmpegAvailable()) { t.skip('ffmpeg not on PATH'); return }
  const dir = mkdtempSync(join(tmpdir(), 'tm-ff-'))
  const clip = join(dir, 'clip.mp4')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=5', clip], { stdio: 'ignore' })
  const frame = ffmpegLastFrame(clip, join(dir, 'last.png'))
  assert.ok(existsSync(frame) && statSync(frame).size > 0)
  assert.throws(() => ffmpegLastFrame(join(dir, 'missing.mp4'), join(dir, 'x.png')), e => e.code === 'LOCAL_BACKEND')
})
