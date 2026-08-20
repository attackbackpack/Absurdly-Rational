# Testing the visual site editor

There are three levels of testing the editor, in order of how much they prove. Do them in
order — each one costs more setup than the last, but proves something the previous level
can't.

## 1. Look and feel — no credentials, ~2 minutes

This uses `scripts/dev-editor-api.mjs`, a dependency-free Node server that speaks the same
HTTP contract as the real Worker (`worker/src/worker.js`) but never touches GitHub and keeps
everything in process memory — restart it and every "save" is gone. It has no security value;
its only job is to let the editor UI run.

Two terminals, from the repository root:

```bash
# terminal 1
npm run dev:editor-api
```

```bash
# terminal 2 — bundle install must have been run once already
bundle exec jekyll serve --port 4000
```

Then point the editor's static shell at the dev server instead of the deployed Worker. Open
`editor/index.html` and change the `data-api` attribute on `<body>`:

```html
<body data-api="http://localhost:8788">
```

Rebuild so the change is picked up:

```bash
bundle exec jekyll build
```

Open `http://localhost:4000/editor/?preview=/index.html` and sign in with `test-password`
(or whatever you set via `DEV_EDITOR_PASSWORD` when starting the dev server).

**Before committing anything, revert the `data-api` change in `editor/index.html`.** That
attribute normally points at the deployed Worker in production — leaving it pointed at
`localhost:8788` would break the real editor for anyone who isn't running this dev server.

What this level proves: the UI works — sign-in flow, hover states, click-to-edit, the image
panel, save/error plumbing. What it does **not** prove: anything about GitHub, real
authentication, or the write-path allowlist. The stand-in enforces none of those — it accepts
any file path and never rate-limits or persists anything.

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

Point `data-api` at `http://localhost:8787` the same way as level 1, rebuild, sign in with the
real `EDITOR_PASSWORD`, and edit. Saves land as real commits on the `editor` branch of the
repo the GitHub App is installed on — check GitHub afterward to confirm. Revert `data-api`
before committing, same as level 1, and do not commit `worker/.dev.vars`.

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
  show your changes persisted (in level 1, only until the dev server restarts; in levels 2–3,
  as a real commit).

One thing that looks broken but isn't: adding a **first** image where built-in decorative
artwork currently shows will not preview inline immediately — it only appears after a save and
a rebuild of the site.

## A note on `docs/`

This file lives outside the Jekyll build. `_config.yml` already excludes `docs` from the
generated site, so nothing here is published.
