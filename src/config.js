import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULTS = {
  title: 'Changelog',
  description: 'New features, improvements and fixes.',
  url: '', // public base URL, e.g. https://releases.personizely.net (used in RSS and canonical links)
  homepage: null, // { label, href } shown in the header
  logo: null, // path or URL to a logo image
  accent: '#2f54eb',
  font: null, // { family: '"Inter", sans-serif', href: 'https://fonts.googleapis.com/...' }
  dir: './releases',
  dataDir: './.data',
  port: 3000,
  host: '0.0.0.0',
  secret: null,
  allowedOrigins: [], // origins allowed to call /api/me/* from a browser
  frameAncestors: ['*'], // who may embed /embed in an iframe
  tokenMaxAge: 60 * 60 * 24 * 30 // reject user tokens whose exp is further out than this (seconds)
}

/**
 * Zero config by default. Optional releases.config.{js,mjs,json} in cwd,
 * then environment variables on top (env wins, so Coolify can override anything).
 */
export async function loadConfig (cwd = process.cwd(), env = process.env, overrides = {}) {
  // The config file can sit next to package.json or inside the releases folder itself.
  const guessDir = resolve(cwd, overrides.dir || env.RELEASES_DIR || DEFAULTS.dir)
  const file = { ...(await readConfigFile(guessDir)), ...(await readConfigFile(cwd)) }
  const cfg = { ...DEFAULTS, ...file, ...overrides }

  if (env.RELEASES_DIR) cfg.dir = env.RELEASES_DIR
  if (env.DATA_DIR) cfg.dataDir = env.DATA_DIR
  if (env.PORT) cfg.port = Number(env.PORT)
  if (env.HOST) cfg.host = env.HOST
  if (env.PUBLIC_URL) cfg.url = env.PUBLIC_URL
  if (env.RELEASES_SECRET) cfg.secret = env.RELEASES_SECRET
  if (env.ALLOWED_ORIGINS) cfg.allowedOrigins = splitList(env.ALLOWED_ORIGINS)
  if (env.FRAME_ANCESTORS) cfg.frameAncestors = splitList(env.FRAME_ANCESTORS)

  cfg.dir = resolve(cwd, cfg.dir)
  cfg.dataDir = cfg.dataDir === ':memory:' ? cfg.dataDir : resolve(cwd, cfg.dataDir)
  cfg.url = String(cfg.url || '').replace(/\/+$/, '')
  if (cfg.secret && cfg.secret.length < 32) {
    throw new Error('RELEASES_SECRET must be at least 32 characters (try: openssl rand -hex 32)')
  }
  return cfg
}

async function readConfigFile (cwd) {
  for (const name of ['releases.config.js', 'releases.config.mjs']) {
    const p = join(cwd, name)
    if (existsSync(p)) {
      const mod = await import(pathToFileURL(p).href)
      return mod.default ?? mod
    }
  }
  const json = join(cwd, 'releases.config.json')
  if (existsSync(json)) return JSON.parse(await readFile(json, 'utf8'))
  return {}
}

function splitList (s) {
  return s.split(/[\s,]+/).filter(Boolean)
}
