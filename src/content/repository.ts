import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { imageSizeFromFile } from 'image-size/fromFile'
import { compareReleases, parseRelease, type Release } from './parse.js'

export class ReleaseLoadError extends AggregateError {}

/** Read and validate every release file. Every bad file is reported, not just the first. */
export async function loadReleases (dir: string): Promise<Release[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const errors: Error[] = []
  const entries: Release[] = []
  const slugs = new Set<string>()

  for (const name of names.filter(n => extname(n) === '.md').sort()) {
    try {
      const entry = parseRelease(name, await readFile(join(dir, name), 'utf8'))
      if (slugs.has(entry.slug)) throw new Error(`duplicate slug "${entry.slug}"`)
      slugs.add(entry.slug)
      entries.push(entry)
    } catch (err) {
      errors.push(new Error(`${name}: ${(err as Error).message}`))
    }
  }

  if (errors.length) {
    throw new ReleaseLoadError(errors, `Invalid release files:\n  ${errors.map(e => e.message).join('\n  ')}`)
  }
  await addImageSizes(dir, entries)
  return entries.sort(compareReleases)
}

type Size = { width: number; height: number }
const sizeCache = new Map<string, { mtime: number; size: Size | null }>()

/** Intrinsic size of a file in releases/assets/, cached by mtime. Null for remote or unreadable images. */
async function localImageSize (dir: string, src: string): Promise<Size | null> {
  if (!src.startsWith('/assets/')) return null
  const root = normalize(join(dir, 'assets') + sep)
  const file = normalize(join(dir, 'assets', decodeURIComponent(src.slice('/assets/'.length))))
  if (!file.startsWith(root)) return null
  try {
    const { mtimeMs } = await stat(file)
    const hit = sizeCache.get(file)
    if (hit?.mtime === mtimeMs) return hit.size
    const r = await imageSizeFromFile(file)
    const size = r.width && r.height ? { width: r.width, height: r.height } : null
    sizeCache.set(file, { mtime: mtimeMs, size })
    return size
  } catch {
    return null
  }
}

/** Width/height on local images prevent layout shift while they load (Core Web Vitals). */
async function addImageSizes (dir: string, entries: Release[]): Promise<void> {
  for (const e of entries) {
    if (e.image) e.imageSize = await localImageSize(dir, e.image)
    const tags = [...e.html.matchAll(/<img src="(\/assets\/[^"]+)"(?![^>]*\swidth=)/g)]
    for (const [tag, src] of tags) {
      const size = await localImageSize(dir, src!)
      if (size) e.html = e.html.replace(tag, `${tag} width="${size.width}" height="${size.height}"`)
    }
  }
}

export interface RepositoryOptions {
  /** Show drafts and future-dated entries. */
  preview?: boolean
  now?: () => Date
}

/**
 * Holds the parsed releases in memory. Production loads once at boot;
 * `watch()` reloads on file changes for `releases dev`.
 */
export class Repository {
  private entries: Release[] = []
  private watcher: FSWatcher | null = null
  private listeners = new Set<() => void>()
  readonly preview: boolean
  private readonly now: () => Date

  constructor (readonly dir: string, opts: RepositoryOptions = {}) {
    this.preview = opts.preview ?? false
    this.now = opts.now ?? (() => new Date())
  }

  async load (): Promise<number> {
    this.entries = await loadReleases(this.dir)
    this.listeners.forEach(fn => fn())
    return this.entries.length
  }

  /**
   * Public entries: not drafts, not internal, not scheduled for a later day.
   * With `preview` (dev, or a team member in preview mode) everything is returned.
   */
  visible (preview = this.preview): Release[] {
    if (preview) return this.entries
    const today = this.now().toISOString().slice(0, 10)
    return this.entries.filter(e => !e.draft && !e.internal && e.date <= today)
  }

  find (slug: string, preview = this.preview): { entry: Release; newer?: Release; older?: Release } | null {
    const list = this.visible(preview)
    const i = list.findIndex(e => e.slug === slug)
    if (i === -1) return null
    return { entry: list[i]!, newer: list[i - 1], older: list[i + 1] }
  }

  onChange (fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  watch (onError: (err: Error) => void = () => {}): void {
    if (this.watcher) return
    let timer: NodeJS.Timeout | undefined
    try {
      this.watcher = watch(this.dir, { recursive: true }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => { this.load().catch(onError) }, 80)
      })
    } catch (err) {
      onError(err as Error)
    }
  }

  close (): void {
    this.watcher?.close()
    this.watcher = null
  }
}
