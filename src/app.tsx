import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { html } from 'hono/html'
import { streamSSE } from 'hono/streaming'
import type { JSX } from 'hono/jsx/jsx-runtime'
import type { ResolvedConfig } from './config/schema.js'
import { TYPES, type ReleaseType } from './content/parse.js'
import { Repository } from './content/repository.js'
import { Releases } from './releases.js'
import { Store } from './store.js'
import { CODE_DIR, STATIC_DIR } from './assets.js'
import { resolveSiteAssets } from './config/site-assets.js'
import { faviconSvg, iconLinks, robots, sitemap } from './seo.js'
import { dirname, basename } from 'node:path'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createHmac } from 'node:crypto'
import { safeEqual } from './auth.js'
import { apiRoutes } from './routes/api.js'
import { rssFeed } from './views/feed.js'
import type { PageContext } from './views/layout.js'
import { EmbedPage, EntryPage, ListPage, NotFoundPage } from './views/pages.js'

export interface AppOptions {
  /** Show drafts and future-dated entries, reload on file changes, live-reload the browser. */
  dev?: boolean
  /** Clock override, for tests. */
  now?: () => Date
  logger?: Pick<Console, 'info' | 'error'>
}

export interface ReleasesApp {
  app: Hono
  releases: Releases
  close: () => void
}

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

