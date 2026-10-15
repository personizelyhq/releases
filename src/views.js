// Server-rendered HTML. No framework: tagged templates with escaping by default.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c])

class Raw { constructor (v) { this.v = v } toString () { return this.v } }
export const raw = v => new Raw(v)

export function html (strings, ...values) {
  let out = strings[0]
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]
  })
  return raw(out)
}
function render (v) {
  if (v == null || v === false) return ''
  if (v instanceof Raw) return v.v
  if (Array.isArray(v)) return v.map(render).join('')
  return escape(v)
}

const TYPE_LABEL = { new: 'New feature', improved: 'Improvement', fixed: 'Fix' }
const FILTER_LABEL = { new: 'New features', improved: 'Improvements', fixed: 'Fixes' }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const day = d => String(Number(d.slice(8, 10)))
const monShort = d => MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)
const monthKey = d => d.slice(0, 7)
const monthLabel = d => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
const longDate = d => `${day(d)} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`

function groupByMonth (entries) {
  const groups = []
  for (const e of entries) {
    const key = monthKey(e.date)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) groups.push(g = { key, label: monthLabel(e.date), entries: [] })
    g.entries.push(e)
  }
  return groups
}

function themeVars (cfg) {
  const font = cfg.font?.family ? `--font:${cfg.font.family};` : ''
  return `:root{--accent:${cssValue(cfg.accent)};${font}}`
}
// Config is trusted, but keep a stray quote or brace from breaking the stylesheet.
const cssValue = v => String(v).replace(/[;{}<>]/g, '')

