// backend/assets/app/src/tools/releases.js
// Drop-in replacement for tools/olvy.js. Keeps the same method names so
// Default.vue only needs its import changed.
import { createReleases } from '@personizely/releases/client'

export default {
  client: null,
  url: import.meta.env.VITE_APP_RELEASES_URL, // https://releases.personizely.net

  /** getToken: () => Promise<string>, e.g. () => api.get('/releases/token').then(r => r.data.token) */
  init ({ getToken, theme = 'auto' } = {}) {
    if (this.client || !this.url) return
    this.client = createReleases({ url: this.url, getToken, theme })
  },

  show () {
    this.client?.open()
  },

  onSeen (fn) {
    return this.client?.on('seen', fn)
  },

  getUnreadReleasesCount () {
    return this.client ? this.client.unreadCount() : Promise.resolve(0)
  },

  teardown () {
    this.client?.destroy()
    this.client = null
  }
}
