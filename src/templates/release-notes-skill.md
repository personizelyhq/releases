---
name: release-notes
description: Write release notes (changelog entries) for what shipped, from git history and the issue tracker, with screenshots where they help. Use when asked to write release notes, update the changelog, announce shipped work, or "what did we ship since X".
---

<!--
  Template from @personizely/releases. Fill in the <ANGLE BRACKET> parts for your
  project (releases folder, repos, tracker, local app URL, tags) and delete this comment.
-->

## Overview

Release notes are Markdown files in `<RELEASES_DIR, e.g. releases/>` (settings in `releases.config.json` at the project root), served by `@personizely/releases` as the public changelog and the in-app "What's new" panel. One file per customer-visible change. A release note ships like code: you write drafts, the user reviews, a merge publishes.

Preview while writing: `npx releases dev` and open http://localhost:3000. Drafts and internal entries are visible there.

## Steps

### 1. Find where we stopped

The newest **published** entry (no `draft: true`, no `internal: true`) in the releases folder is the cutoff. Its date is the file name prefix.

### 2. Collect what shipped since then

- **Git**, in every repo that ships to customers (`<LIST REPOS, e.g. . and ../api>`): `git -C <repo> log --since=<date> --no-merges --date=short --pretty='%h %ad %s'`.
- **Issue tracker** (`<e.g. ClickUp list "Tasks", Linear team "Core", GitHub milestones>`): items marked done after the cutoff. Items still in review may be live; ask the user instead of assuming.
- Commit subjects lie by omission. For anything you will describe in detail, read the diff (`git show <hash>`), especially UI components for exact labels and menu locations, and migrations for what a setting stores and its default.

### 3. Decide what deserves a note

Classify every change before writing anything:

- **Own entry**: new features, new settings, integrations, and changes to how numbers are calculated. Changes to calculations always get their own entry, even if the diff is small, because they change what customers see.
- **Monthly roundup** (`Smaller improvements and fixes in <Month>`): small UX improvements and customer-visible bug fixes, one bullet each.
- **Internal entry** (`internal: true`): things the team should have on record but customers don't care about or can't use, such as onboarding tweaks, billing admin, internal analytics, and infrastructure work without a visible effect. Only visible in dev and team preview.
- **Skip**: refactors, dependency bumps, tests, reverts, telemetry, admin-only tools, and anything not actually released. If unsure whether something shipped, ask.

Show the user this classification as a short list and get a yes before writing.

### 4. Write the entries

Create each with the CLI so the file name and frontmatter are right:

```bash
npx releases new "Count orders when they are created, not only when they are paid" --type new --date 2026-07-04
```

Use the date the change shipped, not today. Frontmatter reference:

```yaml
title: Plain outcome, sentence case, no trailing period, under 70 characters
type: new | improved | fixed
tags: [<YOUR TAGS>]
image: assets/<slug>.png          # optional hero screenshot
announce: false                   # see step 6
draft: true                       # always; the user publishes
internal: true                    # only for team-only entries
```

Writing rules:

- Write for your customer (<WHO, e.g. "a Shopify merchant">), not a developer. Lead with what they can now do and why it matters to them.
- First paragraph: one or two sentences. It becomes the summary in the in-app panel.
- **Settings**: name the exact label and where it lives, list every option with what it does, say what the default is, and when to pick each one.
- **Changed calculations**: say what the old formula was, what the new one is, why, and add a "What you might notice" section about numbers shifting.
- **Limitations** belong in the note.
- Never invent details. If you cannot confirm something from code or the tracker, write the safe version and leave an HTML comment for the reviewer: `<!-- check: ... -->`.
- No hype words and no internal jargon (table names, class names, ticket ids).

### 5. Screenshots

Add a screenshot when the change is visual or lives in a place people need to find: a new screen, report, setting or editor feature. Skip them for fixes, calculation changes, API changes and roundups.

1. **Use demo data only.** Log into the local app (`<LOCAL APP URL>`) with a test account. Never capture real customers' names, emails, domains or numbers.
2. **Capture** with the browser tool available in the session (Claude in Chrome, Playwright or similar). Light theme, viewport 1440 x 900, device scale factor 2.
3. **Crop to the feature**: the panel, modal or section that changed, with a little context, not the whole screen.
4. **Save** to `<RELEASES_DIR>/assets/<entry-slug>.png` (`-2`, `-3` for more). If `cwebp` is installed, convert to WebP (`cwebp -q 82 in.png -o <entry-slug>.webp`) and delete the PNG. Keep files under about 300 KB.
5. **Reference** the main one as `image: assets/<entry-slug>.webp` and others inline with descriptive alt text: `![Attribution setting in Tracking settings](assets/<entry-slug>-2.webp)`. Width and height are added automatically.
6. **Check** it in `releases dev`: readable, no personal data, nothing cut off.

If no browser tool is available, write the entry without images and add `<!-- check: screenshot of <what, where> -->`.

### 6. The unread badge

Only entries with `announce: true` light up the "What's new" badge, once per entry. Avoid a wall of badges:

- For a normal release, announce the one or two notable entries and leave the rest `false`.
- When catching up on several weeks or months, keep individual entries `announce: false` and write one announced roundup dated today, `What we shipped since <Month>`, linking to them (`[A new dashboard](/new-dashboard)`; the slug is the file name without the date).
- Fixes and internal entries are never announced.

### 7. Validate and hand over

```bash
npx releases check
```

Then give the user: the files created (title, type, announced or not), every `<!-- check -->` you left, and anything you skipped and why. Do not set `draft: false` yourself and do not commit; the user reviews and publishes.
