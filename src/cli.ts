#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13) || (major === 23 && minor < 4)) {
  console.error(`@personizely/releases needs Node 22.13 or newer (it uses the built-in node:sqlite). You are running ${process.version}.`)
  console.error('With nvm: nvm install 22 && nvm use 22')
  process.exit(1)
}

// node:sqlite prints an ExperimentalWarning on Node 22; it is stable enough for two small tables.
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (String(warning).includes('SQLite')) return
  ;(emitWarning as (...a: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

const HELP = `releases: Markdown release notes with a public page, in-app embed and unread API

Usage
  releases init                Create releases/ with a config file and a first entry
  releases dev                 Preview with drafts and live reload
  releases serve               Run in production
  releases new "Title"         Scaffold releases/YYYY-MM-DD-title.md  [--type new|improved|fixed] [--date YYYY-MM-DD]
  releases check               Validate config and every entry; exits 1 on errors (use in CI)
  releases token <userId>      Print a test user token (needs RELEASES_SECRET)  [--ttl seconds]
  releases secret              Print a random value for RELEASES_SECRET
  releases skill               Add a release-notes skill for Claude Code to .claude/skills/  [--force]

Options
  --cwd <path>    Project folder (default: current folder)
  --dir <path>    Releases folder (default ./releases, env RELEASES_DIR)
  --port <n>      Port (default 3000, env PORT)

Environment
  RELEASES_SECRET   Enables /api/*. At least 32 characters.
  DATA_DIR          SQLite location (default ./.data). Mount a volume here in production.
  PUBLIC_URL        e.g. https://releases.personizely.net (otherwise taken from the request)
  ALLOWED_ORIGINS   CORS for /api/me/* (default *)
  FRAME_ANCESTORS   Who may iframe /embed (default *), e.g. https://app.personizely.net
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cwd: { type: 'string' },
    dir: { type: 'string' },
    port: { type: 'string' },
    type: { type: 'string', default: 'new' },
    date: { type: 'string' },
    ttl: { type: 'string', default: '3600' },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
})

const [cmd, ...rest] = positionals
const cwd = resolve(values.cwd ?? '.')
const overrides = {
  ...(values.dir ? { dir: values.dir } : {}),
  ...(values.port ? { port: Number(values.port) } : {}),
}

if (!cmd || values.help) {
  console.log(HELP)
  process.exit(cmd ? 0 : 1)
}

// Pick up RELEASES_* settings from the project's .env files (e.g. the same RELEASES_SECRET
// your app uses). Only that prefix is read, and real environment variables always win.
{
  const { readFileSync, existsSync: exists } = await import('node:fs')
  const { parseEnv } = await import('node:util')
  const fromFiles: Record<string, string> = {}
  for (const file of ['.env', '.env.local']) { // later files win, like Symfony and Vite
    const path = join(cwd, file)
    if (!exists(path)) continue
    try {
      for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
        if (key.startsWith('RELEASES_') && value) fromFiles[key] = value
      }
    } catch {
      // A .env we can't parse is not ours to complain about.
    }
  }
  for (const [key, value] of Object.entries(fromFiles)) process.env[key] ??= value
}

const { loadConfig } = await import('./config/load.js')
const today = () => new Date().toISOString().slice(0, 10)

try {
  switch (cmd) {
    case 'dev':
    case 'serve': {
      const { startServer } = await import('./server.js')
      const dev = cmd === 'dev'
      const cfg = await loadConfig(cwd, process.env, overrides)
      if (dev && !process.env.DATA_DIR) cfg.dataDir = join(cfg.dataDir, 'dev')
      const running = await startServer(cfg, { dev })
      const host = cfg.host === '0.0.0.0' ? 'localhost' : cfg.host
      console.log(`releases ${dev ? 'dev' : 'serve'}: ${running.releases.list().length} entries from ${relative(process.cwd(), cfg.dir) || '.'}`)
      console.log(`  page   http://${host}:${cfg.port}/`)
      console.log(`  embed  http://${host}:${cfg.port}/embed`)
      console.log(`  api    ${cfg.secret ? 'on' : 'off (set RELEASES_SECRET to enable)'}`)
      const stop = () => { void running.stop().then(() => process.exit(0)) }
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
      break
    }

    case 'init': {
      const dir = resolve(cwd, values.dir ?? 'releases')
      await mkdir(join(dir, 'assets'), { recursive: true })
      const configFile = join(cwd, 'releases.config.json')
      if (!existsSync(configFile)) {
        const relDir = relative(cwd, dir) || '.'
        await writeFile(configFile, JSON.stringify({
          $schema: './node_modules/@personizely/releases/dist/schema.json',
          name: 'Your product',
          description: 'New features, improvements and fixes.',
          ...(relDir !== 'releases' ? { dir: `./${relDir}` } : {}),
          colors: { accent: '#2f54eb' },
        }, null, 2) + '\n')
      }
      const first = await scaffold(dir, 'Our new changelog', 'new', today(), false)
      console.log(`Created ${relative(cwd, configFile)} and ${relative(cwd, first)}. Run: npx releases dev`)
      break
    }

    case 'new': {
      const title = rest.join(' ').trim()
      if (!title) throw new Error('Give the release a title: releases new "Profit per visitor in reports"')
      const { TYPES } = await import('./content/parse.js')
      if (!(TYPES as readonly string[]).includes(values.type!)) throw new Error(`--type must be one of ${TYPES.join(', ')}`)
      const cfg = await loadConfig(cwd, process.env, overrides)
      const file = await scaffold(cfg.dir, title, values.type!, values.date ?? today())
      console.log(`Created ${relative(process.cwd(), file)} (a draft: set draft: false to publish)`)
      break
    }

    case 'check': {
      const { loadReleases } = await import('./content/repository.js')
      const cfg = await loadConfig(cwd, process.env, overrides)
      const entries = await loadReleases(cfg.dir)
      const drafts = entries.filter(e => e.draft).length
      const scheduled = entries.filter(e => !e.draft && e.date > today()).length
      console.log(`OK: config valid, ${entries.length} entries (${drafts} drafts, ${scheduled} scheduled)`)
      break
    }

    case 'token': {
      const { signUserToken } = await import('./auth.js')
      const cfg = await loadConfig(cwd, process.env, overrides)
      if (!cfg.secret) throw new Error('Set RELEASES_SECRET first')
      if (!rest[0]) throw new Error('Usage: releases token <userId>')
      console.log(signUserToken(cfg.secret, { sub: rest[0], exp: Math.floor(Date.now() / 1000) + Number(values.ttl) }))
      break
    }

    case 'skill': {
      const { readFile } = await import('node:fs/promises')
      const template = await readFile(new URL('./templates/release-notes-skill.md', import.meta.url), 'utf8')
      const target = join(cwd, '.claude', 'skills', 'release-notes', 'SKILL.md')
      if (existsSync(target) && !values.force) throw new Error(`${relative(process.cwd(), target)} already exists. Use --force to overwrite it.`)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, template)
      console.log(`Created ${relative(process.cwd(), target)}. Fill in the <ANGLE BRACKET> placeholders for your project.`)
      break
    }

    case 'secret':
      console.log(randomBytes(32).toString('hex'))
      break

    default:
      throw new Error(`Unknown command "${cmd}". Run: releases --help`)
  }
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

async function scaffold (dir: string, title: string, type: string, date: string, draft = true): Promise<string> {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const file = join(dir, `${date}-${slug}.md`)
  if (existsSync(file)) throw new Error(`${relative(process.cwd(), file)} already exists`)
  await mkdir(dir, { recursive: true })
  await writeFile(file, `---
title: ${JSON.stringify(title)}
type: ${type}
tags: []
# image: assets/${slug}.png
# summary: One sentence for the in-app panel. Defaults to the first paragraph.
# announce: false   # keep it off the unread badge (minor fixes, backfills)
draft: ${draft}
---

What changed and why it matters, in one or two sentences.

## How to use it

- Step or detail
`)
  return file
}
