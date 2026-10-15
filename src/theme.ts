import { assetUrl } from './content/parse.js'
import type { ResolvedConfig } from './config/schema.js'

type ThemedColor = string | { light: string; dark: string }

const toCss = (c: ThemedColor): string => (typeof c === 'string' ? c : `light-dark(${c.light}, ${c.dark})`)

/** CSS custom properties from the config, layered over the defaults in styles.css. */
export function themeCss (cfg: ResolvedConfig): string {
  const { colors } = cfg
  const vars: Record<string, ThemedColor | undefined> = {
    '--accent': colors.accent,
    '--paper': colors.background,
    '--surface': colors.background,
    '--ink': colors.text,
    '--muted': colors.muted,
    '--rule': colors.border,
    '--c-new': colors.new,
    '--c-improved': colors.improved,
    '--c-fixed': colors.fixed,
  }
  const decls = Object.entries(vars)
    .filter((e): e is [string, ThemedColor] => e[1] !== undefined)
    .map(([k, v]) => `${k}:${toCss(v)}`)
  const font = resolveFont(cfg)
  if (font) decls.push(`--font:${font.family}`)
  return `:root{${decls.join(';')}}`
}

const SYSTEM_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export function resolveFont (cfg: ResolvedConfig): { family: string; url?: string } | null {
  const { font } = cfg
  if (!font) return null
  if (typeof font === 'string') {
    const family = font.replace(/["';{}<>]/g, '')
    const query = family.trim().replace(/\s+/g, '+')
    return {
      family: `"${family}", ${SYSTEM_STACK}`,
      url: `https://fonts.googleapis.com/css2?family=${query}:wght@300;400;500;600;700&display=swap`,
    }
  }
  return { family: font.family.replace(/[;{}<>]/g, ''), url: font.url }
}

export function resolveLogo (cfg: ResolvedConfig): { light: string; dark: string } | null {
  if (!cfg.logo) return null
  const l = typeof cfg.logo === 'string' ? { light: cfg.logo, dark: cfg.logo } : cfg.logo
  return { light: assetUrl(l.light), dark: assetUrl(l.dark) }
}

export function heading (cfg: ResolvedConfig): string {
  if (cfg.title) return cfg.title
  return cfg.name === 'Changelog' ? 'Changelog' : `${cfg.name} changelog`
}
