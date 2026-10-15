# @personizely/releases

Published npm package that serves release notes from Markdown files: public changelog page, an `/embed` view for the in-app iframe, and an unread-count API backed by SQLite (`node:sqlite`).

- Plain ESM JavaScript, no build step. Node >= 22.13. Keep runtime dependencies to `marked` and `yaml`.
- `src/content.js` parses files, `src/store.js` keeps publish times and per-user seen watermarks, `src/auth.js` signs and verifies user tokens, `src/server.js` routes, `src/views.js` renders HTML, `src/static/` holds CSS and the embed script, `src/client.js` is the browser client for host apps.
- The package must stay generic: no Personizely-specific content or URLs in `src/`. Personizely config and content live in the backend repo.
- The token format is mirrored in PHP in `examples/host/ReleasesToken.php`. Change both together.
- Run `npm test` before committing. Run `npm run dev` to preview `examples/releases`.
- Never use symbols like `’` in comments or strings.
