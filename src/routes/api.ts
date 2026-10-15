import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { safeEqual, verifyUserToken, type UserTokenPayload } from '../auth.js'
import type { ResolvedConfig } from '../config/schema.js'
import type { Releases } from '../releases.js'

type UserEnv = { Variables: { user: UserTokenPayload } }

/**
 * /api/me/*     browser calls with a user token minted by your backend
 * /api/users/*  server-to-server calls with RELEASES_SECRET
 */
export function apiRoutes (cfg: ResolvedConfig, releases: Releases, now: () => Date, baseUrl: (url: string, headers: Headers) => string): Hono {
  const api = new Hono()
  const secret = cfg.secret

  api.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  if (!secret) {
    api.all('*', c => c.json({ error: 'The API is disabled. Set RELEASES_SECRET to enable it.' }, 404))
    return api
  }

  // Bearer tokens in a header, never cookies, so a permissive origin list is safe.
  const me = new Hono<UserEnv>()
  me.use('*', cors({
    origin: cfg.allowedOrigins.includes('*') ? '*' : cfg.allowedOrigins,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }))
  me.use('*', userAuth(secret, cfg.tokenMaxAge, now))
  me.get('/unread', c => {
    const user = c.get('user')
    return c.json(releases.unreadFor(user.sub, user.since, baseUrl(c.req.url, c.req.raw.headers)))
  })
  me.post('/seen', c => c.json({ lastSeenAt: releases.markSeen(c.get('user').sub) }))

  const server = new Hono()
  server.use('*', bearerAuth({ verifyToken: token => safeEqual(token, secret) }))
  server.get('/users/:id{[^/]{1,128}}/unread', c => c.json(releases.unreadFor(c.req.param('id'), c.req.query('since'), baseUrl(c.req.url, c.req.raw.headers))))
  server.post('/users/:id{[^/]{1,128}}/seen', c => c.json({ lastSeenAt: releases.markSeen(c.req.param('id')) }))
  server.post('/reload', async c => c.json({ entries: await releases.reload() }))

  api.route('/me', me)
  api.route('/', server)
  return api
}

function userAuth (secret: string, maxAge: number, now: () => Date) {
  return createMiddleware<UserEnv>(async (c, next) => {
    if (c.req.method === 'OPTIONS') return next()
    const header = c.req.header('Authorization') ?? ''
    const nowSec = Math.floor(now().getTime() / 1000)
    const payload = header.startsWith('Bearer ') ? verifyUserToken(secret, header.slice(7), nowSec) : null
    if (!payload || payload.exp > nowSec + maxAge) {
      return c.json({ error: 'Missing, invalid or expired user token.' }, 401)
    }
    c.set('user', payload)
    await next()
  })
}
