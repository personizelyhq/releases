import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * User tokens let a browser (the in-app panel or iframe) act for one user
 * without exposing the shared secret.
 *
 *   v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, "v1." + payload))>
 *
 * payload: { sub: "<user id>", exp: <unix seconds>, since?: "<ISO date>" }
 * `exp` is mandatory. Your backend mints these; see README for a PHP version.
 */
export function signUserToken (secret, { sub, exp, since }) {
  if (!secret) throw new Error('secret is required')
  if (sub == null || sub === '') throw new Error('sub is required')
  if (!Number.isInteger(exp)) throw new Error('exp (unix seconds) is required')
  const payload = b64url(JSON.stringify(since ? { sub: String(sub), exp, since } : { sub: String(sub), exp }))
  return `v1.${payload}.${sign(secret, 'v1.' + payload)}`
}

/** Returns the payload, or null for anything malformed, forged or expired. */
export function verifyUserToken (secret, token, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null

  const expected = Buffer.from(sign(secret, 'v1.' + parts[1]))
  const given = Buffer.from(parts[2])
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null

  let payload
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload.sub !== 'string' || !payload.sub) return null
  if (!Number.isInteger(payload.exp) || payload.exp <= nowSec) return null
  return payload
}

/** Constant-time check of `Authorization: Bearer <secret>` for server-to-server calls. */
export function isServerAuth (secret, header) {
  if (!secret || typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const a = createHmac('sha256', 'cmp').update(header.slice(7)).digest()
  const b = createHmac('sha256', 'cmp').update(secret).digest()
  return timingSafeEqual(a, b)
}

function sign (secret, data) {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

function b64url (s) {
  return Buffer.from(s, 'utf8').toString('base64url')
}
