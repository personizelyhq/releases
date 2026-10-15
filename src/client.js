/**
 * Browser client for the host app (replaces the Olvy script).
 *
 *   import { createReleases } from '@personizely/releases/client'
 *   const releases = createReleases({ url: 'https://releases.personizely.net', token })
 *   releases.unreadCount().then(n => badge = n)
 *   releases.open()                      // slide-in panel with the /embed iframe
 *   releases.on('seen', () => badge = 0)
 *
 * `token` is a short-lived user token minted by your backend (see README).
 * Pass `getToken: () => Promise<string>` instead to refresh it on demand.
 */
export function createReleases ({ url, token, getToken, theme = 'auto', width = 420, zIndex = 2147483000 } = {}) {
  if (!url) throw new Error('createReleases: url is required')
  const base = url.replace(/\/+$/, '')
  const origin = new URL(base).origin
  const listeners = {}
  let panel = null
  let lastFocus = null

  const resolveToken = () => getToken ? Promise.resolve(getToken()) : Promise.resolve(token)
  const emit = (type, data) => (listeners[type] || []).forEach(fn => fn(data))

  function onMessage (e) {
    if (e.origin !== origin || !e.data || e.data.source !== 'releases') return
    if (e.data.type === 'close') close()
    else emit(e.data.type, e.data)
  }
  window.addEventListener('message', onMessage)

  async function request (path, init = {}) {
    const t = await resolveToken()
    if (!t) throw new Error('releases: no user token')
    const res = await fetch(base + path, { ...init, headers: { Authorization: 'Bearer ' + t } })
    if (!res.ok) throw new Error('releases: ' + res.status)
    return res.json()
  }

  /** { count, unread: [slug], latest: [{slug,title,date,type,summary,url}], lastSeenAt } */
  const unread = () => request('/api/me/unread')
  const unreadCount = () => unread().then(d => d.count).catch(() => 0)
  const markSeen = () => request('/api/me/seen', { method: 'POST' }).then(d => { emit('seen', { count: 0 }); return d })

  /** URL for your own iframe if you render the panel yourself. */
  async function embedUrl (opts = {}) {
    const t = await resolveToken()
    const q = new URLSearchParams({ theme: opts.theme || theme })
    return `${base}/embed?${q}${t ? '#token=' + encodeURIComponent(t) : ''}`
  }

  async function open (opts = {}) {
    if (panel) return
    lastFocus = document.activeElement
    const src = await embedUrl(opts)

    const root = document.createElement('div')
    root.setAttribute('data-releases-panel', '')
    root.innerHTML = `
      <div data-backdrop style="position:fixed;inset:0;background:rgba(15,17,21,.32);opacity:0;transition:opacity .2s"></div>
      <aside role="dialog" aria-modal="true" aria-label="What's new" style="position:fixed;top:0;right:0;bottom:0;width:min(${Number(width)}px,100vw);background:${(opts.theme || theme) === 'dark' ? '#171a20' : '#fff'};box-shadow:-12px 0 40px rgba(15,17,21,.18);transform:translateX(100%);transition:transform .24s cubic-bezier(.2,.8,.2,1);display:flex">
        <button type="button" aria-label="Close" data-close style="position:absolute;top:10px;right:10px;z-index:1;width:32px;height:32px;border:0;border-radius:8px;background:transparent;cursor:pointer;font-size:20px;line-height:1;color:#6b6e78">×</button>
        <iframe title="What's new" src="${src.replace(/"/g, '&quot;')}" style="border:0;flex:1;width:100%;height:100%"></iframe>
      </aside>`
    root.style.cssText = `position:fixed;inset:0;z-index:${zIndex}`
    document.body.appendChild(root)
    panel = root

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const aside = root.querySelector('aside')
    const backdrop = root.querySelector('[data-backdrop]')
    if (reduce) aside.style.transition = backdrop.style.transition = 'none'
    requestAnimationFrame(() => { aside.style.transform = 'none'; backdrop.style.opacity = '1' })

    backdrop.addEventListener('click', close)
    root.querySelector('[data-close]').addEventListener('click', close)
    root.addEventListener('keydown', e => { if (e.key === 'Escape') close() })
    root.querySelector('[data-close]').focus()
    emit('open')
  }

  function close () {
    if (!panel) return
    const p = panel
    panel = null
    const aside = p.querySelector('aside')
    aside.style.transform = 'translateX(100%)'
    p.querySelector('[data-backdrop]').style.opacity = '0'
    setTimeout(() => p.remove(), 260)
    if (lastFocus && lastFocus.focus) lastFocus.focus()
    emit('close')
  }

  function on (type, fn) {
    (listeners[type] = listeners[type] || []).push(fn)
    return () => { listeners[type] = listeners[type].filter(f => f !== fn) }
  }

  function destroy () {
    close()
    window.removeEventListener('message', onMessage)
  }

  return { unread, unreadCount, markSeen, embedUrl, open, close, on, destroy }
}
