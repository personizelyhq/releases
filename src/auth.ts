import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * User tokens let the browser (in-app panel or iframe) act for one user
 * without ever seeing the shared secret.
 *
 *   v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, "v1." + payload))>
 *
 * Your backend mints them; a PHP version is in examples/host/ReleasesToken.php.
 */
export interface UserTokenPayload {
  /** User id. */
  sub: string
  /** Expiry, unix seconds. Required. */
  exp: number
  /** ISO date the user's unread history starts from, usually their signup date. */
  since?: string
}

export function signUserToken (secret: string, { sub, exp, since }: UserTokenPayload): string {
  if (!secret) throw new Error('secret is required')
  if (!sub) throw new Error('sub is required')
  if (!Number.isInteger(exp)) throw new Error('exp (unix seconds) is required')
  const body: UserTokenPayload = since ? { sub: String(sub), exp, since } : { sub: String(sub), exp }
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')
  return `v1.${payload}.${sign(secret, `v1.${payload}`)}`
}

/** The payload, or null for anything malformed, forged or expired. */
export function verifyUserToken (secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)): UserTokenPayload | null {
  if (!secret || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const [, payload, signature] = parts as [string, string, string]

  if (!safeEqual(sign(secret, `v1.${payload}`), signature)) return null

  let data: unknown
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const { sub, exp, since } = data as Record<string, unknown>
  if (typeof sub !== 'string' || !sub) return null
  if (typeof exp !== 'number' || !Number.isInteger(exp) || exp <= nowSec) return null
  return typeof since === 'string' ? { sub, exp, since } : { sub, exp }
}

/** Constant-time comparison that does not leak length. */
export function safeEqual (a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest()
  const hb = createHmac('sha256', 'cmp').update(b).digest()
  return timingSafeEqual(ha, hb)
}

function sign (secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}
