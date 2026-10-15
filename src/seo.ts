import type { ResolvedConfig } from './config/schema.js'
import type { Release } from './content/parse.js'
import { assetUrl } from './content/parse.js'
import { heading, resolveLogo } from './theme.js'

const abs = (base: string, u: string) => (/^https?:\/\//.test(u) ? u : base + (u.startsWith('/') ? u : `/${u}`))

/** Safe to inline in <script type="application/ld+json">. */
export function jsonLd (data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

function publisher (cfg: ResolvedConfig, base: string) {
  const logo = resolveLogo(cfg)
  return {
    '@type': 'Organization',
    name: cfg.name,
    ...(cfg.website ? { url: cfg.website.href } : {}),
    ...(logo ? { logo: abs(base, logo.light) } : {}),
  }
}

function post (cfg: ResolvedConfig, base: string, e: Release) {
  const url = `${base}/${e.slug}`
  return {
    '@type': 'BlogPosting',
    headline: e.title.slice(0, 110),
    description: e.summary || undefined,
    url,
    mainEntityOfPage: url,
    datePublished: e.date,
    dateModified: e.date,
    ...(e.image ? { image: abs(base, e.image) } : {}),
    ...(e.tags.length ? { keywords: e.tags.join(', ') } : {}),
    articleSection: cfg.labels[e.type],
    inLanguage: cfg.lang,
    author: publisher(cfg, base),
    publisher: publisher(cfg, base),
  }
}

export function listJsonLd (cfg: ResolvedConfig, base: string, entries: Release[], path: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: heading(cfg),
    description: cfg.description,
    url: base + path,
    inLanguage: cfg.lang,
    publisher: publisher(cfg, base),
    blogPost: entries.map(e => ({ '@type': 'BlogPosting', headline: e.title.slice(0, 110), url: `${base}/${e.slug}`, datePublished: e.date })),
  }
}

export function entryJsonLd (cfg: ResolvedConfig, base: string, e: Release) {
  return [
    { '@context': 'https://schema.org', ...post(cfg, base, e) },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: heading(cfg), item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: e.title, item: `${base}/${e.slug}` },
      ],
    },
  ]
}

const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

export function sitemap (cfg: ResolvedConfig, base: string, entries: Release[]): string {
  const pages = Math.max(1, Math.ceil(entries.length / cfg.perPage))
  const latest = entries[0]?.date
  const urls = [
    { loc: `${base}/`, lastmod: latest },
    ...Array.from({ length: pages - 1 }, (_, i) => ({ loc: `${base}/page/${i + 2}`, lastmod: undefined })),
    ...entries.map(e => ({ loc: `${base}/${e.slug}`, lastmod: e.date })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`
}

export function robots (cfg: ResolvedConfig, base: string): string {
  if (cfg.noindex) return 'User-agent: *\nDisallow: /\n'
  return `User-agent: *
Allow: /
Disallow: /embed
Disallow: /api/
Disallow: /preview

Sitemap: ${base}/sitemap.xml
`
}

/** Default favicon: a rounded square in the accent color with a spark. */
export function faviconSvg (cfg: ResolvedConfig): string {
  const accent = typeof cfg.colors.accent === 'string' ? cfg.colors.accent : cfg.colors.accent.light
  const fill = /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : '#2f54eb'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${fill}"/><path d="M32 13l4.9 14.1L51 32l-14.1 4.9L32 51l-4.9-14.1L13 32l14.1-4.9z" fill="#fff"/></svg>`
}

export function iconLinks (cfg: ResolvedConfig): { favicon: string; type?: string; appleTouchIcon?: string } {
  const favicon = cfg.favicon ? assetUrl(cfg.favicon) : '/_releases/favicon.svg'
  const ext = favicon.split('?')[0]!.split('.').pop()?.toLowerCase()
  const type = { svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', webp: 'image/webp' }[ext ?? '']
  return { favicon, type, appleTouchIcon: cfg.appleTouchIcon ? assetUrl(cfg.appleTouchIcon) : undefined }
}
