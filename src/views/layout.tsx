import type { Child, FC } from 'hono/jsx'
import type { ResolvedConfig } from '../config/schema.js'
import type { Release, ReleaseType } from '../content/parse.js'
import { assetUrl } from '../content/parse.js'
import { heading, resolveFont, resolveLogo, themeCss } from '../theme.js'
import { STYLES_URL } from '../assets.js'
import { iconLinks, jsonLd } from '../seo.js'

export interface PageContext {
  cfg: ResolvedConfig
  /** Absolute base URL, from config or the request. */
  baseUrl: string
  /** Inject the live-reload client (releases dev). */
  live: boolean
  /** Showing drafts, internal and scheduled entries. */
  preview: boolean
  /** Preview through the team cookie (not dev): show the banner with an exit link. */
  teamPreview: boolean
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
  /** Keep this page out of search results (filters, embed, 404, preview). */
  noindex?: boolean
  /** 'article' for single entries. */
  ogType?: 'website' | 'article'
  publishedTime?: string
  /** schema.org data for this page. */
  structuredData?: unknown
  prev?: string
  next?: string
  children: Child
}

export const Layout: FC<LayoutProps> = (props) => {
  const { ctx, title, description, path, image, theme = 'auto', bodyClass, children } = props
  const { cfg, baseUrl } = ctx
  const font = resolveFont(cfg)
  const ogImage = image ?? (cfg.ogImage ? assetUrl(cfg.ogImage) : null)
  const abs = (u: string) => (/^https?:\/\//.test(u) ? u : baseUrl + u)
  const icons = iconLinks(cfg)
  const noindex = props.noindex || cfg.noindex || ctx.preview
  const social = path !== undefined && !noindex
  const twitter = cfg.twitter ? (cfg.twitter.startsWith('@') ? cfg.twitter : `@${cfg.twitter}`) : null
  return (
    <html lang={cfg.lang} data-theme={theme === 'auto' ? undefined : theme}>
      <head>
        <meta charset='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <title>{title}</title>
        <meta name='description' content={description} />
        {noindex && <meta name='robots' content='noindex, follow' />}
        {path !== undefined && <link rel='canonical' href={baseUrl + path} />}
        {props.prev && <link rel='prev' href={baseUrl + props.prev} />}
        {props.next && <link rel='next' href={baseUrl + props.next} />}
        {path !== undefined && <link rel='alternate' type='application/rss+xml' title={heading(cfg)} href='/feed.xml' />}
        {social && <meta property='og:site_name' content={heading(cfg)} />}
        {social && <meta property='og:type' content={props.ogType ?? 'website'} />}
        {social && <meta property='og:locale' content={cfg.lang.replace('-', '_')} />}
        {social && <meta property='og:title' content={title} />}
        {social && <meta property='og:description' content={description} />}
        {social && <meta property='og:url' content={baseUrl + path} />}
        {social && ogImage && <meta property='og:image' content={abs(ogImage)} />}
        {social && props.publishedTime && <meta property='article:published_time' content={props.publishedTime} />}
        {social && <meta name='twitter:card' content={ogImage ? 'summary_large_image' : 'summary'} />}
        {social && twitter && <meta name='twitter:site' content={twitter} />}
        <link rel='icon' href={icons.favicon} type={icons.type} />
        {icons.appleTouchIcon && <link rel='apple-touch-icon' href={icons.appleTouchIcon} />}
        <meta name='theme-color' content={typeof cfg.colors.accent === 'string' ? cfg.colors.accent : cfg.colors.accent.light} />
        {font?.url && <link rel='preconnect' href='https://fonts.gstatic.com' crossorigin='' />}
        {font?.url && <link rel='stylesheet' href={font.url} />}
        <link rel='stylesheet' href={STYLES_URL} />
        <style dangerouslySetInnerHTML={{ __html: themeCss(cfg) + `:root{--logo-h:${cfg.logoHeight}px}` }} />
        {props.structuredData !== undefined && !noindex && <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: jsonLd(props.structuredData) }} />}
      </head>
      <body class={bodyClass}>
        {ctx.teamPreview && (
          <div class='preview-bar' role='status'>
            Preview: drafts and internal entries are visible to you only. <a href='/preview/exit'>Exit preview</a>
          </div>
        )}
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
