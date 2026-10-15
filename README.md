# @personizely/releases

Release notes from a folder of Markdown files. One small Node server gives you:

- a public changelog page with RSS (`releases.personizely.net`)
- an in-app "What's new" view for an iframe, with unread markers
- an API that tells you how many releases a user has not seen yet

Zero config: point it at a `releases/` folder and run it. Content stays in your app's repo, next to the code that ships it. The server is a dependency you install, so it can be reused anywhere.

Requires Node 22.13 or newer (it uses the built-in `node:sqlite`). Two runtime dependencies: `marked` and `yaml`.

## Quick start

```bash
npm install --save-dev @personizely/releases
npx releases new "Profit per visitor in experiment reports"
npx releases dev          # http://localhost:3000, shows drafts, reloads on save
```

## Writing an entry

One file per change, named `YYYY-MM-DD-short-slug.md`. The slug in the file name is the permanent URL, so you can edit the title freely.

```markdown
---
title: Profit per visitor in experiment reports
type: new                 # new | improved | fixed
tags: [Experiments, Reports]
image: assets/profit.png  # optional, files in releases/assets/
summary: Optional. Shown in the in-app panel. Defaults to the first paragraph.
announce: true            # false keeps it off the unread badge
draft: false              # drafts only show in `releases dev`
---

Revenue per visitor can crown a variant that wins on sales but loses on margin...
```

| Field | Default | Notes |
|---|---|---|
| `title` | required | |
| `date` | from file name | `YYYY-MM-DD`. Future dates are hidden until that day, which gives you scheduling for free. |
| `type` | `new` | `new`, `improved` or `fixed`. Drives the label and the filter. |
| `tags` | `[]` | |
| `image` | none | Shown above the body. |
| `summary` | first paragraph | |
| `announce` | `true` | Only announced entries count as unread. Use `false` for minor fixes and backfills. |
| `draft` | `false` | |
| `order` | `0` | Higher shows first among entries on the same day. |

`releases check` validates every file and exits with code 1 on errors. Run it in CI so a broken entry fails the build instead of the deploy.

## Commands

```
releases dev                 Local preview with drafts and live reload
releases serve               Production server
releases new "Title"         Scaffold an entry  [--type improved] [--date 2026-10-15]
releases check               Validate all files
releases token <userId>      Print a test user token (needs RELEASES_SECRET)
releases secret              Generate a value for RELEASES_SECRET
```

## Configuration

Everything is optional. Put `releases.config.json` (or `.js`) inside the releases folder or in the working directory:

```json
{
  "title": "Personizely changelog",
  "description": "New features, improvements and fixes in Personizely.",
  "homepage": { "label": "personizely.net", "href": "https://www.personizely.net" },
  "logo": "/assets/logo.svg",
  "accent": "#2f54eb",
  "font": { "family": "\"Inter\", sans-serif", "href": "https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap" }
}
```

Environment variables override the file:

| Variable | Default | |
|---|---|---|
| `RELEASES_DIR` | `./releases` | |
| `DATA_DIR` | `./.data` | SQLite file location. **Mount a persistent volume here** or seen state resets on deploy. |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | |
| `PUBLIC_URL` | none | Used for RSS links, canonical URLs and links out of the embed. |
| `RELEASES_SECRET` | none | Enables `/api/*`. At least 32 characters. Without it the public page and embed still work. |
| `ALLOWED_ORIGINS` | `*` | CORS for `/api/me/*`. Safe as `*` because user tokens are sent as a header, not a cookie; narrow it if you prefer. |
| `FRAME_ANCESTORS` | `*` | Who may iframe `/embed`, e.g. `https://app.personizely.net`. Set this in production. |

## Routes

| Route | |
|---|---|
| `GET /` | Changelog, grouped by month. `?type=new\|improved\|fixed` filters. |
| `GET /:slug` | One entry. |
| `GET /embed` | Compact list for an iframe. `?theme=light\|dark\|auto`. Pass the user token as `#token=...` in the hash. |
| `GET /feed.xml` | RSS. |
| `GET /releases.json` | Every visible entry, including rendered HTML. |
| `GET /health` | |

### Unread API

Unread means: announced entries published after the user's last-seen time. One row per user, nothing per entry.

Each entry's publish time is the moment the server first saw it, so an entry added late in the day still counts for someone who looked that morning. On the very first boot, entries are back-dated to their own dates so importing old releases does not light up every badge.

A user the server has never seen starts at `since` (pass their signup date) or at "now". That baseline is stored, so it does not move.

**From the browser, with a user token**

```
GET  /api/me/unread     Authorization: Bearer <user token>
POST /api/me/seen       Authorization: Bearer <user token>
```

**Server to server, with the secret**

```
GET  /api/users/:id/unread?since=2026-03-01   Authorization: Bearer <RELEASES_SECRET>
POST /api/users/:id/seen                       Authorization: Bearer <RELEASES_SECRET>
POST /api/reload                               reload files without restarting
```

Both return:

```json
{ "count": 2, "unread": ["profit-per-visitor", "mcp-server"], "lastSeenAt": "2026-09-15T00:00:00.000Z",
  "latest": [{ "slug": "...", "title": "...", "date": "2026-10-14", "type": "new", "summary": "...", "url": "..." }] }
```

### User tokens

The browser never sees the secret. Your backend mints a short-lived token per user:

```
v1.<base64url(JSON {sub, exp, since?})>.<base64url(HMAC-SHA256(secret, "v1." + payload))>
```

`exp` is required. Tokens expiring more than 30 days out are rejected. A PHP minter is in [`examples/host/ReleasesToken.php`](examples/host/ReleasesToken.php), and Node users can call `signUserToken` from this package.

## In-app panel

```js
import { createReleases } from '@personizely/releases/client'

const releases = createReleases({
  url: 'https://releases.personizely.net',
  getToken: () => api.get('/releases/token').then(r => r.data.token)
})

badge.count = await releases.unreadCount()
releases.on('seen', () => { badge.count = 0 })
button.onclick = () => releases.open()   // slide-in panel with the iframe
```

`open()` renders a minimal panel (backdrop, Escape and close button, focus restored). To use your own drawer component, put an iframe on `await releases.embedUrl()`. The embed marks unread entries, records them as seen, and posts `{ source: 'releases', type: 'seen' }` to the parent window.

[`examples/host/releases.js`](examples/host/releases.js) is a drop-in replacement for the Olvy tool in the Personizely app.

## Deploying

The content lives in your app's repo, so deploy the server from there. [`examples/host/Dockerfile`](examples/host/Dockerfile) installs a pinned version of this package and copies in `releases/`. On Coolify:

1. New resource from the app repo, build pack Dockerfile, pointing at that file.
2. Add a persistent volume at `/data`.
3. Set `RELEASES_SECRET`, `PUBLIC_URL=https://releases.personizely.net` and `FRAME_ANCESTORS=https://app.personizely.net`.
4. Domain `releases.personizely.net`, port 3000. Redeploys on push, so merging a release note publishes it.

## Writing with Claude

[`examples/skill/release-notes/SKILL.md`](examples/skill/release-notes/SKILL.md) is a Claude Code skill that reads the git log since the last entry and drafts customer-facing entries. Copy it into `.claude/skills/` in the app repo.

## Developing this package

```bash
npm install
npm test          # node:test, no extra tooling
npm run dev       # serves examples/releases
```
