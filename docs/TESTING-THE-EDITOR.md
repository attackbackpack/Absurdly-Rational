# Testing the visual site editor

There are three levels of testing the editor, in order of how much they prove. Do them in
order — each one costs more setup than the last, but proves something the previous level
can't.

## 1. Look and feel — no credentials, ~2 minutes

This uses `scripts/dev-editor-api.mjs`, a dependency-free Node server that speaks the same
HTTP contract as the real Worker (`worker/src/worker.js`) but never touches GitHub. It has no
security value; its only job is to let the editor UI run.

Saves through this server **really do write to your working tree**: a save updates
`_data/site.json` (and any uploaded files under `assets/uploads/`) on disk, the same bytes the
editor produced, byte-for-byte. Jekyll's file watcher picks up the change and rebuilds
automatically, so this is how you actually confirm saving works: make an edit, press Save,
then press "Reload preview" — you should see your change in the rendered page, not the
original text. If it still shows the original after a save, something is broken.

This modifies tracked files in your checkout — it is not a commit, but it is a real change to
files `git status` will show. **Undo it before committing anything else**, so your local test
edits never end up in a commit:

```bash
git checkout -- _data/site.json && git clean -fd assets/uploads
```

Run that after every level-1 test session. If you'd rather the dev server not touch disk at
all (the old behavior — everything held in process memory, lost on restart), start it with
`DEV_EDITOR_MEMORY_ONLY=1 npm run dev:editor-api`.

Two terminals, from the repository root:

```bash
# terminal 1
npm run dev:editor-api
```

```bash
# terminal 2 — bundle install must have been run once already
bundle exec jekyll serve --port 4000
```

Open `http://localhost:4000/editor/?preview=/index.html` and sign in with `test-password`
(or whatever you set via `DEV_EDITOR_PASSWORD` when starting the dev server).

`http://localhost:8788` (the dev API you started in terminal 1) is an API with no page of its
own — opening it directly in a browser is a natural way to check it's alive, but it will
return a plain 404 for `/`. That's expected: it only serves `/auth` and `/content`. The page
to open is always the `localhost:4000` editor URL above, not the API's own address.

The editor automatically talks to `http://localhost:8788` whenever it's loaded from a local
host like `localhost` — there is nothing to edit or revert in `editor/index.html`. The
committed `data-api` attribute on `<body>` always points at the deployed Worker and is only
ever meant to change when you substitute your own deployed Worker URL for production.

What this level proves: the editor's read/edit/save/render loop is sound — sign-in flow, hover
states, click-to-edit, the image panel, and that a save actually lands and reloads correctly.
What it does **not** prove: anything about GitHub, real authentication, or the write-path
allowlist. The stand-in does enforce the same path allowlist shape as the real Worker (only
`_data/*.json` and `assets/uploads/*`), but it is not a security boundary — nothing here
guards against a hostile client the way production auth does, and there is no rate limiting or
real commit history.

## 2. Real end-to-end, without deploying the Worker

This runs the *actual* `worker/src/worker.js` locally via `wrangler dev`, so it exercises the
real GitHub write path — saves become real commits on the `editor` branch.

First complete steps 1–6 of `worker/SETUP.md` (create the GitHub App, install it on the repo,
record the App ID, private key, and installation ID; you do not need to deploy or set secrets
with `wrangler secret put` for this level — those are for production).

Then run the Worker locally, supplying the real secrets as local-only variables. Never put the
private key on a command line — `wrangler dev` reads a `.dev.vars` file (untracked, do not
commit it) for local secrets, so create `worker/.dev.vars` with the same secret names used in
`worker/SETUP.md` step 8 (`EDITOR_PASSWORD`, `SESSION_SECRET`, `GITHUB_APP_ID`,
`GITHUB_INSTALLATION_ID`, `GITHUB_REPO`, `GITHUB_APP_PRIVATE_KEY`), each set to your real
value, then:

```bash
npx wrangler dev --config worker/wrangler.toml --port 8787 \
  --var ALLOWED_ORIGIN:http://localhost:4000
```

The `--var` override is needed because `worker/wrangler.toml` hardcodes
`ALLOWED_ORIGIN = "https://absurdlyrational.com"` for production; without overriding it here,
the local Worker's CORS check will reject requests from `http://localhost:4000`.

The real Worker listens on port 8787, not the dev stand-in's 8788, so tell the editor to use
that port instead by adding `apiPort=8787` to the URL:
`http://localhost:4000/editor/?preview=/index.html&apiPort=8787`. This only ever switches
between the two known local Worker ports — there is still nothing to edit in `editor/index.html`
and nothing to revert. Sign in with the real `EDITOR_PASSWORD` and edit. Saves land as real
commits on the `editor` branch of the repo the GitHub App is installed on — check GitHub
afterward to confirm. Do not commit `worker/.dev.vars`.

This is the level that actually proves the GitHub write path, real authentication, and the
edit-path allowlist.

## 3. The real thing

Finish `worker/SETUP.md` (deploy with `npx wrangler deploy`, point `data-api` at the deployed
Worker URL), merge to `main`, and confirm at `https://absurdlyrational.com/editor/`.

## What to click, once signed in

- **Hover a headline or other editable text.** An outline/affordance should appear around it;
  nothing else on the page should shift.
- **Click text and type.** The field becomes editable in place; your keystrokes appear
  immediately, and the rest of the page stays static.
- **Press Escape.** The field reverts to its last-saved content and exits edit mode — your
  in-progress keystrokes are discarded, not saved as a draft.
- **Click an image.** The image panel opens, offering upload/replace and fit/focus controls.
- **Open Page settings.** A panel with page-level fields (title, description, etc., depending
  on the page) opens without disturbing the live preview underneath.
