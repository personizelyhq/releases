import { basename } from 'node:path'
import { Marked } from 'marked'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

export const TYPES = ['new', 'improved', 'fixed'] as const
export type ReleaseType = (typeof TYPES)[number]

export interface Release {
  /** From the file name; the permanent URL. */
  slug: string
  title: string
  /** YYYY-MM-DD */
  date: string
  type: ReleaseType
  tags: string[]
  /** Public URL path or absolute URL. */
  image: string | null
  summary: string
  /** Counts toward the unread badge. */
  announce: boolean
  draft: boolean
  /** Only visible to your team (in `releases dev` and preview mode). Never counts as unread. */
  internal: boolean
  order: number
  html: string
}

const FILE_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.md$/
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

const isoDay = z.union([
  z.iso.date(),
  // YAML parses an unquoted 2026-10-15 into a Date.
  z.date().transform(d => d.toISOString().slice(0, 10)),
])

const frontmatterSchema = z.object({
  title: z.string().trim().min(1),
  date: isoDay.optional(),
  type: z.enum(TYPES).default('new'),
  tags: z.union([z.string(), z.array(z.coerce.string())]).default([]).transform(t => [t].flat()),
  image: z.string().optional(),
  summary: z.string().trim().optional(),
  announce: z.boolean().default(true),
  draft: z.boolean().default(false),
  internal: z.boolean().default(false),
  order: z.number().default(0),
})

export class ReleaseFileError extends Error {}

export function parseRelease (filename: string, raw: string): Release {
  const match = FILE_RE.exec(basename(filename))
  if (!match) throw new ReleaseFileError('file name must look like 2026-10-15-short-title.md (lowercase letters, digits and dashes)')
  const [, fileDate, slug] = match as unknown as [string, string, string]

  const fm = FRONTMATTER_RE.exec(raw)
  if (!fm) throw new ReleaseFileError('missing frontmatter block at the top (--- title: ... ---)')

  let data: unknown
  try {
    data = parseYaml(fm[1] ?? '') ?? {}
  } catch (err) {
    throw new ReleaseFileError(`frontmatter is not valid YAML: ${(err as Error).message}`)
  }

  const parsed = frontmatterSchema.safeParse(data)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.') || 'frontmatter'}: ${i.message}`).join('; ')
    throw new ReleaseFileError(issues)
  }
  const f = parsed.data
  const body = (fm[2] ?? '').trim()

  return {
    slug,
    title: f.title,
    date: f.date ?? fileDate,
    type: f.type,
    tags: f.tags,
    image: f.image ? assetUrl(f.image) : null,
    summary: f.summary ?? firstParagraph(body),
    announce: f.announce,
    draft: f.draft,
    internal: f.internal,
    order: f.order,
    html: marked.parse(body, { async: false }),
  }
}

/** Newest first; same-day entries by `order` (higher first), then slug. */
export function compareReleases (a: Release, b: Release): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  if (a.order !== b.order) return b.order - a.order
  return a.slug < b.slug ? -1 : 1
}

/** `assets/x.png` and `./assets/x.png` resolve to the served /assets/ path. */
export function assetUrl (href: string): string {
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
    },
  },
})

function firstParagraph (md: string): string {
  const block = md
    .split(/\r?\n\s*\r?\n/)
    .find(p => p.trim() && !/^(#|!\[|```|>|\||[-*+] |\d+\. |<)/.test(p.trim()))
  if (!block) return ''
  const text = block
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 220 ? text.slice(0, 217).replace(/\s+\S*$/, '') + '…' : text
}

function escapeAttr (s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
