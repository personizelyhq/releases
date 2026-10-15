---
name: release-notes
description: Draft customer-facing release notes from recent commits into the releases/ folder (Markdown files served by @personizely/releases). Use when asked to write release notes, update the changelog, or announce shipped work.
---

# Release notes

Entries live in `releases/` as `YYYY-MM-DD-short-slug.md`. One file per customer-visible change.

## Steps

1. Find the last release date: the newest file name in `releases/`.
2. Collect what shipped since then. Run `git log --since=<date> --no-merges --pretty='%h %ad %s' --date=short` in this repo and in any sibling repos the user names. Read PR descriptions or diffs when a subject line is unclear.
3. Group commits into customer-visible changes. Drop refactors, dependency bumps, internal tooling and anything a merchant would never notice.
4. For each change, run `npx releases new "<title>" --type new|improved|fixed --date <ship date>` and fill in the file.
5. Run `npx releases check`. Show the user the list of files you created and ask which to publish; set `draft: false` only on the ones they approve.

## Writing rules

- Write for a Shopify merchant or ecommerce manager, not a developer. Lead with what they can now do and why it matters to revenue, conversion or time saved.
- Title: plain statement of the outcome, sentence case, no trailing period, under 70 characters. "Target visitors by the collections they browse", not "Collection targeting v2".
- First paragraph: one or two sentences. It becomes the summary in the in-app panel.
- Then a short "How to use it" list only if there are steps.
- `type`: `new` for a capability that did not exist, `improved` for a better existing feature, `fixed` for bugs.
- Set `announce: false` for small fixes and for anything back-dated, so it does not trigger the unread badge.
- When backfilling several months, write individual entries with `announce: false` plus one announced roundup entry dated today that links to the biggest ones.
- Never use the characters `’` or `“ ”`; use straight quotes.
- Images go in `releases/assets/` and are referenced as `assets/name.png`.