- **Press Save.** A save indicator appears and resolves to success; reloading the editor should
  show your changes persisted (in level 1, as a real change to `_data/site.json` in your
  working tree — undo it with the command above; in levels 2–3, as a real commit).

One thing that looks broken but isn't: adding a **first** image where built-in decorative
artwork currently shows will not preview inline immediately — it only appears after a save and
a rebuild of the site.

## Verifying across every page

The checks above cover one page in isolation. This section walks the editor across all four page
templates — homepage, readings index, a reading topic page, podcasts, memes — and the navigation
between them. Run it at level 1 (the dev harness above): `npm run dev:editor-api` in one
terminal, `bundle exec jekyll serve --port 4000` in another, signed in at
`http://localhost:4000/editor/?preview=/index.html`. Like everything else at level 1, working
through this list proves the editor's read/edit/save/render loop across pages — it proves nothing
about GitHub, the real password, or the Worker's write-path allowlist. Run the same checklist at
level 2 or 3 if you need that proof.

### Check this first: does the preview actually scroll?

Homepage and podcasts run well past one screen of content, so before working through anything
below, confirm you can scroll the preview pane (mouse wheel, trackpad, or dragging the scrollbar)
on at least one of those pages.

This is flagged first because during automated verification of this feature, the preview iframe
would not scroll programmatically — about 2810px of page content in a 655px frame, with
`scrollTop` refusing to move no matter what was tried — even though the identical page scrolled
normally in an ordinary browser tab. It was not possible to tell from that environment whether
this is a real defect or an artifact of driving the page by automation rather than a human hand
on a mouse. If scrolling works normally for you here, treat that finding as closed and move on. If
it genuinely does not scroll — if you can only ever reach the top of each page no matter what you
try — stop and report it; that would be a blocking bug, since most of the checks below assume you
can reach content further down the page.

### Per-page checks

**Homepage**
- [ ] Sign in and confirm the page has 28 editable text regions and 4 image frames reachable by
  hovering (the exact count is a snapshot of the current homepage — if content has been added or
  removed since, expect the count to have moved accordingly, not to be wrong).
- [ ] The toolbar title reads "Editing the draft homepage."
- [ ] Click the "Choose your format" control (`#formats`). It should scroll the preview to that
  section in place. It must **not** load the editor itself into the preview pane — that was a
  real bug (a bare `#fragment` href resolving against the parent document instead of the iframe),
  fixed in Task 10; confirm it stays fixed.
- [ ] Click an external link if one is visible (Substack, Spotify, LinkedIn). Nothing should
  happen — no navigation, no new tab.

**Readings index**
- [ ] Click the readings nav link. The preview navigates, the overlay re-attaches (hover and click
  still work on the new page), and the toolbar title updates to "Editing the draft readings."
- [ ] Make one text edit here and leave it unsaved — you'll save it together with a podcasts edit
  in the cross-file check below.

**A reading topic page**
- [ ] Click into one topic ("door") from the readings index. The toolbar title updates again and
  the overlay is live on the topic page.

**Podcasts**
- [ ] Navigate to podcasts. Toolbar title updates to "Editing the draft podcasts."
- [ ] Edit the footer text (any page's footer works for this — editing it here, with the readings
  edit above still pending, is what the cross-file check needs).

**Memes**
- [ ] Navigate to memes. Toolbar title updates to "Editing the draft meme bank." Confirm 6 tiles
  are visible.
- [ ] Click a tile. A panel opens with four fields: Title, Caption, Artwork headline, Artwork
  accent.
- [ ] Press Escape. The panel closes.

### Navigation, more generally

- [ ] With the draft still dirty from the edits above, move between pages several times
  (homepage, readings, a topic page, podcasts, memes, and back). Navigating must **not** prompt
  about discarding unsaved work, and must not lose it — the draft spans all four data files, so an
  edit made on readings has to survive a trip through podcasts and memes and back.
- [ ] The "Unsaved changes" indicator stays visible on every page you land on while the draft is
  dirty — check it doesn't go blank after a navigation even though Save is still enabled.

### The cross-file save

- [ ] With the readings edit and the podcasts footer edit both still pending, press Save once.
- [ ] Check `git diff` afterward: exactly two files should have changed — `_data/readings.json`
  and `_data/site.json` — each with exactly one changed line and no reflow or reformatting
  elsewhere in either file.
- [ ] Undo the test edits before committing anything else, per the note in section 1 above:
  ```bash
  git checkout -- _data/site.json _data/readings.json
  ```

### The two guards that actually matter

Unlike navigation between pages (which should *not* interrupt you), these two exist specifically
to stop you from losing work by accident, and both should fire every time:

- [ ] With a dirty draft, use "Reload preview." Confirm it prompts — "Reloading discards unsaved
  changes. Continue?" or equivalent wording — and that Cancel keeps your edit while proceeding
  discards it.
- [ ] With a dirty draft, close or reload the browser tab itself. The browser's native
  leave-site warning should appear.

## Troubleshooting

- **`EADDRINUSE` on port 4000 or 8788.** Something is already listening there — probably a
  server from an earlier session that never got stopped. Free the port and try again:
  `lsof -ti :4000 | xargs kill -9` for Jekyll, or `lsof -ti :8788 | xargs kill -9` for the dev
  editor API. `npm run dev:editor-api` now reports this itself instead of dumping a stack
  trace; Jekyll's own port conflict message will point at 4000.
- **`bundle exec jekyll serve` fails with a "cannot load such file" or similar gem error.**
  `bundle install` hasn't been run yet in this checkout (or a Gemfile change hasn't been
  picked up). Run `bundle install` from the repository root, then retry.

## A note on `docs/`

This file lives outside the Jekyll build. `_config.yml` already excludes `docs` from the
generated site, so nothing here is published.
