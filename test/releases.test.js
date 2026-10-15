import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { parseRelease, loadReleases } from '../src/content.js'
import { signUserToken, verifyUserToken, isServerAuth } from '../src/auth.js'
import { loadConfig } from '../src/config.js'
import { createApp } from '../src/server.js'

const SECRET = 'x'.repeat(40)
const md = (fm, body = 'Body text.') => `---\n${fm}\n---\n\n${body}\n`

test('parses frontmatter, slug from filename, defaults', () => {
  const e = parseRelease('2026-10-14-profit-per-visitor.md', md('title: Profit\ntags: Reports', 'First para with [link](https://x.y).\n\nSecond.'))
  assert.equal(e.slug, 'profit-per-visitor')
  assert.equal(e.date, '2026-10-14')
  assert.equal(e.type, 'new')
  assert.deepEqual(e.tags, ['Reports'])
  assert.equal(e.announce, true)
  assert.equal(e.summary, 'First para with link.')
})

test('rewrites relative asset paths', () => {
  const e = parseRelease('2026-10-14-a.md', md('title: A\nimage: ./assets/a.png', '![Alt](assets/b.png)'))
  assert.equal(e.image, '/assets/a.png')
  assert.match(e.html, /src="\/assets\/b\.png"/)
  assert.match(e.html, /loading="lazy"/)
})

test('rejects bad files with a useful message', () => {
  assert.throws(() => parseRelease('Profit.md', md('title: A')), /file name/)
  assert.throws(() => parseRelease('2026-10-14-a.md', md('type: new')), /title/)
  assert.throws(() => parseRelease('2026-10-14-a.md', md('title: A\ntype: feature')), /type/)
  assert.throws(() => parseRelease('2026-10-14-a.md', md('title: A\ndate: 2026-02-30')), /date/)
})

test('loadReleases sorts newest first and reports every invalid file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rel-'))
  await writeFile(join(dir, '2026-01-01-old.md'), md('title: Old'))
  await writeFile(join(dir, '2026-03-01-new.md'), md('title: New'))
  assert.deepEqual((await loadReleases(dir)).map(e => e.slug), ['new', 'old'])
  await writeFile(join(dir, 'bad.md'), 'nope')
  await writeFile(join(dir, '2026-03-02-x.md'), md('type: new'))
  await assert.rejects(loadReleases(dir), err => err.errors.length === 2)
})

test('user tokens: valid, forged, expired', () => {
  const now = 1_800_000_000
  const t = signUserToken(SECRET, { sub: '42', exp: now + 60, since: '2026-01-01' })
  assert.deepEqual(verifyUserToken(SECRET, t, now), { sub: '42', exp: now + 60, since: '2026-01-01' })
  assert.equal(verifyUserToken(SECRET, t, now + 61), null)
  assert.equal(verifyUserToken('y'.repeat(40), t, now), null)
  const [v, p, s] = t.split('.')
  const tampered = Buffer.from(JSON.stringify({ sub: '1', exp: now + 60 })).toString('base64url')
  assert.equal(verifyUserToken(SECRET, `${v}.${tampered}.${s}`, now), null)
  assert.equal(verifyUserToken(SECRET, `${v}.${p}`, now), null)
  assert.ok(isServerAuth(SECRET, 'Bearer ' + SECRET))
  assert.ok(!isServerAuth(SECRET, 'Bearer nope'))
})

async function setup ({ secret = SECRET } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'rel-'))
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'assets', 'a.png'), 'png')
  await writeFile(join(dir, '2026-05-01-may.md'), md('title: May feature'))
  await writeFile(join(dir, '2026-09-01-sept.md'), md('title: September feature'))
  await writeFile(join(dir, '2026-09-02-quiet-fix.md'), md('title: Quiet fix\ntype: fixed\nannounce: false'))
  await writeFile(join(dir, '2026-09-03-draft.md'), md('title: Draft\ndraft: true'))
  await writeFile(join(dir, '2027-01-01-future.md'), md('title: Future'))

  let clock = new Date('2026-10-15T10:00:00Z')
  const cfg = await loadConfig(dir, { RELEASES_SECRET: secret ?? '' }, { dir, dataDir: ':memory:' })
  if (!secret) cfg.secret = null
  const app = await createApp(cfg, { now: () => clock, log: {} })
  const server = createServer(app.handle)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const req = (path, init) => fetch(base + path, init)
  return {
    dir, app, req,
    tick: (iso) => { clock = new Date(iso) },
    nowSec: () => Math.floor(clock.getTime() / 1000),
    close: () => new Promise(r => server.close(r))
  }
}