function head (cfg, { title, description, canonical, embed = false }) {
  return html`
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${canonical && cfg.url ? html`<link rel="canonical" href="${cfg.url + canonical}">` : ''}
${!embed ? html`<link rel="alternate" type="application/rss+xml" title="${cfg.title}" href="/feed.xml">` : ''}
${!embed && cfg.url ? html`<meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:type" content="website">` : ''}
${cfg.font?.href ? html`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${cfg.font.href}">` : ''}
<link rel="stylesheet" href="/_releases/styles.css">
<style>${raw(themeVars(cfg))}</style>`
}

function header (cfg) {
  return html`
<header class="site-head">
  <a class="brand" href="/">
    ${cfg.logo ? html`<img src="${cfg.logo}" alt="" height="28">` : ''}
    <span>${cfg.title}</span>
  </a>
  ${cfg.homepage ? html`<a class="home-link" href="${cfg.homepage.href}">${cfg.homepage.label}</a>` : ''}
</header>`
}

function typeTag (type) {
  return html`<span class="type type-${type}">${TYPE_LABEL[type]}</span>`
}

function entryArticle (e, { permalink = true, headingLevel = 'h3', sameDay = false } = {}) {
  const titleInner = permalink ? html`<a href="/${e.slug}">${e.title}</a>` : e.title
  const heading = headingLevel === 'h1' ? html`<h1 class="entry-title">${titleInner}</h1>` : html`<h3 class="entry-title">${titleInner}</h3>`
  return html`
<article class="entry${sameDay ? ' same-day' : ''}" id="${e.slug}" data-type="${e.type}">
  <div class="entry-date"><time datetime="${e.date}"><span class="d">${day(e.date)}</span> ${monShort(e.date)}</time></div>
  <div class="entry-node" aria-hidden="true"></div>
  <div class="entry-body">
    ${typeTag(e.type)}${e.draft ? html`<span class="draft">Draft</span>` : ''}
    ${heading}
    ${e.image ? html`<img class="entry-image" src="${e.image}" alt="" loading="lazy" decoding="async">` : ''}
    <div class="prose">${raw(e.html)}</div>
    ${e.tags.length ? html`<ul class="tags">${e.tags.map(t => html`<li>${t}</li>`)}</ul>` : ''}
  </div>
</article>`
}

export function listPage (cfg, entries, { type = null } = {}) {
  const shown = type ? entries.filter(e => e.type === type) : entries
  const filters = [['', 'Everything'], ...Object.entries(FILTER_LABEL)]
  return page(html`
${head(cfg, { title: cfg.title, description: cfg.description, canonical: '/' })}
<body class="public">
${header(cfg)}
<main class="wrap">
  <section class="intro">
    <h1>${cfg.title}</h1>
    <p>${cfg.description}</p>
    <nav class="filters" aria-label="Filter by type">
      ${filters.map(([value, label]) => html`<a href="${value ? '/?type=' + value : '/'}" ${(type || '') === value ? raw('aria-current="page"') : ''}>${label}</a>`)}
      <a class="rss" href="/feed.xml">RSS feed</a>
    </nav>
  </section>
  ${shown.length
    ? groupByMonth(shown).map(g => html`
  <section class="month" aria-labelledby="m-${g.key}">
    <h2 class="month-label" id="m-${g.key}">${g.label}</h2>
    <div class="timeline">${g.entries.map((e, i) => entryArticle(e, { sameDay: i > 0 && g.entries[i - 1].date === e.date }))}</div>
  </section>`)
    : html`<p class="empty">${type ? 'Nothing of this type yet. ' : 'No releases published yet. '}${type ? html`<a href="/">Show everything</a>` : 'Add a Markdown file to the releases folder to publish the first one.'}</p>`}
</main>
</body>`)
}

export function entryPage (cfg, e, { prev, next } = {}) {
  return page(html`
${head(cfg, { title: `${e.title} | ${cfg.title}`, description: e.summary || cfg.description, canonical: '/' + e.slug })}
<body class="public single">
${header(cfg)}
<main class="wrap">
  <p class="back"><a href="/">All releases</a></p>
  <p class="single-date"><time datetime="${e.date}">${longDate(e.date)}</time></p>
  <div class="timeline">${entryArticle(e, { permalink: false, headingLevel: 'h1' })}</div>
  <nav class="pager" aria-label="More releases">
    ${next ? html`<a class="newer" href="/${next.slug}"><span>Newer</span>${next.title}</a>` : html`<span></span>`}
    ${prev ? html`<a class="older" href="/${prev.slug}"><span>Older</span>${prev.title}</a>` : ''}
  </nav>
</main>
</body>`)
}

export function notFoundPage (cfg) {
  return page(html`
${head(cfg, { title: `Not found | ${cfg.title}`, description: cfg.description })}
<body class="public">
${header(cfg)}
<main class="wrap"><section class="intro"><h1>This release does not exist</h1><p>It may have been renamed. <a href="/">See all releases</a>.</p></section></main>
</body>`)
}

/**
 * The in-app view, loaded in an iframe. Entries render server-side; the
 * script reads the user token from the URL hash (never sent to the server
 * in a request line or Referer), marks unread entries, then records them as seen.
 */
export function embedPage (cfg, entries, { theme = 'auto', limit = 30 } = {}) {
  const shown = entries.slice(0, limit)
  const themeAttr = theme === 'dark' || theme === 'light' ? theme : 'auto'
  return page(html`
${head(cfg, { title: `${cfg.title}`, description: cfg.description, embed: true })}
<body class="embed" data-theme="${themeAttr}">
<header class="embed-head">
  <h1>What's new</h1>
  <a href="${cfg.url || '/'}" target="_blank" rel="noopener">Full changelog</a>
</header>
<main>
  ${shown.length ? html`<ol class="embed-list">
    ${shown.map(e => html`
    <li class="embed-item" data-slug="${e.slug}">
      <details>
        <summary>
          <span class="embed-meta">${typeTag(e.type)}<time datetime="${e.date}">${day(e.date)} ${monShort(e.date)}</time><span class="unread-dot" hidden><span class="sr">Unread</span></span></span>
          <span class="embed-title">${e.title}</span>
          ${e.summary ? html`<span class="embed-summary">${e.summary}</span>` : ''}
        </summary>
        <div class="embed-full">
          ${e.image ? html`<img class="entry-image" src="${e.image}" alt="" loading="lazy" decoding="async">` : ''}
          <div class="prose">${raw(e.html)}</div>
          <a class="permalink" href="${(cfg.url || '') + '/' + e.slug}" target="_blank" rel="noopener">Open in a new tab</a>
        </div>
      </details>
    </li>`)}
  </ol>` : html`<p class="empty">No releases yet. New features and fixes will show up here.</p>`}
</main>
<script src="/_releases/embed.js" defer></script>
</body>`)
}

function page (inner) {
  return `<!doctype html>\n<html lang="en">\n${inner}\n</html>\n`
}

export function rssFeed (cfg, entries) {
  const base = cfg.url || ''
  const items = entries.slice(0, 50).map(e => `
  <item>
    <title>${escape(e.title)}</title>
    <link>${escape(base + '/' + e.slug)}</link>
    <guid isPermaLink="false">${escape(e.slug)}</guid>
    <pubDate>${new Date(e.date + 'T12:00:00Z').toUTCString()}</pubDate>
    <category>${escape(TYPE_LABEL[e.type])}</category>
    <description><![CDATA[${absolutize(e.html, base).replace(/]]>/g, ']]]]><![CDATA[>')}]]></description>
  </item>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escape(cfg.title)}</title>
  <link>${escape(base + '/')}</link>
  <description>${escape(cfg.description)}</description>${items}
</channel>
</rss>
`
}

const absolutize = (h, base) => base ? h.replace(/(src|href)="\/(?!\/)/g, `$1="${base}/`) : h
