import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { Marked } from 'marked'
import { parse as parseYaml } from 'yaml'

export const TYPES = ['new', 'improved', 'fixed']

const FILE_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.md$/
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/**
 * Read every release file in `dir` and return them newest first.
 * Throws an AggregateError listing every invalid file, so a bad entry
 * fails the deploy instead of silently disappearing.
 */
export async function loadReleases (dir) {
  let names
  try {
    names = await readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }

  const errors = []
  const entries = []
  const slugs = new Set()

  for (const name of names.filter(n => extname(n) === '.md').sort()) {
    try {
      const raw = await readFile(join(dir, name), 'utf8')
      const entry = parseRelease(name, raw)
      if (slugs.has(entry.slug)) throw new Error(`duplicate slug "${entry.slug}"`)
      slugs.add(entry.slug)
      entries.push(entry)
    } catch (err) {
      errors.push(new Error(`${name}: ${err.message}`))
    }
  }

  if (errors.length) {
    throw new AggregateError(errors, `Invalid release files:\n  ${errors.map(e => e.message).join('\n  ')}`)
  }

  return entries.sort(compareEntries)
}

/** Newest first; same-day entries ordered by optional `order`, then slug. */
export function compareEntries (a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  if (a.order !== b.order) return b.order - a.order
  return a.slug < b.slug ? -1 : 1
}

export function parseRelease (filename, raw) {
  const match = FILE_RE.exec(basename(filename))
  if (!match) throw new Error('file name must look like 2026-10-15-short-title.md (lowercase, dashes)')
  const [, fileDate, slug] = match

  const fm = FRONTMATTER_RE.exec(raw)
  if (!fm) throw new Error('missing frontmatter block (--- title: ... ---)')

  let data
  try {
    data = parseYaml(fm[1]) || {}
  } catch (err) {
    throw new Error(`frontmatter is not valid YAML: ${err.message}`)
  }

  const title = typeof data.title === 'string' ? data.title.trim() : ''
  if (!title) throw new Error('"title" is required')

  const date = normalizeDate(data.date ?? fileDate)
  if (!date) throw new Error(`"date" must be YYYY-MM-DD, got "${data.date}"`)

  const type = data.type ?? 'new'
  if (!TYPES.includes(type)) throw new Error(`"type" must be one of ${TYPES.join(', ')}, got "${type}"`)

  const tags = data.tags == null ? [] : [].concat(data.tags).map(String)
  const body = fm[2].trim()
  const html = renderMarkdown(body)

  return {
    slug,
    title,
    date,
    type,
    tags,
    image: data.image ? assetUrl(String(data.image)) : null,
    summary: data.summary ? String(data.summary).trim() : firstParagraph(body),
    announce: data.announce !== false,
    draft: data.draft === true,
    order: Number.isFinite(data.order) ? data.order : 0,
    html
  }
}

function normalizeDate (value) {
  // YAML turns unquoted 2026-10-15 into a Date at UTC midnight.
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(value + 'T00:00:00Z')
    if (!Number.isNaN(d.getTime()) && d.toISOString().startsWith(value)) return value
  }
  return null
}

/** Paths written as `assets/x.png` or `./assets/x.png` are served from /assets/. */
export function assetUrl (href) {
  const m = /^\.?\/?assets\/(.+)$/.exec(href)
  return m ? `/assets/${m[1]}` : href
}

const marked = new Marked({
  gfm: true,
  walkTokens (token) {
    if ((token.type === 'image' || token.type === 'link') && token.href) token.href = assetUrl(token.href)
  },
  renderer: {
    image ({ href, title, text }) {
      const t = title ? ` title="${escapeAttr(title)}"` : ''
      return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}"${t} loading="lazy" decoding="async">`
    }
  }
})

function renderMarkdown (md) {
  return marked.parse(md)
}

function firstParagraph (md) {
  const block = md.split(/\r?\n\s*\r?\n/).find(p => p.trim() && !/^(#|!\[|```|>|\||[-*+] |\d+\. )/.test(p.trim()))
  if (!block) return ''
  const text = block
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 220 ? text.slice(0, 217).replace(/\s+\S*$/, '') + '…' : text
}

function escapeAttr (s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Latest mtime in a directory, used by dev mode to detect changes cheaply. */
export async function dirSignature (dir) {
  try {
    const names = await readdir(dir)
    let sig = names.length
    for (const n of names) sig += (await stat(join(dir, n))).mtimeMs
    return sig
  } catch {
    return 0
  }
}
