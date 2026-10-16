import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { configSchema, type ResolvedConfig, type UserConfig } from './schema.js'

const FILES = ['releases.config.ts', 'releases.config.mts', 'releases.config.js', 'releases.config.mjs', 'releases.config.json']

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>

/**
 * Zero config by default. Looks for releases.config.* in `cwd`, then inside the
 * releases folder, then applies environment variables (env always wins, so a
 * deployment can override anything without touching the repo).
 */
export async function loadConfig (cwd = process.cwd(), env: Env = process.env, overrides: Partial<UserConfig> = {}): Promise<ResolvedConfig> {
  const guessDir = resolve(cwd, overrides.dir ?? env.RELEASES_DIR ?? './releases')
  const atRoot = await findConfig(cwd)
  const found = atRoot ?? (await findConfig(guessDir))
  const fromFile: UserConfig = { ...found?.config }
  // A config inside the releases folder describes that folder; other paths stay relative to cwd.
  if (found && !atRoot && fromFile.dir === undefined) fromFile.dir = guessDir
  const root = atRoot ? atRoot.root : cwd

  const merged: Record<string, unknown> = { ...fromFile, ...overrides }
  if (env.RELEASES_DIR) merged.dir = env.RELEASES_DIR
  if (env.DATA_DIR) merged.dataDir = env.DATA_DIR
  if (env.PORT) merged.port = Number(env.PORT)
  if (env.HOST) merged.host = env.HOST
  if (env.PUBLIC_URL) merged.url = env.PUBLIC_URL
  if (env.ALLOWED_ORIGINS) merged.allowedOrigins = splitList(env.ALLOWED_ORIGINS)
  if (env.FRAME_ANCESTORS) merged.frameAncestors = splitList(env.FRAME_ANCESTORS)
  if ('secret' in merged) throw new ConfigError('Do not put the secret in the config file. Set RELEASES_SECRET in the environment.')
  if ('previewToken' in merged) throw new ConfigError('Do not put the preview token in the config file. Set PREVIEW_TOKEN in the environment.')

  const parsed = configSchema.safeParse(merged)
  if (!parsed.success) {
    throw new ConfigError(`Invalid config${found ? ` in ${found.file}` : ''}:\n${z.prettifyError(parsed.error)}`)
  }

  const secret = env.RELEASES_SECRET || null
  const previewToken = env.PREVIEW_TOKEN || null
  if (previewToken && previewToken.length < 16) throw new ConfigError('PREVIEW_TOKEN must be at least 16 characters.')
  if (secret && secret.length < 32) throw new ConfigError('RELEASES_SECRET must be at least 32 characters. Generate one with: npx releases secret')

  // Paths written in the config file resolve against the file; paths from env, flags
  // and defaults against cwd (so the default .data never lands inside releases/).
  const configDir = found?.root ?? cwd
  const dirBase = env.RELEASES_DIR || overrides.dir ? cwd : found?.config.dir !== undefined ? configDir : root
  const dataBase = env.DATA_DIR || overrides.dataDir ? cwd : found?.config.dataDir !== undefined ? configDir : root
  return {
    ...parsed.data,
    url: parsed.data.url?.replace(/\/+$/, ''),
    dir: resolve(dirBase, parsed.data.dir),
    dataDir: parsed.data.dataDir === ':memory:' ? ':memory:' : resolve(dataBase, parsed.data.dataDir),
    secret,
    previewToken,
    root,
    configDir,
  }
}

async function findConfig (dir: string): Promise<{ file: string; root: string; config: UserConfig } | null> {
  for (const name of FILES) {
    const file = join(dir, name)
    if (!existsSync(file)) continue
    if (name.endsWith('.json')) {
      const data = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
      delete data.$schema
      return { file, root: dir, config: data as UserConfig }
    }
    try {
      const mod = (await import(pathToFileURL(file).href)) as { default?: UserConfig }
      return { file, root: dir, config: mod.default ?? (mod as UserConfig) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_UNKNOWN_FILE_EXTENSION') {
        throw new ConfigError(`${name} needs Node 22.18+ to load TypeScript directly. Upgrade Node or rename it to releases.config.js.`)
      }
      throw err
    }
  }
  return null
}

function splitList (s: string): string[] {
  return s.split(/[\s,]+/).filter(Boolean)
}
