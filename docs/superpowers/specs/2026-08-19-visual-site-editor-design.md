# Visual site editor — design

Date: 2026-08-19
Status: approved for planning
Scope of this spec: v1 (homepage only)

## Problem

The current editing surface is [Pages CMS](https://app.pagescms.org), a third-party hosted
app driven by `.pages.yml` (770 lines). Pages CMS renders that config as generic stacked
forms. The site owner's father — the only day-to-day editor — finds it overwhelming: many
text boxes, bars, and sections, with no visual relationship to the site he is editing.

Pages CMS's UI cannot be restyled, reorganised beyond field grouping, or given hover
affordances. Only `.pages.yml` is under our control. Therefore a click-to-edit surface
means building our own editor in this repository.

## Goal

The editor shows the real website. Hovering an editable piece of text or an image
highlights it. Clicking it edits it in place. Saving goes to the existing `editor` branch
and flows through the existing preview and owner-review process unchanged.

Non-goal: editing backgrounds, gradients, layout, colour, or any other visual detail. Only
text and images are editable.

## What click-to-edit does and does not remove

Click-to-edit **scopes** the form; it does not eliminate it. Several fields have no visual
representation on the rendered page:

- image alt text
- image fit (`cover` / `contain`)
- image crop focus (nine positions)
- SEO title and descriptions

These remain form fields, but a click surfaces only the one to four fields belonging to the
thing that was clicked, instead of one continuous scroll of every field on the site. Text
is genuinely click-and-type. Images are click-and-small-panel.

## Architecture

Five pieces, three of them new.

| Piece | Location | New |
|---|---|---|
| `data-edit` attributes | `index.html`, `_includes/image.html` | edit |
| Editor shell (static HTML/CSS/JS, no build step) | `/editor/` in this repo | new |
| Auth + GitHub proxy | Cloudflare Worker | new |
| Repository write credential | GitHub App installed on this repo only | new |
| Path validation | `scripts/validate-content.js` | edit |

### Branch separation

The deploy workflow (`.github/workflows/deploy-pages-with-draft-preview.yml`) builds `main`
at the site root and `editor` at `/preview/`, in a single artifact on one origin.

The editor shell is therefore served from `main` at `/editor/`, while the iframe it drives
loads `/preview/index.html` from the `editor` branch. This separation means the editor is
never built from content the editor itself produced, so a bad content edit cannot break the
tool used to fix it.

Both are on `https://absurdlyrational.com`, so the shell has same-origin DOM access to the
iframe. This is the property the whole design depends on.

### Request flow

1. Dad opens `https://absurdlyrational.com/editor/`.
2. He enters the shared password. The Worker validates it and returns a session token.
3. The shell fetches `_data/site.json` from the `editor` branch through the Worker, along
   with the current head commit SHA of `editor`.
4. The shell loads `/preview/index.html` in an iframe.
5. On iframe load, the shell injects an overlay stylesheet and scans the iframe document
   for `[data-edit]` and `[data-edit-image]` nodes, attaching hover and click affordances.
6. Edits mutate an in-memory draft of the JSON and update the iframe DOM immediately.
7. **Save** sends the changed JSON and any uploaded image files to the Worker, which writes
   them to `editor` in a single commit.
8. Existing GitHub Actions validate the content and rebuild `/preview/`.
9. The shell reports the save succeeded, states that the rebuild takes roughly a minute, and
   offers a **Reload preview** button. It does not poll GitHub or reload the iframe on its
   own; Dad decides when to look. This keeps the shell free of workflow-status polling for
   a wait that is short and infrequent.
10. The existing *Request owner review* → pull request → owner merge flow is unchanged.

## The `data-edit` contract

Templates annotate every editable node with a data attribute naming its JSON path.

Format: `data-edit="<datafile>:<path>"` where `<datafile>` maps to `_data/<datafile>.json`.

```html
<p class="hero-thesis" data-edit="site:home.hero.thesis">{{ home.hero.thesis }}</p>
```

Images use a separate attribute on the frame element, because the editable unit is the
image object (path, alt, fit, focus), not a text node:

```html
<div class="home-hero-image image-frame image-frame--hero"
     data-edit-image="site:home.hero.image">
```

Array members are addressed by a stable key rather than by index, because templates filter
and re-sort arrays and index positions do not survive that:

```html
data-edit="site:home.formats[key={{ format.key }}].title"
```

`home.formats` already carries stable `key` values (`readings`, `podcasts`, `memes`), so v1
needs no data migration. `readings.posts`, `podcasts.guests`, and `memes.items` have no
stable identifier; adding one is deferred to the multi-page phase that first needs it.

### v1 editable field inventory

All under `_data/site.json`, key `home`:

- `hero.title_line_one`, `hero.title_line_two`, `hero.thesis`, `hero.description`,
  `hero.cta_label`, `hero.cta_url`
- `hero.image` (path, alt, fit, focus)
- `formats_intro.title`, `formats_intro.description`
- `formats[key=…].title`, `.description`, `.meta`, `.url`, `.image` — three items
- `context.title`, `context.description`, `context.aside`, `context.contact_label`
- `seo.title`, `seo.description`, `seo.og_title`, `seo.og_description`,
  `seo.twitter_description` — surfaced in a "Page settings" panel, as they render nowhere
  on the page

Deliberately excluded from v1: `site.navigation`, `site.footer`, and `site.brand_image`.
These render on the homepage but are shared chrome appearing on all seven pages; editing
them from a homepage-only editor would apply changes Dad cannot see the full effect of.
They join the editor in the multi-page phase.

## Editing interactions

**Division of surfaces.** Hover outlines and the editable text regions live *inside* the
iframe document, so they scroll and reflow with the page for free. Popovers and the editor
toolbar live in the shell, positioned from the node's `getBoundingClientRect()` plus the
iframe's own offset, and close on iframe scroll.

**Text.** Click makes the real node `contenteditable`. Because it is the actual rendered
node in the actual stylesheet, it is WYSIWYG with no replication effort.

`contenteditable` is set to `plaintext-only`, and the value is reduced to `textContent` on
commit to the draft. This is a correctness requirement, not a preference: `index.html:29`
renders `{{ home.hero.thesis }}` without an `escape` filter. Pages CMS forms can only
produce plain text, so this is safe today. A rich `contenteditable` region is not — pasting
from a word processor or web page would inject styled markup directly into the page. Plain
text on both ends closes this.

**Images.** Click opens a popover with four controls: *Replace* (file picker), *Alt text*,
*Fit*, *Crop focus*. Replacing sets the `<img>` src to a local `blob:` URL for immediate
feedback; the file is uploaded on save. Fit and focus preview by swapping the
`image-fit-*` and `image-focus-*` classes, mirroring the mapping in `_includes/image.html`.

That mapping is therefore duplicated between the Liquid include and the editor JavaScript.
This is accepted: it is nine focus values and two fit values, both closed sets already
enforced by `scripts/validate-content.js`.

**Structural edge case.** `index.html:14` and `index.html:52` render entirely different DOM
when an image path is blank — geometric fallback artwork instead of an `<img>`. Adding a
first image to a slot that had none, or clearing the last one, changes the structure in a
way the live overlay cannot fake. In those two transitions the popover states that the
preview updates after saving.

**Unsaved work.** The shell warns on navigation away while the draft is dirty.

## Worker API

Hosted on Cloudflare Workers. Approximately 200 lines: GitHub App JWT signing via WebCrypto
accounts for most of it.

- `POST /auth` — body `{password}`. Returns a signed session token (HMAC, 8 hour expiry) or
  401.
- `GET /content` — body-less; returns the contents of `_data/site.json` on `editor` plus the
  current head commit SHA of `editor`. v1 reads only this one file; the endpoint takes no
  file parameter until the multi-page phase needs one.
- `PUT /content` — body `{files: [{path, contentBase64}], baseCommitSha, message}`. Writes
  all files in one commit using the Git Data API (create blobs → tree → commit → update
  ref), so JSON changes and image uploads land together atomically.

Image upload is folded into `PUT /content` rather than given its own endpoint; an upload is
just a file with base64 content, and a separate endpoint would break commit atomicity.

**Session transport.** The session token is returned in the response body, held in
`sessionStorage`, and sent as an `Authorization: Bearer` header. A cookie was rejected
because it would require the Worker to share a registrable domain with the site, which
depends on DNS arrangements this design should not assume. The editor page is static,
self-hosted, and loads no third-party scripts, so the XSS exposure of `sessionStorage` is
minimal, and sessions expire in 8 hours.

**Conflict detection.** The client sends the `baseCommitSha` it read from. If the current
head of `editor` differs, the Worker returns 409 and the shell tells Dad to reload. This is
the honest simple behaviour; no merge is attempted.

**GitHub credential.** Worker secrets hold the GitHub App ID and private key. The Worker
signs an RS256 JWT, exchanges it for an installation access token, and caches that token in
memory for 55 minutes.

**Brute-force protection.** A Cloudflare KV namespace counts failed `POST /auth` attempts
per IP and refuses the request once the stored count reaches 10. The counter is a
read-modify-write over a store with no atomicity and up to 60s of propagation delay, so it
is not a hard cap: requests issued in parallel can all read the same count and all write
back the same increment. It throttles serial guessing, which is what a person or a simple
script does; it does not stop a parallel attack. The blast radius if it is beaten is a
draft branch of an already-public repository, so this is deliberate rather than a gap to
close with a distributed counter.

## Security boundary

The Worker enforces a hard-coded allowlist on every write, independent of the request:

- branch must be `editor`
- each path must match `^_data/[a-z-]+\.json$` or `^assets/uploads/[A-Za-z0-9._-]+$`

The worst case if the password leaks is that someone edits content files on a draft branch
of an already-public repository. `main` remains branch-protected, and publishing still
requires an owner-approved merge. This is the same blast radius as the current Pages CMS
arrangement.

The editor page is excluded from search indexing: a `noindex` meta tag on `/editor/` and a
`Disallow: /editor/` rule in `robots.txt`.

The password is set by the repository owner directly as a Worker secret. It is never stored
in this repository, never placed in browser JavaScript, and never handled by anyone but the
owner.

## Testing

**Automated.** `scripts/validate-content.js` gains a pass that scans template files for
`data-edit` and `data-edit-image` attributes, resolves each `<datafile>:<path>` against the
corresponding `_data/*.json`, and fails on any path that does not resolve. Where a path
segment contains Liquid interpolation — `[key={{ format.key }}]` — the validator treats it
as "any member" and asserts that the trailing field exists on every member of the array.

This catches attribute typos immediately and silent drift later when a JSON field is
renamed. It runs in the existing `.github/workflows/validate-content.yml` on every push and
pull request touching `_data/**` or `scripts/**`; the workflow's path filter is extended to
include the templates.

**Validation failures.** `validate-content.yml` runs after the commit lands on `editor`, so
a content error is reported by the workflow rather than blocked at save time. This matches
the current Pages CMS behaviour exactly and is unchanged by this work; the editor adds no
client-side duplicate of those rules.

**Manual verification for v1.** Edit each field in the inventory above, save, and confirm
the change appears at `/preview/`. Specifically confirm: a hero image added where none
existed, an image fit and focus change, a 409 conflict path, and a paste of styled rich
text arriving in the JSON as plain text.

## Rollout

Pages CMS remains fully installed and functional throughout v1. The new editor is additive
and unlisted, so Dad is never blocked on anything it does not yet cover. `OWNER_CMS_SETUP.md`
gains a section describing the new editor alongside the existing flow.

Two steps require credentials and must be performed by the repository owner, not by an
agent: creating the GitHub App and installing it on this repository only, and deploying the
Worker with the password, App ID, and private key set as secrets. The implementation
delivers the Worker source and exact step-by-step instructions for both.

## Deferred

- The other six pages: readings index, four reading topic pages, podcasts, memes.
- Shared chrome: navigation labels, footer note, brand image.
- Adding, deleting, and reordering readings, podcast guests, and memes. This is the part
  click-to-edit does not naturally express and needs its own interaction design.
- Stable `id` fields on `readings.posts`, `podcasts.guests`, `memes.items`.
- Retiring Pages CMS. It is retired only once the editor covers everything Dad uses.
