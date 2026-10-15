import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { signUserToken, verifyUserToken } from '../src/auth.js'
import { loadConfig } from '../src/config/load.js'
import { parseRelease } from '../src/content/parse.js'
import { loadReleases } from '../src/content/repository.js'
import { createApp, type ReleasesApp } from '../src/app.js'

const SECRET = 'x'.repeat(40)
const md = (fm: string, body = 'Body text.') => `---\n${fm}\n---\n\n${body}\n`
const tmp = () => mkdtemp(join(tmpdir(), 'releases-'))

describe('parseRelease', () => {
  it('reads frontmatter, takes the slug and date from the file name, applies defaults', () => {
    const e = parseRelease('2026-10-14-profit-per-visitor.md', md('title: Profit\ntags: Reports', 'First para with [link](https://x.y).\n\nSecond.'))
    expect(e).toMatchObject({ slug: 'profit-per-visitor', date: '2026-10-14', type: 'new', tags: ['Reports'], announce: true, draft: false })
    expect(e.summary).toBe('First para with link.')
  })

  it('rewrites relative asset paths and lazy-loads images', () => {
    const e = parseRelease('2026-10-14-a.md', md('title: A\nimage: ./assets/a.png', '![Alt](assets/b.png)'))
    expect(e.image).toBe('/assets/a.png')
    expect(e.html).toContain('src="/assets/b.png"')
    expect(e.html).toContain('loading="lazy"')
  })

  it.each([
    ['Profit.md', md('title: A'), /file name/],
    ['2026-10-14-a.md', md('type: new'), /title/],
    ['2026-10-14-a.md', md('title: A\ntype: feature'), /type/],
    ['2026-10-14-a.md', md('title: A\ndate: 2026-02-30'), /date/],
    ['2026-10-14-a.md', 'no frontmatter', /frontmatter/],
  ])('rejects %s with a useful message', (name, raw, msg) => {
    expect(() => parseRelease(name, raw)).toThrow(msg)
  })

  it('loadReleases sorts newest first and reports every invalid file', async () => {
    const dir = await tmp()
    await writeFile(join(dir, '2026-01-01-old.md'), md('title: Old'))
    await writeFile(join(dir, '2026-03-01-new.md'), md('title: New'))
    expect((await loadReleases(dir)).map(e => e.slug)).toEqual(['new', 'old'])
    await writeFile(join(dir, 'bad.md'), 'nope')
    await writeFile(join(dir, '2026-03-02-x.md'), md('type: new'))
    await expect(loadReleases(dir)).rejects.toMatchObject({ errors: { length: 2 } })
  })
})

describe('user tokens', () => {
  const now = 1_800_000_000
  it('round-trips and rejects forged, tampered or expired tokens', () => {
    const t = signUserToken(SECRET, { sub: '42', exp: now + 60, since: '2026-01-01' })
    expect(verifyUserToken(SECRET, t, now)).toEqual({ sub: '42', exp: now + 60, since: '2026-01-01' })
    expect(verifyUserToken(SECRET, t, now + 61)).toBeNull()
    expect(verifyUserToken('y'.repeat(40), t, now)).toBeNull()
    const [v, , s] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: '1', exp: now + 60 })).toString('base64url')
    expect(verifyUserToken(SECRET, `${v}.${forged}.${s}`, now)).toBeNull()
    expect(verifyUserToken(SECRET, 'v1.abc', now)).toBeNull()
  })
})

describe('config', () => {
  it('works with zero config', async () => {
    const cfg = await loadConfig(await tmp(), {})
    expect(cfg).toMatchObject({ name: 'Changelog', port: 3000, secret: null, colors: { accent: '#2f54eb' }, labels: { fixed: 'Fix' } })
  })

  it('reads a config inside the releases folder and lets env win', async () => {
    const cwd = await tmp()
    await mkdir(join(cwd, 'releases'))
    await writeFile(join(cwd, 'releases', 'releases.config.json'), JSON.stringify({ $schema: 'x', name: 'Acme', font: 'Inter', port: 4000 }))
    const cfg = await loadConfig(cwd, { PORT: '5000', PUBLIC_URL: 'https://r.acme.com/' })
    expect(cfg).toMatchObject({ name: 'Acme', font: 'Inter', port: 5000, url: 'https://r.acme.com', dir: join(cwd, 'releases'), dataDir: join(cwd, '.data') })
  })

  it('explains invalid values and refuses a secret in the file', async () => {
    const cwd = await tmp()
    await writeFile(join(cwd, 'releases.config.json'), JSON.stringify({ colors: { accent: 'blue; }' } }))
    await expect(loadConfig(cwd, {})).rejects.toThrow(/colors\.accent/)
    await writeFile(join(cwd, 'releases.config.json'), JSON.stringify({ secret: 'x' }))
    await expect(loadConfig(cwd, {})).rejects.toThrow(/RELEASES_SECRET/)
    await expect(loadConfig(await tmp(), { RELEASES_SECRET: 'short' })).rejects.toThrow(/32 characters/)
  })
})

