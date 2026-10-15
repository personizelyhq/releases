import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Release } from './content/parse.js'

/**
 * Two tables:
 *  - published: when each entry first became visible, so an entry added late
 *    in the day still counts as unread for someone who looked that morning.
 *  - seen: one watermark per user. Unread = announced entries published after it.
 */
export class Store {
  private readonly db: DatabaseSync
  private readonly known: Map<string, string>
  private readonly stmt: Record<'publish' | 'getSeen' | 'initSeen' | 'setSeen', StatementSync>

  constructor (dataDir: string) {
    if (dataDir === ':memory:') {
      this.db = new DatabaseSync(':memory:')
    } else {
      mkdirSync(dataDir, { recursive: true })
      this.db = new DatabaseSync(join(dataDir, 'releases.sqlite'))
      this.db.exec('PRAGMA journal_mode = WAL')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS published (
        slug TEXT PRIMARY KEY,
        published_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seen (
        user_key TEXT PRIMARY KEY,
        last_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    const rows = this.db.prepare('SELECT slug, published_at FROM published').all() as { slug: string; published_at: string }[]
    this.known = new Map(rows.map(r => [r.slug, r.published_at]))
    this.stmt = {
      publish: this.db.prepare('INSERT OR IGNORE INTO published (slug, published_at) VALUES (?, ?)'),
      getSeen: this.db.prepare('SELECT last_seen_at FROM seen WHERE user_key = ?'),
      initSeen: this.db.prepare('INSERT OR IGNORE INTO seen (user_key, last_seen_at, updated_at) VALUES (?, ?, ?)'),
      setSeen: this.db.prepare(`
        INSERT INTO seen (user_key, last_seen_at, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_key) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
      `),
    }
  }

  /**
   * Record a publish time for entries not seen before. On the very first
   * import (empty table) entries are back-dated to their own date so a
   * backfill does not light up everyone's badge. After that an entry counts
   * from the later of its date and now.
   */
  syncPublished (entries: Release[], now = new Date()): void {
    const firstImport = this.known.size === 0
    const nowIso = now.toISOString()
    for (const e of entries) {
      if (e.draft || this.known.has(e.slug)) continue
      const dayStart = `${e.date}T00:00:00.000Z`
      const at = firstImport || dayStart > nowIso ? dayStart : nowIso
      this.stmt.publish.run(e.slug, at)
      this.known.set(e.slug, at)
    }
  }

  publishedAt (slug: string): string | null {
    return this.known.get(slug) ?? null
  }

  /**
   * Watermark for a user. Someone never seen before starts at `since`
   * (their signup date) or now; that baseline is stored so it stays put.
   */
  lastSeen (userKey: string, since?: string | null, now = new Date()): string {
    const row = this.stmt.getSeen.get(userKey) as { last_seen_at: string } | undefined
    if (row) return row.last_seen_at
    const base = since ? new Date(since) : now
    const baseIso = Number.isNaN(base.getTime()) ? now.toISOString() : base.toISOString()
    this.stmt.initSeen.run(userKey, baseIso, now.toISOString())
    return (this.stmt.getSeen.get(userKey) as { last_seen_at: string }).last_seen_at
  }

  markSeen (userKey: string, now = new Date()): string {
    const iso = now.toISOString()
    this.stmt.setSeen.run(userKey, iso, iso)
    return iso
  }

  close (): void {
    this.db.close()
  }
}
