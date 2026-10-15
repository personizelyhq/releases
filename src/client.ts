/**
 * Browser client for host apps. No dependencies, safe to bundle.
 *
 *   import { createReleases } from '@personizely/releases/client'
 *
 *   const releases = createReleases({ url: 'https://releases.personizely.net', getToken })
 *   badge.value = await releases.unreadCount()
 *   releases.on('seen', () => { badge.value = 0 })
 *   releases.open()   // slide-in panel with the /embed iframe
 */

export type Theme = 'light' | 'dark' | 'auto'

export interface ReleasesClientOptions {
  /** Where the releases server runs, e.g. https://releases.personizely.net */
  url: string
  /** A user token minted by your backend. */
  token?: string
  /** Or a function returning one, called before each request so it can refresh. */
  getToken?: () => string | Promise<string>
  theme?: Theme
  /** Panel width in px. */
  width?: number
  zIndex?: number
}

export interface ReleaseSummary {
  slug: string
  title: string
  date: string
  type: 'new' | 'improved' | 'fixed'
  summary: string
  url: string
}

export interface UnreadResult {
  count: number
  unread: string[]
  latest: ReleaseSummary[]
  lastSeenAt: string
}

export interface ReleasesEvents {
  /** The user opened the embed and their entries were marked as seen. */
  seen: { count: number }
  open: undefined
  close: undefined
  /** The embed could not load unread state (e.g. an expired token). */
  error: { status: number }
}

type Listener<K extends keyof ReleasesEvents> = (data: ReleasesEvents[K]) => void

export interface ReleasesClient {
  unread: () => Promise<UnreadResult>
  /** Resolves to 0 on any error, so a badge never breaks the page. */
  unreadCount: () => Promise<number>
  markSeen: () => Promise<{ lastSeenAt: string }>
  /** URL for your own iframe if you render the panel yourself. */
  embedUrl: (opts?: { theme?: Theme }) => Promise<string>
  open: (opts?: { theme?: Theme }) => Promise<void>
  close: () => void
  on: <K extends keyof ReleasesEvents>(type: K, fn: Listener<K>) => () => void
  /**
   * Turn any element (your bell icon, a menu item) into a "What's new" trigger with
   * a pulsing unread dot. Clicking it opens the panel. Returns a cleanup function.
   */
  attach: (target: HTMLElement, opts?: BadgeOptions) => () => void
  destroy: () => void
}

export interface BadgeOptions {
  /** Show the count instead of a dot. */
  count?: boolean
  /** Dot color. Defaults to #e5484d. */
  color?: string
  /** Re-check every N ms (0 = only on attach). Default 5 minutes. */
  refresh?: number
  /** Open the panel on click. Default true. */
  openOnClick?: boolean
}

