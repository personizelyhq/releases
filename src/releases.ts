import type { Release } from './content/parse.js'
import type { Repository } from './content/repository.js'
import type { Store } from './store.js'

export interface ReleaseSummary {
  slug: string
  title: string
  date: string
  type: Release['type']
  summary: string
  url: string
}

export interface UnreadResult {
  count: number
  /** Slugs of every unread entry, newest first. */
  unread: string[]
  /** Up to five unread entries for a dropdown or toast. */
  latest: ReleaseSummary[]
  lastSeenAt: string
}

const LATEST_LIMIT = 5

/** Business logic shared by routes and tests: what is published, and what a user has not seen. */
export class Releases {
  constructor (
    readonly repo: Repository,
    readonly store: Store,
    private readonly now: () => Date,
  ) {
    this.sync()
    repo.onChange(() => this.sync())
  }

  /** Record publish times; cheap, and catches scheduled entries as their day arrives. */
  sync (): void {
    this.store.syncPublished(this.repo.visible(), this.now())
  }

  list (preview?: boolean): Release[] {
    return this.repo.visible(preview)
  }

  async reload (): Promise<number> {
    return this.repo.load()
  }

  /** `baseUrl` makes the returned `url`s absolute. */
  unreadFor (userKey: string, since?: string | null, baseUrl = ''): UnreadResult {
    const lastSeenAt = this.store.lastSeen(userKey, since, this.now())
    const unread = this.list().filter(e => e.announce && !e.draft && !e.internal && (this.store.publishedAt(e.slug) ?? '') > lastSeenAt)
    return {
      count: unread.length,
      unread: unread.map(e => e.slug),
      latest: unread.slice(0, LATEST_LIMIT).map(e => this.summary(e, baseUrl)),
      lastSeenAt,
    }
  }

  markSeen (userKey: string): string {
    return this.store.markSeen(userKey, this.now())
  }

  summary (e: Release, baseUrl = ''): ReleaseSummary {
    return { slug: e.slug, title: e.title, date: e.date, type: e.type, summary: e.summary, url: `${baseUrl}/${e.slug}` }
  }
}