test('public pages hide drafts and future entries', async (t) => {
  const s = await setup()
  t.after(s.close)
  const home = await (await s.req('/')).text()
  assert.match(home, /September feature/)
  assert.doesNotMatch(home, /Draft|Future/)
  assert.equal((await s.req('/sept')).status, 200)
  assert.equal((await s.req('/draft')).status, 404)
  assert.equal((await s.req('/future')).status, 404)
  const json = await (await s.req('/releases.json')).json()
  assert.deepEqual(json.releases.map(r => r.slug), ['quiet-fix', 'sept', 'may'])
  assert.match(await (await s.req('/feed.xml')).text(), /<rss/)
  assert.equal((await s.req('/assets/a.png')).status, 200)
  assert.equal((await s.req('/assets/../2026-05-01-may.md')).status, 404)
  assert.equal((await s.req('/?type=fixed')).status, 200)
  const embed = await s.req('/embed')
  assert.match(embed.headers.get('content-security-policy'), /frame-ancestors \*/)
})

test('unread flow with user tokens', async (t) => {
  const s = await setup()
  t.after(s.close)
  const token = signUserToken(SECRET, { sub: 'u1', exp: s.nowSec() + 86400, since: '2026-08-01T00:00:00Z' })
  const auth = { headers: { Authorization: 'Bearer ' + token } }

  let r = await (await s.req('/api/me/unread', auth)).json()
  // since Aug 1: September counts, the May one predates signup, quiet fix is not announced.
  assert.equal(r.count, 1)
  assert.deepEqual(r.unread, ['sept'])

  await s.req('/api/me/seen', { method: 'POST', ...auth })
  r = await (await s.req('/api/me/unread', auth)).json()
  assert.equal(r.count, 0)

  // A new entry added later the same day still counts.
  s.tick('2026-10-15T15:00:00Z')
  await writeFile(join(s.dir, '2026-10-15-today.md'), md('title: Today'))
  await s.app.reload()
  r = await (await s.req('/api/me/unread', auth)).json()
  assert.deepEqual(r.unread, ['today'])
  assert.equal(r.latest[0].title, 'Today')

  assert.equal((await s.req('/api/me/unread')).status, 401)
  assert.equal((await s.req('/api/me/unread', { headers: { Authorization: 'Bearer v1.x.y' } })).status, 401)
})

test('new users without since start at now', async (t) => {
  const s = await setup()
  t.after(s.close)
  const token = signUserToken(SECRET, { sub: 'fresh', exp: s.nowSec() + 60 })
  const r = await (await s.req('/api/me/unread', { headers: { Authorization: 'Bearer ' + token } })).json()
  assert.equal(r.count, 0)
})

test('rejects tokens with an exp beyond the max age', async (t) => {
  const s = await setup()
  t.after(s.close)
  const token = signUserToken(SECRET, { sub: 'u', exp: s.nowSec() + 60 * 60 * 24 * 365 })
  assert.equal((await s.req('/api/me/unread', { headers: { Authorization: 'Bearer ' + token } })).status, 401)
})

test('server-to-server API by user id', async (t) => {
  const s = await setup()
  t.after(s.close)
  const auth = { headers: { Authorization: 'Bearer ' + SECRET } }
  let r = await (await s.req('/api/users/77/unread?since=2026-01-01', auth)).json()
  assert.equal(r.count, 2)
  await s.req('/api/users/77/seen', { method: 'POST', ...auth })
  r = await (await s.req('/api/users/77/unread', auth)).json()
  assert.equal(r.count, 0)
  assert.equal((await s.req('/api/users/77/unread', { headers: { Authorization: 'Bearer wrong' } })).status, 401)
})

test('API is off without a secret', async (t) => {
  const s = await setup({ secret: null })
  t.after(s.close)
  assert.equal((await s.req('/api/users/1/unread')).status, 404)
  assert.equal((await s.req('/')).status, 200)
})

test('first import back-dates entries so a backfill does not flood badges', async (t) => {
  const s = await setup()
  t.after(s.close)
  assert.equal(s.app.store.publishedAt('sept'), '2026-09-01T00:00:00.000Z')
})
