/**
 * Unit tests for the aliyun-media skill driver (zero-dep, node:test).
 * Covers test-spec v3 U1-U9. Network-free: fixtures via --dsh-home temp dirs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  C, maskKey, mimeOf, readDataUri, parseArgs, listFlag, planSegments, extractUrls, redact, detect, readRefsKey, numFlag, sanitizeId,
  ffmpegAvailable, ffmpegLastFrame,
} from '../skills/aliyun-media/scripts/aliyun-media.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = join(here, '..', 'skills', 'aliyun-media', 'scripts', 'aliyun-media.mjs')
const SKILL_MD = join(here, '..', 'skills', 'aliyun-media', 'SKILL.md')
const README_MD = join(here, '..', 'README.md')

test('U1 maskKey masks everything but prefix+length', () => {
  assert.equal(maskKey('sk-sp-ABCDEFGH1234'), 'sk-s…(18)')
  assert.equal(maskKey('short'), '*5')
  assert.equal(maskKey(''), '<none>')
  assert.equal(maskKey(undefined), '<none>')
})

test('U2 mime mapping', () => {
  assert.equal(mimeOf('a.png'), 'image/png')
  assert.equal(mimeOf('a.JPG'), 'image/jpeg')
  assert.equal(mimeOf('a.webp'), 'image/webp')
  assert.throws(() => mimeOf('a.txt'), e => e.code === 'MIME')
})

test('U3 dataUri head + encoded-length cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-'))
  const p = join(dir, 'x.png')
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  const d = readDataUri(p)
  assert.ok(d.uri.startsWith('data:image/png;base64,'))
  assert.ok(!d.uri.includes('\n'))
  assert.equal(typeof d.encodedLen, 'number')
  assert.throws(() => readDataUri(p, { capBytes: 4 }), e => e.code === 'BASE64_TOO_LARGE')
})

test('U4 arg parsing, url: passthrough, local A/V rejection, watermark hard-false', () => {
  const a = parseArgs(['image', '--prompt', 'hi', '--image', 'a.png', '--image', 'url:https://e/x.png', '--duration', '30'])
  assert.equal(a.cmd, 'image')
  assert.deepEqual(listFlag(a.flags.image), ['a.png', 'url:https://e/x.png'])
  assert.equal(a.flags.duration, '30')
  const src = readFileSync(SCRIPT, 'utf8')
  assert.ok(!/--watermark/.test(src), 'no enable flag may exist')
  assert.ok(/watermark: C\.defaults\.watermark/.test(src))
  assert.equal(C.defaults.watermark, false)
  // HIGH-1 guards: non-numeric numeric flags must be USAGE, never NaN-driven loops
  assert.throws(() => numFlag({ duration: 'abc' }, 'duration', { def: 30 }), e => e.code === 'USAGE')
  assert.throws(() => numFlag({ 'poll-ms': 'xyz' }, 'poll-ms', { def: 5000, min: 200 }), e => e.code === 'USAGE')
  assert.throws(() => numFlag({ n: '-3' }, 'n', { def: 1, int: true }), e => e.code === 'USAGE')
  assert.throws(() => numFlag({ seed: true }, 'seed', { def: undefined, min: 0, int: true }), e => e.code === 'USAGE', 'valueless numeric flag must not coerce to 1')
  assert.equal(numFlag({}, 'duration', { def: 30 }), 30)
})

test('U5 result-URL extraction across response shapes + poll guards present', () => {
  assert.deepEqual(extractUrls({ output: { video_url: 'https://v/1.mp4' } }), ['https://v/1.mp4'])
  assert.deepEqual(extractUrls({ output: { results: [{ url: 'https://i/1.png' }, { url: 'https://i/2.png' }] } }), ['https://i/1.png', 'https://i/2.png'])
  assert.deepEqual(extractUrls({ output: { choices: [{ message: { content: [{ image: 'https://i/3.png' }] } }] } }), ['https://i/3.png'])
  assert.deepEqual(extractUrls({}), [])
  const src = readFileSync(SCRIPT, 'utf8')
  assert.ok(/status === 429/.test(src) && /transient > 3/.test(src), '429 backoff + 3 transient budget')
  assert.ok(/task ids stay valid 24h/.test(src), 'timeout must print free re-check guidance')
})

test('U6 dry-run redaction truncates base64 and never leaks key', () => {
  const r = redact({ input: { media: [{ type: 'first_frame', url: `data:image/png;base64,${'A'.repeat(200)}` }] }, parameters: { watermark: false } })
  const s = JSON.stringify(r)
  assert.ok(!s.includes('A'.repeat(200)))
  assert.ok(s.includes('bytes>'))
  assert.equal(r.parameters.watermark, false)
})

test('U7 detect three-valued chain via --dsh-home fixtures', () => {
  const envKey = 'QWEN_TOKEN_PLAN_CN_API_KEY'
  // env wins
  const dEnv = detect({ dshHome: mkdtempSync(join(tmpdir(), 'am-e-')), env: { [envKey]: 'sk-sp-ABCDEFGH1234' } })
  assert.deepEqual([dEnv.configuredIntent, dEnv.keyAccessible, dEnv.source], [true, true, 'env'])
  // refs only
  const h1 = mkdtempSync(join(tmpdir(), 'am-r-'))
  writeFileSync(join(h1, '.credentials.yaml'), `version: 1\nrefs:\n  ${envKey}: "sk-sp-ABCDEFGH1234"\n  OTHER: x\nrecords: []\n`)
  const dRefs = detect({ dshHome: h1, env: {} })
  assert.deepEqual([dRefs.configuredIntent, dRefs.keyAccessible, dRefs.source], [true, true, 'credentials'])
  // settings intent only
  const h2 = mkdtempSync(join(tmpdir(), 'am-s-'))
  writeFileSync(join(h2, 'settings.yaml'), `llm-pi-ai:\n  providers:\n    qwen-token-plan-cn:\n      apiKeyEnv: ${envKey}\n`)
  const dSet = detect({ dshHome: h2, env: {} })
  assert.deepEqual([dSet.configuredIntent, dSet.keyAccessible, dSet.source], [true, false, 'settings'])
  assert.ok(dSet.reason.length > 0)
  // nothing
  const dNone = detect({ dshHome: mkdtempSync(join(tmpdir(), 'am-n-')), env: {} })
  assert.deepEqual([dNone.configuredIntent, dNone.keyAccessible], [false, false])
  // refs parser is fail-closed on garbage
  assert.equal(readRefsKey('version: 1\nrefs: notablock\n', envKey), undefined)
})

test('U8 single-source-of-truth: no model/endpoint literals in SKILL.md or README.md', () => {
  // Hard-coded floor (independent of the constants object, so renaming constants cannot silently move the floor)
  const floor = ['/api/v1/services', 'wan2.7-image-pro', 'wan2.7-image', 'qwen-image-3.0-pro', 'happyhorse-1.1-t2v', 'happyhorse-1.1-i2v', 'happyhorse-1.1-r2v', 'happyhorse-1.0-video-edit']
  const forbidden = [...new Set([...floor, '/api/v1/services', ...C.degrade.image, ...Object.values(C.models.video)])]
  for (const file of [SKILL_MD, README_MD]) {
    const text = readFileSync(file, 'utf8')
    for (const lit of forbidden) assert.ok(!text.includes(lit), `${file} must not contain ${lit}`)
    assert.ok(!/happyhorse-1\.1-\*/.test(text), 'family wildcards are not exempt')
  }
  assert.ok(JSON.stringify(C.degrade).includes('wan2.7-image'), 'constants carry the degrade chain')
})

