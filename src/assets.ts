import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Package-owned static files (styles, embed script). Same relative spot in src/ and dist/. */
export const STATIC_DIR = fileURLToPath(new URL('./static/', import.meta.url))

/** Folder of the running code (dist/ when built). */
export const CODE_DIR = fileURLToPath(new URL('./', import.meta.url))

export const VERSION: string = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version

export const STYLES_URL = `/_releases/styles.css?v=${VERSION}`
export const EMBED_SCRIPT_URL = `/_releases/embed.js?v=${VERSION}`
