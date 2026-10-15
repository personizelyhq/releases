# @personizely/releases

Published npm package: release notes from Markdown files, served as a public changelog, an `/embed` page for an in-app panel, and an unread-count API backed by SQLite (`node:sqlite`).

## Stack
- TypeScript, compiled with plain `tsc` to `dist/` (no bundler). Node >= 22.13. ESM only, `NodeNext` resolution, so relative imports end in `.js`.
- Hono for routing and middleware, Hono JSX for server-rendered views. zod validates config and frontmatter. marked renders Markdown.
- vitest tests use `app.request()`; no server needed.

## Layout
- `src/config/` schema (`defineConfig`, zod) and loading (file + env).
- `src/content/` parsing entries and the in-memory `Repository` (watches files in dev).
- `src/store.ts` SQLite: publish times and one last-seen watermark per user.
- `src/releases.ts` unread logic. `src/auth.ts` user tokens (HMAC). `src/routes/api.ts` API.
- `src/app.tsx` the Hono app. `src/views/` JSX pages and RSS. `src/theme.ts` config to CSS variables.
- `src/static/` CSS and the embed script, copied to `dist/static/` by `scripts/postbuild.mjs` (which also writes `dist/schema.json`).
- `src/client.ts` browser client (no deps, no Node APIs). `src/cli.ts` the `releases` binary.
- `src/templates/release-notes-skill.md` the Claude Code skill `releases skill` installs; copied to `dist/templates/` on build.

## Rules
- Keep `src/` generic: no Personizely content or URLs. Personizely config and entries live in the backend repo.
- The token format is mirrored in PHP in `examples/host/ReleasesToken.php` and the README. Change them together.
- Colors are CSS `light-dark()` values; config colors accept a string or `{ light, dark }`.
- Run `npm run typecheck && npm test` before committing. `npm run dev` previews `examples/`.
- Never use symbols like `’` in comments or strings.