export async function createApp (inputCfg: ResolvedConfig, opts: AppOptions = {}): Promise<ReleasesApp> {
  const { cfg, files: siteFiles } = resolveSiteAssets(inputCfg)
  const dev = opts.dev ?? false
  const now = opts.now ?? (() => new Date())
  const log = opts.logger ?? console

  const repo = new Repository(cfg.dir, { preview: dev, now })
  await repo.load()
  const store = new Store(cfg.dataDir)
  const releases = new Releases(repo, store, now)
  if (dev) repo.watch(err => log.error(err.message))

  /** Configured URL, or what the request (and a proxy such as Coolify's Traefik) says. */
  const baseUrl = (url: string, headers: Headers): string => {
    if (cfg.url) return cfg.url
    const u = new URL(url)
    const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || u.protocol.replace(':', '')
    const host = headers.get('x-forwarded-host')?.split(',')[0]?.trim() || headers.get('host') || u.host
    return `${proto}://${host}`
  }

  const app = new Hono<{ Variables: { page: PageContext } }>()

  // Team preview: /preview?token=PREVIEW_TOKEN sets a cookie that shows drafts and internal entries.
  const PREVIEW_COOKIE = 'releases_preview'
  const previewSig = cfg.previewToken ? createHmac('sha256', cfg.previewToken).update('releases-preview').digest('base64url') : null
  const hasPreviewCookie = (c: Context) => {
    const v = previewSig ? getCookie(c, PREVIEW_COOKIE) : undefined
    return !!v && safeEqual(v, previewSig!)
  }

  app.use('*', async (c, next) => {
    releases.sync()
    const teamPreview = !dev && hasPreviewCookie(c)
    c.set('page', { cfg, baseUrl: baseUrl(c.req.url, c.req.raw.headers), live: dev, preview: dev || teamPreview, teamPreview })
    await next()
    if (teamPreview) c.header('Cache-Control', 'private, no-store')
    if (previewSig) c.header('Vary', 'Cookie', { append: true })
  })

  app.get('/preview', c => {
    const token = c.req.query('token') ?? ''
    if (!cfg.previewToken || !safeEqual(token, cfg.previewToken)) return c.text('Preview is not enabled, or the token is wrong.', 403)
    const secure = c.var.page.baseUrl.startsWith('https:')
    setCookie(c, PREVIEW_COOKIE, previewSig!, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
    c.header('Referrer-Policy', 'no-referrer')
    return c.redirect('/', 302)
  })
  app.get('/preview/exit', c => {
    deleteCookie(c, PREVIEW_COOKIE, { path: '/' })
    return c.redirect('/', 302)
  })

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    log.error(err)
    return c.text('Internal error', 500)
  })

  app.route('/api', apiRoutes(cfg, releases, now, baseUrl))

  app.get('/health', c => c.json({ ok: true, entries: releases.list().length }))

  if (dev) {
    app.get('/_releases/live', c => streamSSE(c, async stream => {
      const off = repo.onChange(() => { void stream.writeSSE({ data: 'reload' }) })
      stream.onAbort(off)
      while (!stream.aborted) await stream.sleep(30_000)
    }))
  }
  // The browser client as a plain ES module, for pages without a bundler.
  app.get('/client.js', c => serveFile(c, CODE_DIR, 'client.js', 'public, max-age=300', { 'Access-Control-Allow-Origin': '*' }))
  // Icons from the config, the default favicon, and what search engines ask for.
  app.get('/_site/:file', c => {
    const file = siteFiles.get(c.req.path)
    return file ? serveFile(c, dirname(file), basename(file), dev ? 'no-cache' : 'public, max-age=86400') : c.notFound()
  })
  app.get('/_releases/favicon.svg', c => c.body(faviconSvg(cfg), 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }))
  app.get('/favicon.ico', c => {
    const { favicon } = iconLinks(cfg)
    if (/^https?:\/\//.test(favicon)) return c.redirect(favicon, 301)
    const local = siteFiles.get(favicon)
    if (local) return serveFile(c, dirname(local), basename(local), 'public, max-age=86400')
    if (favicon.startsWith('/assets/')) return serveFile(c, join(cfg.dir, 'assets'), favicon.slice('/assets/'.length), 'public, max-age=86400')
    return c.body(faviconSvg(cfg), 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' })
  })
  app.get('/robots.txt', c => c.text(robots(cfg, c.var.page.baseUrl), 200, { 'Cache-Control': 'public, max-age=3600' }))
  app.get('/sitemap.xml', c => c.body(sitemap(cfg, c.var.page.baseUrl, releases.list()), 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }))

  // Hashed URLs (see assets.ts) never change content, so they can be cached for a year.
  // The hash is not checked: an old page asking for an old hash gets the current file.
  app.get('/_releases/:hash{[0-9a-f]{10}}/:file', c => serveFile(c, STATIC_DIR, c.req.param('file'), dev ? 'no-cache' : 'public, max-age=31536000, immutable'))
  app.get('/_releases/:file', c => serveFile(c, STATIC_DIR, c.req.param('file'), dev ? 'no-cache' : 'public, max-age=300'))
  app.get('/assets/*', c => serveFile(c, join(cfg.dir, 'assets'), c.req.path.slice('/assets/'.length), dev ? 'no-cache' : 'public, max-age=86400'))

  app.get('/feed.xml', c => {
    c.header('Content-Type', 'application/rss+xml; charset=utf-8')
    c.header('Cache-Control', 'public, max-age=300')
    return c.body(rssFeed(cfg, c.var.page.baseUrl, releases.list()))
  })

  app.get('/releases.json', c => {
    const base = c.var.page.baseUrl
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Cache-Control', 'public, max-age=60')
    return c.json({
      name: cfg.name,
      url: base,
      releases: releases.list().map(e => ({
        ...releases.summary(e, base),
        tags: e.tags,
        image: e.image && !/^https?:/.test(e.image) ? base + e.image : e.image,
        announce: e.announce,
        html: e.html,
      })),
    })
  })

  app.get('/embed', c => {
    const t = c.req.query('theme')
    const theme = t === 'light' || t === 'dark' ? t : 'auto'
    c.header('Content-Security-Policy', `frame-ancestors ${cfg.frameAncestors.join(' ')}`)
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Robots-Tag', 'noindex')
    return page(c, <EmbedPage ctx={c.var.page} entries={releases.list()} theme={theme} />)
  })

  const listPage = (c: Context<{ Variables: { page: PageContext } }>, n: number) => {
    const t = c.req.query('type')
    const type = TYPES.includes(t as ReleaseType) ? (t as ReleaseType) : null
    const entries = releases.list(c.var.page.preview)
    const total = type ? entries.filter(e => e.type === type).length : entries.length
    if (n < 1 || (n > 1 && (n - 1) * cfg.perPage >= total)) return page(c, <NotFoundPage ctx={c.var.page} />, 404)
    return page(c, <ListPage ctx={c.var.page} entries={entries} type={type} page={n} />)
  }
  app.get('/', c => listPage(c, Number(c.req.query('page') ?? 1) || 1))
  app.get('/page/:n{[0-9]+}', c => {
    const n = Number(c.req.param('n'))
    if (n === 1) return c.redirect('/', 301)
    return listPage(c, n)
  })

  app.get('/:slug{[a-z0-9][a-z0-9-]*}', c => {
    const found = repo.find(c.req.param('slug'), c.var.page.preview)
    if (!found) return page(c, <NotFoundPage ctx={c.var.page} />, 404)
    return page(c, <EntryPage ctx={c.var.page} {...found} />)
  })

  app.notFound(c => page(c, <NotFoundPage ctx={c.var.page} />, 404))

  return {
    app: app as unknown as Hono,
    releases,
    close: () => { repo.close(); store.close() },
  }

  function page (c: Context, node: JSX.Element, status: 200 | 404 = 200) {
    c.header('X-Content-Type-Options', 'nosniff')
    if (!c.res.headers.has('Content-Security-Policy')) c.header('Content-Security-Policy', "frame-ancestors 'none'")
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', dev ? 'no-cache' : 'public, max-age=60')
    return c.html(html`<!doctype html>${node}`, status)
  }
}

async function serveFile (c: Context, root: string, rel: string, cacheControl: string, extra: Record<string, string> = {}) {
  const full = normalize(join(root, decodeURIComponent(rel)))
  const type = MIME[extname(full).toLowerCase()]
  if (!type || !full.startsWith(normalize(root + sep))) return c.notFound()
  try {
    if (!(await stat(full)).isFile()) return c.notFound()
    const body = await readFile(full)
    return c.body(body, 200, { 'Content-Type': type, 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff', ...extra })
  } catch {
    return c.notFound()
  }
}