describe('server', () => {
  let current: ReleasesApp | null = null
  afterEach(() => { current?.close(); current = null })

  async function setup ({ secret = SECRET as string | null, config = {}, env = {} as Record<string, string> } = {}) {
    const dir = await tmp()
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'a.png'), 'png')
    await writeFile(join(dir, '2026-05-01-may.md'), md('title: May feature'))
    await writeFile(join(dir, '2026-09-01-sept.md'), md('title: September feature'))
    await writeFile(join(dir, '2026-09-02-quiet-fix.md'), md('title: Quiet fix\ntype: fixed\nannounce: false'))
    await writeFile(join(dir, '2026-09-03-draft.md'), md('title: Draft\ndraft: true'))
    await writeFile(join(dir, '2027-01-01-future.md'), md('title: Future'))
    await writeFile(join(dir, '2026-09-04-team-only.md'), md('title: Team only\ninternal: true'))

    let clock = new Date('2026-10-15T10:00:00Z')
    const cfg = await loadConfig(dir, { ...(secret ? { RELEASES_SECRET: secret } : {}), ...env }, { dir, dataDir: ':memory:', ...config })
    current = await createApp(cfg, { now: () => clock, logger: { info () {}, error () {} } })
    const { app, releases } = current
    return {
      dir,
      releases,
      req: (path: string, init?: RequestInit) => app.request(`http://releases.test${path}`, init),
      tick: (iso: string) => { clock = new Date(iso) },
      nowSec: () => Math.floor(clock.getTime() / 1000),
      userAuth: (token: string) => ({ headers: { Authorization: `Bearer ${token}` } }),
    }
  }

  it('serves pages and hides drafts and future entries', async () => {
    const s = await setup()
    const home = await (await s.req('/')).text()
    expect(home.startsWith('<!doctype html>')).toBe(true)
    expect(home).toContain('September feature')
    expect(home).not.toMatch(/Draft|Future|Team only/)
    expect((await s.req('/team-only')).status).toBe(404)
    expect((await s.req('/sept')).status).toBe(200)
    expect((await s.req('/draft')).status).toBe(404)
    expect((await s.req('/future')).status).toBe(404)
    expect((await s.req('/?type=fixed')).status).toBe(200)
    expect(await (await s.req('/feed.xml')).text()).toContain('<link>http://releases.test/sept</link>')
    expect((await s.req('/assets/a.png')).status).toBe(200)
    expect((await s.req('/assets/..%2F2026-05-01-may.md')).status).toBe(404)
    expect((await s.req('/_releases/styles.css')).status).toBe(200)
    const json = await (await s.req('/releases.json')).json() as { releases: { slug: string }[] }
    expect(json.releases.map(r => r.slug)).toEqual(['quiet-fix', 'sept', 'may'])
  })

  it('takes the public URL from proxy headers unless configured', async () => {
    const s = await setup()
    const res = await s.req('/feed.xml', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'releases.acme.com' } })
    expect(await res.text()).toContain('https://releases.acme.com/sept')
  })

  it('applies theme config', async () => {
    const s = await setup({ config: { name: 'Acme', font: 'Space Grotesk', colors: { accent: { light: '#111111', dark: '#eeeeee' } }, labels: { fixed: 'Bug fix' } } })
    const html = await (await s.req('/')).text()
    expect(html).toContain('Acme changelog')
    expect(html).toContain('--accent:light-dark(#111111, #eeeeee)')
    expect(html).toContain('family=Space+Grotesk')
    expect(html).toContain('Bug fix')
  })

  it('embed allows framing per config; pages do not', async () => {
    const s = await setup({ config: { frameAncestors: ['https://app.acme.com'] } })
    expect((await s.req('/embed')).headers.get('content-security-policy')).toBe('frame-ancestors https://app.acme.com')
    expect((await s.req('/')).headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
  })

  it('counts unread per user and clears on seen', async () => {
    const s = await setup()
    const auth = s.userAuth(signUserToken(SECRET, { sub: 'u1', exp: s.nowSec() + 86400, since: '2026-08-01T00:00:00Z' }))

    let r = await (await s.req('/api/me/unread', auth)).json() as { count: number; unread: string[]; latest: { title: string; url: string }[] }
    // Since Aug 1: September counts; May predates signup; the quiet fix is not announced.
    expect(r.unread).toEqual(['sept'])
    expect(r.latest[0]!.url).toBe('http://releases.test/sept')

    await s.req('/api/me/seen', { method: 'POST', ...auth })
    r = await (await s.req('/api/me/unread', auth)).json() as typeof r
    expect(r.count).toBe(0)

    // An entry added later the same day still counts.
    s.tick('2026-10-15T15:00:00Z')
    await writeFile(join(s.dir, '2026-10-15-today.md'), md('title: Today'))
    await s.releases.reload()
    r = await (await s.req('/api/me/unread', auth)).json() as typeof r
    expect(r.unread).toEqual(['today'])
  })

  it('rejects missing, bad and overlong user tokens', async () => {
    const s = await setup()
    expect((await s.req('/api/me/unread')).status).toBe(401)
    expect((await s.req('/api/me/unread', s.userAuth('v1.x.y'))).status).toBe(401)
    const longLived = signUserToken(SECRET, { sub: 'u', exp: s.nowSec() + 60 * 60 * 24 * 365 })
    expect((await s.req('/api/me/unread', s.userAuth(longLived))).status).toBe(401)
  })

  it('starts new users without `since` at now', async () => {
    const s = await setup()
    const auth = s.userAuth(signUserToken(SECRET, { sub: 'fresh', exp: s.nowSec() + 60 }))
    expect(((await (await s.req('/api/me/unread', auth)).json()) as { count: number }).count).toBe(0)
  })

  it('answers CORS preflight for the browser API', async () => {
    const s = await setup()
    const res = await s.req('/api/me/unread', { method: 'OPTIONS', headers: { Origin: 'https://app.acme.com', 'Access-Control-Request-Method': 'GET' } })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('server-to-server API by user id', async () => {
    const s = await setup()
    const auth = { headers: { Authorization: `Bearer ${SECRET}` } }
    let r = await (await s.req('/api/users/77/unread?since=2026-01-01', auth)).json() as { count: number }
    expect(r.count).toBe(2)
    await s.req('/api/users/77/seen', { method: 'POST', ...auth })
    r = await (await s.req('/api/users/77/unread', auth)).json() as typeof r
    expect(r.count).toBe(0)
    expect((await s.req('/api/users/77/unread', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401)
  })

  it('keeps the API off without a secret', async () => {
    const s = await setup({ secret: null })
    expect((await s.req('/api/users/1/unread')).status).toBe(404)
    expect((await s.req('/')).status).toBe(200)
  })

  it('back-dates entries on first import so a backfill does not flood badges', async () => {
    const s = await setup()
    expect(s.releases.store.publishedAt('sept')).toBe('2026-09-01T00:00:00.000Z')
  })

  it('team preview shows drafts and internal entries behind a cookie', async () => {
    const token = 'p'.repeat(20)
    const s = await setup({ env: { PREVIEW_TOKEN: token } })
    expect((await s.req('/preview?token=wrong')).status).toBe(403)
    const login = await s.req(`/preview?token=${token}`)
    expect(login.status).toBe(302)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    expect(login.headers.get('set-cookie')).toMatch(/HttpOnly/i)
    const res = await s.req('/', { headers: { Cookie: cookie } })
    const html = await res.text()
    expect(html).toMatch(/Team only/)
    expect(html).toMatch(/Draft/)
    expect(html).toMatch(/Exit preview/)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect((await s.req('/team-only', { headers: { Cookie: cookie } })).status).toBe(200)
    expect((await s.req('/team-only', { headers: { Cookie: 'releases_preview=forged' } })).status).toBe(404)
    // Internal entries never reach the feed, JSON or unread counts.
    expect(await (await s.req('/feed.xml', { headers: { Cookie: cookie } })).text()).not.toMatch(/Team only/)
    const auth = s.userAuth(signUserToken(SECRET, { sub: 'u', exp: s.nowSec() + 60, since: '2026-01-01' }))
    expect(((await (await s.req('/api/me/unread', auth)).json()) as { unread: string[] }).unread).not.toContain('team-only')
  })

  it('preview is off without PREVIEW_TOKEN', async () => {
    const s = await setup()
    expect((await s.req('/preview?token=anything')).status).toBe(403)
  })
})
