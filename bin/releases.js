#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { randomBytes } from 'node:crypto'

// node:sqlite prints an ExperimentalWarning on Node 22; it is stable enough for one small table.
const emitWarning = process.emitWarning
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : emitWarning.call(process, w, ...a))

const { loadConfig } = await import('../src/config.js')
const { loadReleases, TYPES } = await import('../src/content.js')
const { startServer } = await import('../src/server.js')
const { signUserToken } = await import('../src/auth.js')

const HELP = `releases — Markdown release notes with a public page, in-app embed and unread API

Usage
  releases dev                 Preview locally with drafts and live reload (port 3000)
  releases serve               Run in production
  releases new "Title"         Create releases/YYYY-MM-DD-title.md  [--type new|improved|fixed] [--date YYYY-MM-DD]
  releases check               Validate every file (use in CI); exits 1 on errors
  releases token <userId>      Print a test user token (needs RELEASES_SECRET)  [--ttl seconds]
  releases secret              Print a random secret for RELEASES_SECRET

Options
  --dir <path>    Releases folder (default ./releases, env RELEASES_DIR)
  --port <n>      Port (default 3000, env PORT)

Environment
  RELEASES_SECRET   Enables /api/*. At least 32 characters.
  DATA_DIR          Where the SQLite file lives (default ./.data). Mount a volume here.
  PUBLIC_URL        e.g. https://releases.personizely.net
  ALLOWED_ORIGINS   CORS for /api/me/* (default *; user tokens are bearer, no cookies)
  FRAME_ANCESTORS   Who may iframe /embed (default *), e.g. https://app.personizely.net
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string' },
    port: { type: 'string' },
    type: { type: 'string', default: 'new' },
    date: { type: 'string' },
    ttl: { type: 'string', default: '3600' },
    help: { type: 'boolean', short: 'h' }
  }
})

const [cmd, ...rest] = positionals
const overrides = {}
if (values.dir) overrides.dir = values.dir
if (values.port) overrides.port = Number(values.port)

if (!cmd || values.help) {
  console.log(HELP)
  process.exit(cmd ? 0 : 1)
}

try {
  if (cmd === 'dev' || cmd === 'serve') {
    const dev = cmd === 'dev'
    const cfg = await loadConfig(process.cwd(), process.env, overrides)
    if (dev && !process.env.DATA_DIR && !overrides.dataDir) cfg.dataDir = join(cfg.dataDir, 'dev')
    const { close, app } = await startServer(cfg, { dev })
    const shown = cfg.host === '0.0.0.0' ? 'localhost' : cfg.host
    console.log(`[releases] ${app.entries().length} entries from ${relative(process.cwd(), cfg.dir) || '.'}`)
    console.log(`[releases] ${dev ? 'dev' : 'serving'} on http://${shown}:${cfg.port}  (embed: /embed, api: ${cfg.secret ? 'on' : 'off, set RELEASES_SECRET'})`)
    const stop = () => close().then(() => process.exit(0))
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  } else if (cmd === 'new') {
    const title = rest.join(' ').trim()
    if (!title) throw new Error('Give the release a title: releases new "Profit per visitor in reports"')
    if (!TYPES.includes(values.type)) throw new Error(`--type must be one of ${TYPES.join(', ')}`)
    const cfg = await loadConfig(process.cwd(), process.env, overrides)
    const date = values.date || new Date().toISOString().slice(0, 10)
    const slug = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    const file = join(cfg.dir, `${date}-${slug}.md`)
    if (existsSync(file)) throw new Error(`${relative(process.cwd(), file)} already exists`)
    await mkdir(cfg.dir, { recursive: true })
    await writeFile(file, `---
title: ${JSON.stringify(title)}
type: ${values.type}
tags: []
# image: assets/${slug}.png
# summary: One sentence shown in the in-app panel. Defaults to the first paragraph.
# announce: false   # keep it off the unread badge (backfills, minor fixes)
draft: true
---

What changed and why it matters to the merchant, in one or two sentences.

## How to use it

- Step or detail
`)
    console.log(`Created ${relative(process.cwd(), file)} (draft: set draft: false to publish)`)
  } else if (cmd === 'check') {
    const cfg = await loadConfig(process.cwd(), process.env, overrides)
    const entries = await loadReleases(cfg.dir)
    const drafts = entries.filter(e => e.draft).length
    const today = new Date().toISOString().slice(0, 10)
    const scheduled = entries.filter(e => !e.draft && e.date > today).length
    console.log(`OK: ${entries.length} entries (${drafts} drafts, ${scheduled} scheduled)`)
  } else if (cmd === 'token') {
    const cfg = await loadConfig(process.cwd(), process.env, overrides)
    if (!cfg.secret) throw new Error('Set RELEASES_SECRET first')
    if (!rest[0]) throw new Error('Usage: releases token <userId>')
    console.log(signUserToken(cfg.secret, { sub: rest[0], exp: Math.floor(Date.now() / 1000) + Number(values.ttl) }))
  } else if (cmd === 'secret') {
    console.log(randomBytes(32).toString('hex'))
  } else {
    throw new Error(`Unknown command "${cmd}". Run releases --help`)
  }
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
