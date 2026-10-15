import type { Child, FC } from 'hono/jsx'
import type { ResolvedConfig } from '../config/schema.js'
import type { Release, ReleaseType } from '../content/parse.js'
import { assetUrl } from '../content/parse.js'
import { heading, resolveFont, resolveLogo, themeCss } from '../theme.js'
import { STYLES_URL } from '../assets.js'

export interface PageContext {
  cfg: ResolvedConfig
  /** Absolute base URL, from config or the request. */
  baseUrl: string
  /** Inject the live-reload client (releases dev). */
  live: boolean
}

interface LayoutProps {
  ctx: PageContext
  title: string
  description: string
  /** Path for canonical and og:url, e.g. "/profit-per-visitor". */
  path?: string
  image?: string | null
  theme?: 'light' | 'dark' | 'auto'
  bodyClass: string
  children: Child
}

export const Layout: FC<LayoutProps> = ({ ctx, title, description, path, image, theme = 'auto', bodyClass, children }) => {
  const { cfg, baseUrl } = ctx
  const font = resolveFont(cfg)
  const ogImage = image ?? (cfg.ogImage ? assetUrl(cfg.ogImage) : null)
  const abs = (u: string) => (/^https?:\/\//.test(u) ? u : baseUrl + u)
  return (
    <html lang='en' data-theme={theme === 'auto' ? undefined : theme}>
      <head>
        <meta charset='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <title>{title}</title>
        <meta name='description' content={description} />
        {path !== undefined && <link rel='canonical' href={baseUrl + path} />}
        {path !== undefined && <link rel='alternate' type='application/rss+xml' title={heading(cfg)} href='/feed.xml' />}
        {path !== undefined && <meta property='og:title' content={title} />}
        {path !== undefined && <meta property='og:description' content={description} />}
        {path !== undefined && <meta property='og:url' content={baseUrl + path} />}
        {path !== undefined && ogImage && <meta property='og:image' content={abs(ogImage)} />}
        {path !== undefined && <meta name='twitter:card' content={ogImage ? 'summary_large_image' : 'summary'} />}
        {cfg.favicon && <link rel='icon' href={assetUrl(cfg.favicon)} />}
        {font?.url && <link rel='preconnect' href='https://fonts.gstatic.com' crossorigin='' />}
        {font?.url && <link rel='stylesheet' href={font.url} />}
        <link rel='stylesheet' href={STYLES_URL} />
        <style dangerouslySetInnerHTML={{ __html: themeCss(cfg) + `:root{--logo-h:${cfg.logoHeight}px}` }} />
      </head>
      <body class={bodyClass}>
        {children}
        {ctx.live && <script dangerouslySetInnerHTML={{ __html: "new EventSource('/_releases/live').onmessage=()=>location.reload()" }} />}
      </body>
    </html>
  )
}

export const SiteHeader: FC<{ cfg: ResolvedConfig }> = ({ cfg }) => {
  const logo = resolveLogo(cfg)
  return (
    <header class='site-head'>
      <a class='brand' href='/'>
        {logo
          ? (
            <>
              <img class='logo-light' src={logo.light} alt={cfg.name} />
              {logo.dark !== logo.light && <img class='logo-dark' src={logo.dark} alt={cfg.name} />}
            </>
            )
          : <span>{cfg.name}</span>}
      </a>
      {cfg.website && <a class='home-link' href={cfg.website.href}>{cfg.website.label}</a>}
    </header>
  )
}

export const TypeLabel: FC<{ type: ReleaseType; cfg: ResolvedConfig }> = ({ type, cfg }) => (
  <span class={`type type-${type}`}>{cfg.labels[type]}</span>
)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const fmt = {
  day: (d: string) => String(Number(d.slice(8, 10))),
  monShort: (d: string) => MONTHS[Number(d.slice(5, 7)) - 1]!.slice(0, 3),
  month: (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`,
  long: (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`,
}

export function groupByMonth (entries: Release[]): { key: string; label: string; entries: Release[] }[] {
  const groups: { key: string; label: string; entries: Release[] }[] = []
  for (const e of entries) {
    const key = e.date.slice(0, 7)
    const last = groups.at(-1)
    if (last?.key === key) last.entries.push(e)
    else groups.push({ key, label: fmt.month(e.date), entries: [e] })
  }
  return groups
}