test('U9 segment planning stays inside [3,15] and chains order', () => {
  assert.deepEqual(planSegments(30), [15, 15])
  assert.deepEqual(planSegments(17), [9, 8])
  assert.deepEqual(planSegments(16), [8, 8])
  assert.deepEqual(planSegments(3), [3])
  assert.deepEqual(planSegments(2), [3])
  assert.throws(() => planSegments(NaN), e => e.code === 'USAGE')
  assert.throws(() => planSegments(100000), e => e.code === 'USAGE', 'paid segment count must be capped')
  for (const t of [3, 7, 15, 16, 30, 31, 46, 90]) {
    const segs = planSegments(t)
    assert.ok(segs.every(s => s >= 3 && s <= 15), `bounds for ${t}`)
    assert.equal(segs.reduce((a, b) => a + b, 0), Math.max(3, t), `sum for ${t}`)
  }
})

test('U10 task-id sanitization for filenames', () => {
  assert.equal(sanitizeId('ab/cd..\\ef'), 'ab_cd.._ef')
  assert.equal(sanitizeId('897f007d-0229-4e17'), '897f007d-0229-4e17')
})

// ---------------------------------------------------------- U11 offline CLI ring
import { execFileSync } from 'node:child_process'
const NODE = process.execPath
function cli(args) {
  try {
    const out = execFileSync(NODE, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

test('U11 offline CLI ring: USAGE rejections and dry-run request shapes (zero network, zero cost)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-u11-'))
  const pngs = Array.from({ length: 10 }, (_, i) => { const p = join(dir, `r${i}.png`); writeFileSync(p, Buffer.from([1, 2, 3])); return p })
  const one = pngs[0]

  let r = cli(['image', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /"code":"USAGE"/)

  r = cli(['image', '--prompt', 'x', '--image', join(dir, 'v.mp4'), '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /OSS/)

  r = cli(['edit', '--prompt', 'x', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /edit requires at least one --image/)

  r = cli(['video', 'r2v', '--prompt', 'x', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /at least one --reference/)

  r = cli(['image', '--prompt', 'x', '--base', 'https://evil-aliyuncs.com', '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /BASE_NOT_ALLOWED/)

  r = cli(['image', '--prompt', 'x', '--model', 'qwen-image-3.0-pro', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /multimodal-generation\/generation/)
  assert.match(r.out, /"async":false/)

  r = cli(['image', '--prompt', 'x', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /image-generation\/generation/)
  assert.match(r.out, /"async":true/)
  assert.match(r.out, /4096\*2304/)

  r = cli(['edit', '--prompt', 'x', '--image', one, '--image', pngs[1], '--dry-run'])
  assert.equal(r.code, 0)
  assert.equal((r.out.match(/data:image\/png;base64,/g) ?? []).length, 2)
  assert.match(r.out, /2048\*2048/)

  r = cli(['edit', '--prompt', 'x', ...pngs.flatMap(p => ['--image', p]), '--dry-run'])
  assert.notEqual(r.code, 0); assert.match(r.out, /at most 9/)

  r = cli(['edit', '--prompt', 'x', '--image', 'url:https://e/x.png', '--dry-run'])
  assert.equal(r.code, 0); assert.match(r.out, /https:\/\/e\/x\.png/)

  r = cli(['video', 'i2v', '--image', one, '--prompt', 'x', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /"type":"first_frame"/)
  assert.match(r.out, /"resolution":"1080P"/)
  assert.match(r.out, /"watermark":false/)

  r = cli(['video', 't2v', '--prompt', 'x', '--duration', '30', '--dry-run'])
  assert.equal(r.code, 0); assert.match(r.out, /"segment":"2\/2"/)

  r = cli(['video', 't2v', '--prompt', 'x', '--duration', '30', '--no-stitch', '--dry-run'])
  assert.equal(r.code, 0); assert.equal((r.out.match(/"segment":/g) ?? []).length, 1)

  r = cli(['video', 'r2v', '--reference', one, '--prompt', 'x', '--duration', '30', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /"type":"reference_image"/)
  const contLine = r.out.split('\n').find(l => l.includes('"segment":"2/2"'))
  assert.ok(contLine, 'continuation segment present')
  assert.match(contLine, /"type":"first_frame"/, 'continuation segment chains first_frame in dry-run')
  assert.match(contLine, /"type":"reference_image"/, 'r2v keeps references across segments')

  r = cli(['video', 'edit', '--video', 'url:https://e/x.mp4', '--prompt', 'x', '--duration', '999', '--dry-run'])
  assert.equal(r.code, 0)
  assert.match(r.out, /clamps duration 999s to 15s/, 'edit duration capped with warn')
})

test('U12 ffmpegLastFrame regression lock (lavfi fixture)', t => {
  if (!ffmpegAvailable()) { t.skip('ffmpeg not on PATH'); return }
  const dir = mkdtempSync(join(tmpdir(), 'am-u12-'))
  const clip = join(dir, 'clip.mp4')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=5', clip], { stdio: 'ignore' })
  const frame = ffmpegLastFrame(clip, join(dir, 'last.png'))
  assert.ok(existsSync(frame))
  assert.ok(statSync(frame).size > 0)
  assert.throws(() => ffmpegLastFrame(join(dir, 'missing.mp4'), join(dir, 'x.png')), e => e.code === 'LOCAL_BACKEND')
})
