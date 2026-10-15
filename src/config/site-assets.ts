import { existsSync, statSync } from 'node:fs'
import { extname, isAbsolute, resolve } from 'node:path'
import { ConfigError } from './load.js'
import type { ResolvedConfig } from './schema.js'

/**
 * Icons and images in the config can be a URL, a file in releases/assets/, or a
 * path to any file on disk, relative to the config file (e.g. "../public/favicon.ico"
 * to reuse your app's favicon). Files on disk are served from /_site/<name>.
 */
export function resolveSiteAssets (cfg: ResolvedConfig): { cfg: ResolvedConfig; files: Map<string, string> } {
  const files = new Map<string, string>()

  const resolveOne = (value: string | undefined, name: string): string | undefined => {
    if (!value) return value
    if (/^https?:\/\//.test(value) || /^\.?\/?assets\//.test(value)) return value
    const file = isAbsolute(value) ? value : resolve(cfg.configDir, value)
    if (existsSync(file) && statSync(file).isFile()) {
      const path = `/_site/${name}${extname(file).toLowerCase()}`
      files.set(path, file)
      return path
    }
    if (value.startsWith('/')) return value // a URL path on this host
    throw new ConfigError(`${name}: file not found: ${file}`)
  }

  const logo = typeof cfg.logo === 'object'
    ? { light: resolveOne(cfg.logo.light, 'logo')!, dark: resolveOne(cfg.logo.dark, 'logo-dark')! }
    : resolveOne(cfg.logo, 'logo')

  return {
    files,
    cfg: {
      ...cfg,
      logo,
      favicon: resolveOne(cfg.favicon, 'favicon'),
      appleTouchIcon: resolveOne(cfg.appleTouchIcon, 'apple-touch-icon'),
      ogImage: resolveOne(cfg.ogImage, 'og-image'),
    },
  }
}
