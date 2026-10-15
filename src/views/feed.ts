import type { ResolvedConfig } from '../config/schema.js'
import type { Release } from '../content/parse.js'
import { heading } from '../theme.js'

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const absolutize = (html: string, base: string) => html.replace(/(src|href)="\/(?!\/)/g, `$1="${base}/`)

export function rssFeed (cfg: ResolvedConfig, baseUrl: string, entries: Release[]): string {
  const items = entries.slice(0, 50).map(e => `
  <item>
    <title>${esc(e.title)}</title>
    <link>${esc(`${baseUrl}/${e.slug}`)}</link>
    <guid isPermaLink="false">${esc(e.slug)}</guid>
    <pubDate>${new Date(`${e.date}T12:00:00Z`).toUTCString()}</pubDate>
    <category>${esc(cfg.labels[e.type])}</category>
    <description><![CDATA[${absolutize(e.html, baseUrl).replaceAll(']]>', ']]]]><![CDATA[>')}]]></description>
  </item>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(heading(cfg))}</title>
  <link>${esc(baseUrl + '/')}</link>
  <atom:link href="${esc(baseUrl + '/feed.xml')}" rel="self" type="application/rss+xml"/>
  <description>${esc(cfg.description)}</description>${items}
</channel>
</rss>
`
}
