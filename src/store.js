import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Two tables:
 *  - published: when each entry first became visible (so an entry added
 *    later in the day still counts as unread for someone who looked earlier).
 *  - seen: one watermark per user. Unread = announced entries published after it.
 */
export class Store {
  constructor (dataDir) {
    if (dataDir === ':memory:') {
      this.db = new DatabaseSync(':memory:')
    } else {
      mkdirSync(dataDir, { recursive: true })
      this.db = new DatabaseSync(join(dataDir, 'releases.sqlite'))
    }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
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
    this.known = new Map(
      this.db.prepare('SELECT slug, published_at FROM published').all().map(r => [r.slug, r.published_at])
    )
    this.stmt = {
      publish: this.db.prepare('INSERT OR IGNORE INTO published (slug, published_at) VALUES (?, ?)'),
      getSeen: this.db.prepare('SELECT last_seen_at FROM seen WHERE user_key = ?'),
      initSeen: this.db.prepare('INSERT OR IGNORE INTO seen (user_key, last_seen_at, updated_at) VALUES (?, ?, ?)'),
      setSeen: this.db.prepare(`
        INSERT INTO seen (user_key, last_seen_at, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_key) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
      `)
    }
  }

  /**
   * Record a publish time for entries we have not seen before.
   * On the very first import (empty table) entries are back-dated to their
   * own date so a backfill does not flood everyone with "new" badges.
   * After that, an entry counts from the later of its date and now.
   */
  syncPublished (entries, now = new Date()) {
    const firstImport = this.known.size === 0
    const nowIso = now.toISOString()
    for (const e of entries) {
      if (this.known.has(e.slug)) continue
      const dayStart = e.date + 'T00:00:00.000Z'
      const at = firstImport || dayStart > nowIso ? dayStart : nowIso
      this.stmt.publish.run(e.slug, at)
      this.known.set(e.slug, at)
    }
  }

  publishedAt (slug) {
    return this.known.get(slug) ?? null
  }

  /**
   * Watermark for a user. A user we have never seen starts at `since`
   * (e.g. their signup date) or now, and that baseline is stored so it stays stable.
   */
  lastSeen (userKey, since, now = new Date()) {
    const row = this.stmt.getSeen.get(userKey)
    if (row) return row.last_seen_at
    const base = since ? new Date(since) : now
    const baseIso = Number.isNaN(base.getTime()) ? now.toISOString() : base.toISOString()
    this.stmt.initSeen.run(userKey, baseIso, now.toISOString())
    return this.stmt.getSeen.get(userKey).last_seen_at
  }

  markSeen (userKey, now = new Date()) {
    const iso = now.toISOString()
    this.stmt.setSeen.run(userKey, iso, iso)
    return iso
  }

  close () {
    this.db.close()
  }
}
