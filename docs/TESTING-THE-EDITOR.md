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
  show your changes persisted (in level 1, only until the dev server restarts; in levels 2–3,
  as a real commit).

One thing that looks broken but isn't: adding a **first** image where built-in decorative
artwork currently shows will not preview inline immediately — it only appears after a save and
a rebuild of the site.

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