export function createReleases (options: ReleasesClientOptions): ReleasesClient {
  const { url, token, getToken, theme = 'auto', width = 420, zIndex = 2147483000 } = options
  if (!url) throw new Error('createReleases: url is required')
  const base = url.replace(/\/+$/, '')
  const origin = new URL(base).origin
  // Typed at the edges (on/emit); stored loosely.
  const listeners = new Map<keyof ReleasesEvents, Set<(data: unknown) => void>>()
  let panel: HTMLElement | null = null
  let lastFocus: Element | null = null

  const resolveToken = async () => (getToken ? getToken() : token)
  const emit = <K extends keyof ReleasesEvents>(type: K, data: ReleasesEvents[K]) => {
    listeners.get(type)?.forEach(fn => fn(data))
  }

  const onMessage = (e: MessageEvent) => {
    const d = e.data as { source?: string; type?: string; count?: number; status?: number } | null
    if (e.origin !== origin || d?.source !== 'releases') return
    if (d.type === 'close') close()
    else if (d.type === 'seen') emit('seen', { count: d.count ?? 0 })
    else if (d.type === 'error') emit('error', { status: d.status ?? 0 })
  }
  window.addEventListener('message', onMessage)

  async function request<T> (path: string, init: RequestInit = {}): Promise<T> {
    const t = await resolveToken()
    if (!t) throw new Error('releases: no user token')
    const res = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${t}` } })
    if (!res.ok) throw new Error(`releases: HTTP ${res.status}`)
    return res.json() as Promise<T>
  }

  const unread = () => request<UnreadResult>('/api/me/unread')
  const unreadCount = () => unread().then(d => d.count).catch(() => 0)
  const markSeen = async () => {
    const r = await request<{ lastSeenAt: string }>('/api/me/seen', { method: 'POST' })
    emit('seen', { count: 0 })
    return r
  }

  async function embedUrl (opts: { theme?: Theme } = {}) {
    const t = await resolveToken()
    const q = new URLSearchParams({ theme: opts.theme ?? theme })
    // Token in the hash: never sent to the server in a request line or Referer.
    return `${base}/embed?${q}${t ? `#token=${encodeURIComponent(t)}` : ''}`
  }

  async function open (opts: { theme?: Theme } = {}) {
    if (panel) return
    lastFocus = document.activeElement
    const scheme = opts.theme ?? theme
    const dark = scheme === 'dark' || (scheme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)

    const root = document.createElement('div')
    root.setAttribute('data-releases-panel', '')
    root.style.cssText = `position:fixed;inset:0;z-index:${zIndex}`

    const backdrop = el('div', 'position:fixed;inset:0;background:rgba(15,17,21,.32);opacity:0;transition:opacity .2s')
    const aside = el('aside', `position:fixed;top:0;right:0;bottom:0;width:min(${width}px,100vw);display:flex;background:${dark ? '#1a1b20' : '#fff'};box-shadow:-12px 0 40px rgba(15,17,21,.18);transform:translateX(100%);transition:transform .24s cubic-bezier(.2,.8,.2,1)`)
    aside.setAttribute('role', 'dialog')
    aside.setAttribute('aria-modal', 'true')
    aside.setAttribute('aria-label', "What's new")

    const iframe = el('iframe', 'border:0;flex:1;width:100%;height:100%') as HTMLIFrameElement
    iframe.title = "What's new"
    iframe.src = await embedUrl({ theme: scheme })

    aside.append(iframe)
    root.append(backdrop, aside)
    document.body.appendChild(root)
    panel = root

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) aside.style.transition = backdrop.style.transition = 'none'
    requestAnimationFrame(() => {
      aside.style.transform = 'none'
      backdrop.style.opacity = '1'
    })

    // The embed renders its own close button and posts { type: 'close' }.
    backdrop.addEventListener('click', close)
    root.addEventListener('keydown', e => { if (e.key === 'Escape') close() })
    iframe.addEventListener('load', () => iframe.focus(), { once: true })
    emit('open', undefined)
  }

  function close () {
    if (!panel) return
    const p = panel
    panel = null
    const [backdrop, aside] = Array.from(p.children) as HTMLElement[]
    if (aside) aside.style.transform = 'translateX(100%)'
    if (backdrop) backdrop.style.opacity = '0'
    setTimeout(() => p.remove(), 260)
    if (lastFocus instanceof HTMLElement) lastFocus.focus()
    emit('close', undefined)
  }

  function on<K extends keyof ReleasesEvents> (type: K, fn: Listener<K>) {
    let set = listeners.get(type)
    if (!set) listeners.set(type, (set = new Set()))
    const f = fn as (data: unknown) => void
    set.add(f)
    return () => { set.delete(f) }
  }

  const cleanups = new Set<() => void>()

  function attach (target: HTMLElement, opts: BadgeOptions = {}) {
    const { count: showCount = false, color = '#e5484d', refresh = 5 * 60_000, openOnClick = true } = opts
    injectBadgeStyles()
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative'
    const dot = document.createElement('span')
    dot.className = 'releases-badge'
    dot.style.setProperty('--releases-badge', color)
    dot.hidden = true
    target.appendChild(dot)

    const render = (n: number) => {
      dot.hidden = n === 0
      dot.textContent = showCount && n ? String(n > 99 ? '99+' : n) : ''
      dot.classList.toggle('releases-badge--count', showCount)
      target.setAttribute('data-unread', String(n))
    }
    const update = () => { void unreadCount().then(render) }
    update()

    const timer = refresh > 0 ? setInterval(update, refresh) : undefined
    const offSeen = on('seen', () => render(0))
    const onClick = () => { void open() }
    if (openOnClick) target.addEventListener('click', onClick)

    const cleanup = () => {
      clearInterval(timer)
      offSeen()
      target.removeEventListener('click', onClick)
      dot.remove()
      cleanups.delete(cleanup)
    }
    cleanups.add(cleanup)
    return cleanup
  }

  function destroy () {
    close()
    cleanups.forEach(fn => fn())
    window.removeEventListener('message', onMessage)
  }

  return { unread, unreadCount, markSeen, embedUrl, open, close, on, attach, destroy }
}

function injectBadgeStyles () {
  if (document.getElementById('releases-badge-styles')) return
  const style = document.createElement('style')
  style.id = 'releases-badge-styles'
  style.textContent = `
.releases-badge{position:absolute;top:-2px;right:-2px;min-width:9px;height:9px;border-radius:999px;background:var(--releases-badge);box-shadow:0 0 0 2px #fff;pointer-events:none}
.releases-badge--count{top:-6px;right:-8px;height:16px;padding:0 4px;font:600 10px/16px system-ui,sans-serif;color:#fff;text-align:center}
.releases-badge[hidden]{display:none}
@media (prefers-reduced-motion:no-preference){.releases-badge::after{content:"";position:absolute;inset:0;border-radius:inherit;background:inherit;animation:releases-pulse 1.8s ease-out infinite}}
@keyframes releases-pulse{from{transform:scale(1);opacity:.7}to{transform:scale(2.6);opacity:0}}`
  document.head.appendChild(style)
}

function el (tag: string, css: string): HTMLElement {
  const node = document.createElement(tag)
  node.style.cssText = css
  return node
}
