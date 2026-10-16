import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Package-owned static files (styles, embed script). Same relative spot in src/ and dist/. */
export const STATIC_DIR = fileURLToPath(new URL('./static/', import.meta.url))

/** Folder of the running code (dist/ when built). */
export const CODE_DIR = fileURLToPath(new URL('./', import.meta.url))

export const VERSION: string = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version

/**
 * Short content hash of a static file. It goes in the path, not the query string,
 * because CDNs set to ignore query strings (Cloudflare's "Ignore query string")
 * would otherwise keep serving the old file under the year-long immutable cache.
 */
function hashOf (file: string): string {
  return createHash('sha256').update(readFileSync(new URL(`./static/${file}`, import.meta.url))).digest('hex').slice(0, 10)
}

export const STYLES_URL = `/_releases/${hashOf('styles.css')}/styles.css`
export const EMBED_SCRIPT_URL = `/_releases/${hashOf('embed.js')}/embed.js`
