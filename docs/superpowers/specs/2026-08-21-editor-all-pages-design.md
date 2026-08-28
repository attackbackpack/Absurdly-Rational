# Visual site editor — all pages (phase 2)

Date: 2026-08-21
Status: proposed
Builds on: docs/superpowers/specs/2026-08-19-visual-site-editor-design.md (v1, homepage, shipped)

## Goal

Extend the click-to-edit editor from the homepage to the whole site: the readings
index, the four reading topic pages, podcasts, and memes, plus the navigation and
footer that appear on every page.

Scope is **editing existing text and images only**. Adding, deleting, and
reordering readings, podcast guests, and memes stays in Pages CMS. That is the
part click-to-edit does not naturally express, and it is deliberately deferred.

## Addressing collection items — no data migration needed

The templates filter and re-sort collections, so array position cannot identify an
item. Each collection already carries a usable key:

| Collection | Key | Why it is safe |
|---|---|---|
| `podcasts.guests` | `key` | Already unique and present on all items. Same pattern as `home.formats`. |
| `memes.items` | `key` | Already unique and present on all items. |
| `readings.posts` | `url` | Unique and present on all 23 posts. Required by Pages CMS and already validated. A reading exists to link out, so it always has one. |

`scripts/validate-content.js` gains a uniqueness check for all three, so a
duplicate key or URL cannot silently make two items unaddressable.

No `id` field is added. The earlier plan deferred an id migration; the data made it
unnecessary.

## What becomes editable

**Click-to-edit on the page** — visible text and images:

- Readings index: page title, lede, each topic's title/description/index label, the source note.
- Topic pages (×4): topic title/description, back label, post CTA label, each post's title/subtitle/image, the source note.
- Podcasts: page title/lede, show title/description/meta/label/button label/image, each guest's title/description/meta/art label/image, the invite block.
- Memes: page title/lede, each meme's title/caption/image, the starter note.
- Navigation labels and footer note/contact label, on every page.

**Page settings panel** — per page, for what has no visual representation:

- The five SEO fields for that page.
- External destination URLs: `readings.page.archive_url`, `podcasts.page.show.url`,
  `podcasts.page.invite.url`, and each guest link's URL.

**Deliberately not editable:**

- Internal paths (`topics[].path`, `navigation[].url`, `formats[].url`). A typo
  silently breaks navigation and there is no reason to retarget the site's own pages.
- ARIA labels (`topic_index_aria`, `wall_aria`, `dialog_*_label`, `items[].aria_label`).
  They are accessibility strings that rarely change and would clutter the panel for a
  non-technical editor. Pages CMS still edits them. Revisit if asked for.
- `visible` toggles, `layout`, `variant`, `class_name` — structural, Pages CMS owns them.

## Navigation between pages

The site's own links become live in the editor. Clicking "Readings" in the nav
navigates the iframe, and the overlay re-attaches against the new page. This
matches how the owner asked for it to work: it feels like browsing the real site,
with nothing new to learn.

Two consequences that must be handled:

1. **Unsaved changes must survive or warn.** Navigating away with a dirty draft
   currently loses it silently. Before navigating, if the draft is dirty, the editor
   asks the editor to save or discard. Losing a paragraph to a stray nav click is the
   single worst failure this feature could have.
2. **The overlay must be rebuilt per page, without leaking listeners.** `detach()` is
   already verified to remove everything it added; the iframe `load` handler calls it
   before re-attaching, exactly as the save path already does.

External links (Substack, Spotify, LinkedIn) stay inert while editing, as today.

## Multi-file drafts

v1 read and wrote `_data/site.json` only. Phase 2 spans four files.

- `GET /content` returns all four data files and the branch head commit SHA.
- `createDraft` holds all four, tracks which changed, and `buildPayload` emits only
  the changed ones. Its `read`/`write` already take a `file:path` spec, so the
  per-file restriction in `draft.js` is simply lifted.
- `PUT /content` needs no change: its allowlist already admits `^_data/[a-z-]+\.json$`
  and it already commits multiple files atomically.

A save that touches readings and the footer produces one commit containing
`readings.json` and `site.json` — reviewable as a single change.

## Validation

`scripts/validate-edit-paths.mjs` currently scans `index.html` only. It gains the six
other templates and the two shared includes, so every `data-edit` attribute on every
page is proven to resolve against `_data` at build time. This is what stops silent
drift when a field is renamed, and it is the main defence for a change this wide.

`scripts/validate-content.js` gains the key-uniqueness check described above.

## Testing

Unit tests for the pure additions: multi-file draft state, the key-uniqueness rule,
and the extended path extraction.

Browser verification per page, using the existing local harness: hover, edit, Escape,
image panel, page settings, save, and — new for this phase — navigating between all
seven pages with and without unsaved changes.

## Deferred, unchanged from v1

- Adding, deleting, reordering collection items.
- ARIA label editing.
- Retiring Pages CMS.
