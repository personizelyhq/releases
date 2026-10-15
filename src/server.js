import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadReleases, dirSignature } from './content.js'
import { Store } from './store.js'
import { verifyUserToken, isServerAuth } from './auth.js'
import { listPage, entryPage, embedPage, notFoundPage, rssFeed } from './views.js'
import { TYPES } from './content.js'

const STATIC_DIR = fileURLToPath(new URL('./static/', import.meta.url))
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}
const LATEST_LIMIT = 5

/**
 * Create the request handler plus helpers. `dev` shows drafts and future-dated
 * entries and reloads content when files change.
 */
export async function createApp (cfg, { dev = false, now = () => new Date(), log = console } = {}) {
  const store = new Store(cfg.dataDir)
  let all = await loadReleases(cfg.dir)
  let signature = dev ? await dirSignature(cfg.dir) : 0

  const today = () => now().toISOString().slice(0, 10)
  // Visible = not a draft and not scheduled for later. Dev shows everything.
  const visible = () => dev ? all : all.filter(e => !e.draft && e.date <= today())

  const sync = () => store.syncPublished(visible().filter(e => !e.draft), now())
  sync()

  async function refresh () {
    if (dev) {
      const sig = await dirSignature(cfg.dir)
      if (sig !== signature) {
        signature = sig
        try {
          all = await loadReleases(cfg.dir)
          log.info?.(`[releases] reloaded ${all.length} entries`)
        } catch (err) {
          log.error?.(err.message)
        }
      }
    }
    sync()
  }

  async function reload () {
    all = await loadReleases(cfg.dir)
    sync()
    return all.length
  }

  function unreadFor (userKey, since) {
    const lastSeen = store.lastSeen(userKey, since, now())
    const unread = visible().filter(e => e.announce && !e.draft && (store.publishedAt(e.slug) ?? '') > lastSeen)
    return {
      count: unread.length,
      lastSeenAt: lastSeen,
      unread: unread.map(e => e.slug),
      latest: unread.slice(0, LATEST_LIMIT).map(publicSummary(cfg))
    }
  }

  async function handle (req, res) {
    const url = new URL(req.url, 'http://local')
    const path = decodeURIComponent(url.pathname)
    const method = req.method

    try {
      await refresh()

      if (path.startsWith('/api/')) return await api(req, res, url, path, method)
      if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' })

      if (path === '/health') return json(res, 200, { ok: true, entries: visible().length })
      if (path.startsWith('/_releases/')) return await serveFile(res, STATIC_DIR, path.slice('/_releases/'.length), 'public, max-age=300')
      if (path.startsWith('/assets/')) return await serveFile(res, join(cfg.dir, 'assets'), path.slice('/assets/'.length), 'public, max-age=86400')

      const entries = visible()
      if (path === '/' || path === '') {
        const type = TYPES.includes(url.searchParams.get('type')) ? url.searchParams.get('type') : null
        return htmlRes(res, 200, listPage(cfg, entries, { type }))
      }
      if (path === '/embed') {
        const theme = url.searchParams.get('theme') || 'auto'
        return htmlRes(res, 200, embedPage(cfg, entries, { theme }), embedHeaders(cfg))
      }
      if (path === '/feed.xml') return send(res, 200, rssFeed(cfg, entries), { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
      if (path === '/releases.json') {
        return json(res, 200, { title: cfg.title, url: cfg.url || null, releases: entries.map(publicEntry(cfg)) }, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' })
      }

      const slug = path.slice(1).replace(/\/$/, '')
      const i = entries.findIndex(e => e.slug === slug)
      if (i !== -1) return htmlRes(res, 200, entryPage(cfg, entries[i], { next: entries[i - 1], prev: entries[i + 1] }))

      return htmlRes(res, 404, notFoundPage(cfg))
    } catch (err) {
      log.error?.(err)
      if (!res.headersSent) send(res, 500, 'Internal error')
    }
  }

  async function api (req, res, url, path, method) {
    const cors = corsHeaders(cfg, req.headers.origin)
    if (method === 'OPTIONS') return send(res, 204, '', { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' })
    if (!cfg.secret) return json(res, 404, { error: 'The API is disabled. Set RELEASES_SECRET to enable it.' }, cors)

    const noStore = { ...cors, 'Cache-Control': 'no-store' }

    // Browser calls: Authorization: Bearer <user token minted by your backend>
    if (path === '/api/me/unread' || path === '/api/me/seen') {
      const user = userFromToken(cfg, req.headers.authorization, now())
      if (!user) return json(res, 401, { error: 'Missing, invalid or expired user token.' }, noStore)
      if (path === '/api/me/unread' && method === 'GET') return json(res, 200, unreadFor(user.sub, user.since), noStore)
      if (path === '/api/me/seen' && method === 'POST') return json(res, 200, { lastSeenAt: store.markSeen(user.sub, now()) }, noStore)
      return json(res, 405, { error: 'Method not allowed' }, noStore)
    }

    // Server-to-server calls: Authorization: Bearer <RELEASES_SECRET>
    if (!isServerAuth(cfg.secret, req.headers.authorization)) return json(res, 401, { error: 'Invalid secret.' }, { 'Cache-Control': 'no-store' })

    const m = /^\/api\/users\/([^/]{1,128})\/(unread|seen)$/.exec(path)
    if (m) {
      const [, id, action] = m
      if (action === 'unread' && method === 'GET') return json(res, 200, unreadFor(id, url.searchParams.get('since')), { 'Cache-Control': 'no-store' })
      if (action === 'seen' && method === 'POST') return json(res, 200, { lastSeenAt: store.markSeen(id, now()) }, { 'Cache-Control': 'no-store' })
      return json(res, 405, { error: 'Method not allowed' })
    }
    if (path === '/api/reload' && method === 'POST') return json(res, 200, { entries: await reload() })

    return json(res, 404, { error: 'Not found' })
  }

  return { handle, store, reload, unreadFor, entries: visible }
}

export async function startServer (cfg, opts = {}) {
  const app = await createApp(cfg, opts)
  const server = createServer(app.handle)
  await new Promise(resolve => server.listen(cfg.port, cfg.host, resolve))
  const close = () => new Promise(resolve => server.close(() => { app.store.close(); resolve() }))
  return { server, app, close }
}

function userFromToken (cfg, header, now) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  const nowSec = Math.floor(now.getTime() / 1000)
  const payload = verifyUserToken(cfg.secret, header.slice(7), nowSec)
  if (!payload || payload.exp > nowSec + cfg.tokenMaxAge) return null
  return payload
}

function corsHeaders (cfg, origin) {
  const allowed = cfg.allowedOrigins
  if (!allowed.length) return {}
  if (allowed.includes('*')) return { 'Access-Control-Allow-Origin': '*' }
  if (origin && allowed.includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
  return { Vary: 'Origin' }
}

function embedHeaders (cfg) {
  return {
    'Content-Security-Policy': `frame-ancestors ${cfg.frameAncestors.join(' ')}`,
    'Cache-Control': 'public, max-age=60',
    'Referrer-Policy': 'no-referrer'
  }
}

const publicSummary = cfg => e => ({
  slug: e.slug,
  title: e.title,
  date: e.date,
  type: e.type,
  summary: e.summary,
  url: (cfg.url || '') + '/' + e.slug
})

const publicEntry = cfg => e => ({
  ...publicSummary(cfg)(e),
  tags: e.tags,
  image: e.image ? (cfg.url || '') + e.image : null,
  announce: e.announce,
  html: e.html
})

async function serveFile (res, root, rel, cacheControl) {
  const full = normalize(join(root, rel))
  if (!full.startsWith(normalize(root + sep)) || !MIME[extname(full).toLowerCase()]) return send(res, 404, 'Not found')
  try {
    const s = await stat(full)
    if (!s.isFile()) return send(res, 404, 'Not found')
    const body = await readFile(full)
    return send(res, 200, body, { 'Content-Type': MIME[extname(full).toLowerCase()], 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' })
  } catch {
    return send(res, 404, 'Not found')
  }
}

function htmlRes (res, status, body, headers = {}) {
  return send(res, status, body, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "frame-ancestors 'none'",
    ...headers
  })
}

function json (res, status, data, headers = {}) {
  return send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', ...headers })
}

function send (res, status, body, headers = {}) {
  res.writeHead(status, headers)
  res.end(res.req?.method === 'HEAD' ? undefined : body)
}
