# @personizely/releases

**A changelog you keep in Git, with a "What's new" panel and unread badge for your app.**

Write release notes as Markdown files next to your code. One small Node server turns them into:

- **A public changelog page** with RSS, grouped by month, filterable by type.
- **An in-app "What's new" panel** you can open from any button, with unread entries highlighted.
- **An unread badge** that pulses until the user opens the panel.
- **An API** that tells your backend how many releases a user has not seen.

No dashboard, no editor, no SaaS seat. A release note is a pull request.

![Changelog page and in-app panel](https://raw.githubusercontent.com/personizelyhq/releases/main/docs/screenshot.png)

```bash
npx @personizely/releases init
npx @personizely/releases dev      # http://localhost:3000
```

---

- [Why](#why)
- [Quick start](#quick-start)
- [Writing releases](#writing-releases)
- [Configuration](#configuration)
- [Team preview](#team-preview)
- [In-app panel and unread badge](#in-app-panel-and-unread-badge)
- [User tokens](#user-tokens)
- [API](#api)
- [Deploying](#deploying)
- [CLI](#cli)
- [Programmatic use](#programmatic-use)
- [FAQ](#faq)

## Why

Hosted changelog tools are fine until you stop opening them. Release notes end up in a separate editor, away from the code that shipped, and the changelog goes quiet for months.

This package keeps release notes in your repository, where an AI assistant or a teammate can draft them from the diff, and where review happens in the same pull request as the feature. You still get the parts that are tedious to build: a good-looking public page, an in-app panel, and unread tracking per user.

## Quick start

Requires **Node 22.13+**. It uses the built-in `node:sqlite`, so there is nothing native to compile.

```bash
npm install --save-dev @personizely/releases
npx releases init        # creates releases/ with a config and a first entry
npx releases dev         # preview with drafts and live reload
```

`releases dev` opens on http://localhost:3000. Edit any file in `releases/` and the browser reloads.

## Writing releases

One file per change, named `YYYY-MM-DD-short-slug.md`. The slug becomes the permanent URL, so titles can change freely.

```bash
npx releases new "Profit per visitor in experiment reports" --type new
```

```markdown
---
title: Profit per visitor in experiment reports
type: new                    # new | improved | fixed
tags: [Experiments, Reports]
image: assets/profit.png     # optional hero image from releases/assets/
draft: false
---

Revenue per visitor can crown a variant that wins on sales but loses on margin.
Reports now show **profit per visitor** for every variant.

## How to use it

- Open an experiment and switch the primary metric to Profit per visitor.
```

| Field | Default | |
|---|---|---|
| `title` | required | |
| `date` | from the file name | `YYYY-MM-DD`. Entries dated in the future stay hidden until that day, so you can schedule releases. |
| `type` | `new` | `new`, `improved` or `fixed`. Drives the label, color and filter. |
| `tags` | `[]` | |
| `image` | none | Shown above the body. Paths like `assets/x.png` resolve to `releases/assets/`. |
| `summary` | first paragraph | Shown in the in-app panel. |
| `announce` | `true` | Only announced entries count as unread. Use `false` for small fixes and backfilled history. |
| `draft` | `false` | Drafts only appear in `releases dev` and team preview. |
| `internal` | `false` | For your team only: shown in `releases dev` and team preview, never on the public page, feed, panel or unread count. Good for infrastructure work, onboarding tweaks and other changes customers don't need to read about. |
| `order` | `0` | Higher shows first among entries from the same day. |

Bodies are GitHub-flavored Markdown. Images can live in `releases/assets/` or anywhere on the web.

Run `npx releases check` in CI. It validates the config and every entry, reports all problems at once, and exits with code 1 on any error.

## Configuration

Zero config works. To brand it, add `releases.config.json` inside `releases/`, or a `releases.config.{ts,js,json}` next to your `package.json`.

```json
{
  "$schema": "../node_modules/@personizely/releases/dist/schema.json",
  "name": "Personizely",
  "description": "New features, improvements and fixes in Personizely.",
  "website": { "label": "personizely.net", "href": "https://www.personizely.net" },
  "logo": { "light": "assets/logo.svg", "dark": "assets/logo-dark.svg" },
  "favicon": "assets/favicon.png",
  "font": "Inter",
  "colors": {
    "accent": "#2f54eb",
    "background": { "light": "#ffffff", "dark": "#0f1115" }
  },
  "labels": { "fixed": "Bug fix" }
}
```

The `$schema` line gives you autocomplete and validation in VS Code and JetBrains. In TypeScript:

```ts
// releases.config.ts (Node 22.18+ loads it directly)
import { defineConfig } from '@personizely/releases'

export default defineConfig({
  name: 'Personizely',
  font: 'Inter',
  colors: { accent: '#2f54eb' },
})
```

| Option | Default | |
|---|---|---|
| `name` | `Changelog` | Product name, used in the header and titles. |
| `title` | `<name> changelog` | Page heading. |
| `description` | `New features, improvements and fixes.` | |
| `url` | from the request | Public base URL. Detected from `Host` and `X-Forwarded-*`, so it works behind Coolify, Fly, Render or nginx without setting it. Set it if you cache pages on a CDN. |
| `website` | none | `{ label, href }` link back to your product. |
| `logo` | name as text | Path or URL, or `{ light, dark }`. `logoHeight` sets its height (default 28). |
| `favicon`, `ogImage` | none | |
| `font` | system font | A Google Fonts family name such as `"Inter"`, or `{ family, url }` for any other font. |
| `colors` | | `accent`, `background`, `text`, `muted`, `border`, and per-type `new`, `improved`, `fixed`. Each takes one color or `{ light, dark }`. Dark mode follows the visitor's system setting. |
| `labels` | `New feature`, `Improvement`, `Fix` | Wording for each type. |
| `embed` | `{ title: "What's new", limit: 30 }` | In-app panel heading and number of entries. |

Runtime settings come from the environment, which overrides the file:

| Variable | Default | |
|---|---|---|
| `RELEASES_SECRET` | none | Turns on the API. At least 32 characters: `npx releases secret`. Never put it in the config file. |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | |
| `RELEASES_DIR` | `./releases` | |
| `DATA_DIR` | `./.data` | Where the SQLite file lives. **Use a persistent volume in production.** |
| `PUBLIC_URL` | from the request | Same as `url`. |
| `FRAME_ANCESTORS` | `*` | Who may embed the panel, e.g. `https://app.example.com`. Set it in production. |
| `ALLOWED_ORIGINS` | `*` | CORS for the browser API. User tokens travel in a header, never a cookie, so `*` is safe. |
| `PREVIEW_TOKEN` | none | Turns on [team preview](#team-preview). At least 16 characters. |

### Team preview

Set `PREVIEW_TOKEN` and share this link with your team:

```
https://releases.example.com/preview?token=<PREVIEW_TOKEN>
```

It sets a 30-day cookie in their browser. While it is set, they see drafts, internal entries and scheduled entries on the live site, each with a label, plus a banner with an exit link. Those responses are never cached. Everyone else, the RSS feed, the JSON feed, the in-app panel and the unread counts only ever see published entries.

## In-app panel and unread badge

Install the package in your frontend too (the client has no dependencies), or load it straight from your releases server.

```ts
import { createReleases } from '@personizely/releases/client'

const releases = createReleases({
  url: 'https://releases.example.com',
  getToken: () => fetch('/api/releases-token').then(r => r.text()), // see "User tokens"
})

// Any element becomes a trigger with a pulsing unread dot
releases.attach(document.querySelector('#whats-new'))
```

That's the whole integration. The dot shows while there are unread releases. Clicking opens a slide-in panel, unread entries are highlighted, and the dot clears.

```html
<!-- No bundler -->
<script type="module">
  import { createReleases } from 'https://releases.example.com/client.js'
</script>
```

Building your own UI instead:

```ts
const { count, latest } = await releases.unread()  // latest: up to 5 unread entries
releases.on('seen', () => badge.hide())
releases.open()                                    // or put an iframe on await releases.embedUrl()
```

| | |
|---|---|
| `attach(el, { count?, color?, refresh?, openOnClick? })` | Badge plus click-to-open. `count: true` shows a number instead of a dot. Re-checks every 5 minutes. Returns a cleanup function. |
| `unread()` | `{ count, unread, latest, lastSeenAt }` |
| `unreadCount()` | The count, or `0` on any error so a badge never breaks your page. |
| `open({ theme })`, `close()` | The panel. `theme` is `light`, `dark` or `auto`. |
| `embedUrl({ theme })` | For your own drawer component. |
| `markSeen()` | Mark everything as seen without opening the panel. |
| `on('seen' \| 'open' \| 'close' \| 'error', fn)` | Returns an unsubscribe function. |

### How "unread" works

The server stores one "last seen" timestamp per user, nothing per entry. An entry is unread when it is announced and was published after that timestamp.

- **Publish time** is when the server first saw an entry, so something you ship at 6pm still shows for someone who checked at 9am.
- **First deploy** back-dates entries to their own dates, so importing years of history does not light up every badge.
- **New users** start from the `since` date in their token (pass their signup date) or from the moment they are first seen. Nobody gets a badge for releases from before they signed up.

## User tokens

The browser needs to prove which user it is without seeing your secret. Your backend signs a short-lived token:

```
v1.<base64url(JSON {sub, exp, since?})>.<base64url(HMAC-SHA256(secret, "v1." + payload))>
```

- `sub` is the user id.
- `exp` is required, in unix seconds. Tokens that live longer than 30 days are rejected.
- `since` is optional: the ISO date their history starts from.

**Node**

```ts
import { signUserToken } from '@personizely/releases'

signUserToken(process.env.RELEASES_SECRET!, { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, since: user.createdAt })
```

**PHP**

```php
function releasesToken(string $secret, string $userId, ?DateTimeInterface $since = null, int $ttl = 3600): string
{
    $b64 = fn (string $s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    $payload = ['sub' => $userId, 'exp' => time() + $ttl] + ($since ? ['since' => $since->format(DATE_ATOM)] : []);
    $encoded = $b64(json_encode($payload, JSON_UNESCAPED_SLASHES));
    return 'v1.' . $encoded . '.' . $b64(hash_hmac('sha256', 'v1.' . $encoded, $secret, true));
}
```

Other languages need only HMAC-SHA256 and base64url. For a quick test token: `RELEASES_SECRET=... npx releases token user-123`.

## API

The API is off until `RELEASES_SECRET` is set. Public routes need no auth.

| Route | Auth | |
|---|---|---|
| `GET /` | | Changelog. `?type=new\|improved\|fixed` filters. |
| `GET /:slug` | | One entry. |
| `GET /embed` | | The in-app panel page. `?theme=light\|dark\|auto`, user token in the hash `#token=...`. |
| `GET /feed.xml` | | RSS. |
| `GET /releases.json` | | All published entries with rendered HTML. CORS open. |
| `GET /client.js` | | The browser client as an ES module. |
| `GET /preview?token=` | preview token | Turns on team preview in this browser. `/preview/exit` turns it off. |
| `GET /health` | | |
| `GET /api/me/unread` | user token | `{ count, unread, latest, lastSeenAt }` |
| `POST /api/me/seen` | user token | Mark everything seen. |
| `GET /api/users/:id/unread?since=` | secret | Same, from your backend. |
| `POST /api/users/:id/seen` | secret | |
| `POST /api/reload` | secret | Re-read the files without a restart. |

The user token and the secret are both sent as `Authorization: Bearer <value>`.

## Deploying

The server needs Node 22.13+, your `releases/` folder, and a persistent directory for SQLite. Deploy it from the same repo as your app, so merging a release note publishes it.

```dockerfile
FROM node:22-alpine
RUN npm install -g @personizely/releases@0.3
WORKDIR /app
COPY releases ./releases
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["releases", "serve"]
```

On Coolify, Railway, Render or Fly:

1. Point the service at this Dockerfile.
2. Mount a volume at `/data`.
3. Set `RELEASES_SECRET` and `FRAME_ANCESTORS`.
4. Add your domain.

There's nothing else to configure; the public URL is read from the proxy headers.

It runs as a single process. Unread state is a small SQLite file, so one instance handles a lot of traffic. Run more than one only if they share that volume.

## CLI

```
releases init                Create releases/ with a config and a first entry
releases dev                 Preview with drafts, scheduled entries and live reload
releases serve               Production server
releases new "Title"         Scaffold an entry  [--type new|improved|fixed] [--date YYYY-MM-DD]
releases check               Validate config and entries (CI)
releases token <userId>      Print a test user token  [--ttl seconds]
releases secret              Generate a RELEASES_SECRET

--cwd <path>  --dir <path>  --port <n>
```

## Programmatic use

Mount it inside an existing server, or run your own checks:

```ts
import { loadConfig, createApp, loadReleases } from '@personizely/releases'

const { app } = await createApp(await loadConfig())
// app is a Hono instance: mount it with app.route(), or pass app.fetch to any Fetch-API server on Node
```

## FAQ

**Can an AI write the entries?** Yes, and that is the point of keeping them in Git. Ask your coding assistant to read the commits since the newest file in `releases/` and draft entries with `npx releases new`. A ready-made Claude Code skill is in [`examples/skill`](examples/skill/release-notes/SKILL.md).

**Is the Markdown sanitized?** No. Entries come from your repository and are trusted like the rest of your code. Do not feed it user-submitted content.

**Why SQLite and not Redis/Postgres?** The only state is one timestamp per user. A file on a volume is the least infrastructure that can hold it.

**Migrating from Olvy, Beamer, Headway, LaunchNotes?** Export your history to Markdown files with `announce: false`, then add one announced entry for what is new.

## Development

```bash
npm install
npm run dev        # serves examples/ with live reload
npm test           # vitest
npm run typecheck
npm run build      # dist/ via tsc
```

MIT © Personizely
