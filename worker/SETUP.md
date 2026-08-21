# Setting up the visual site editor

The visual editor (`/editor/`) is a small Cloudflare Worker that signs the owner in with a
password, reads `_data/site.json` from the `editor` branch, and commits changes back to it
through a GitHub App. Nobody can use the editor until this Worker is deployed. This is a
one-time setup, done by the repository owner from their own computer — it needs credentials
that must never be pasted into a chat or committed to the repository.

**Before you start**, you need:

- Admin access to `attackbackpack/Absurdly-Rational` on GitHub.
- A Cloudflare account. If you don't have one, create it free at
  [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
- A terminal with a local clone of this repository, and Node.js installed (the same
  requirement `npm run check` already has). You do **not** need Ruby, Jekyll, or a global
  install of `wrangler` — every command below uses `npx`, which downloads a temporary copy of
  `wrangler` the first time it runs.

Run every command below from the root of your local clone of the repository (the folder that
contains this `worker/` directory).

1. **Create the `editor` branch, if it doesn't already exist.** Open
   `attackbackpack/Absurdly-Rational` on GitHub, click the branch dropdown that currently shows
   `main`, type `editor` into the search box, and click **Create branch: editor from 'main'**.
   Every save made through the visual editor (and through Pages CMS) lands on this branch —
   nothing below will work without it. If the branch already exists, skip this step.
2. **Create the GitHub App.** GitHub → Settings → Developer settings → GitHub Apps → New GitHub
   App. Name it `Absurdly Rational Editor`. Homepage `https://absurdlyrational.com`. Uncheck
   **Webhook → Active**. Repository permissions: **Contents: Read and write**. Everything else
   stays `No access`. Under "Where can this GitHub App be installed?", choose **Only on this
   account**. Create it.
3. **Record the App ID** shown on the app's settings page.
4. **Generate a private key** on the same page. A `.pem` file downloads. This file is the
   credential — do not commit it, do not paste it into a chat, and delete the download once it
   is in the Worker secret (step 8).
5. **Install the app.** On the app's own settings page, click **Install App** in the left
   sidebar, then install it on `attackbackpack/Absurdly-Rational` only. After installing, the
   browser URL ends in `/installations/<number>` — record that number as the Installation ID.
6. **Log in to Cloudflare**, if this computer hasn't done so before:

   ```bash
   npx wrangler login
   ```

   This opens a browser tab to authorize `wrangler` against your Cloudflare account.
7. **Create the KV namespace:**

   ```bash
   npx wrangler kv namespace create RATE_LIMIT --config worker/wrangler.toml
   ```

   Copy the printed `id` into `worker/wrangler.toml`, replacing the placeholder on the `id =`
   line under `[[kv_namespaces]]`. Save the file, then commit and push it to `main` so the real
   ID isn't lost:

   ```bash
   git add worker/wrangler.toml
   git commit -m "chore: set the RATE_LIMIT KV namespace id"
   git push origin main
   ```

8. **Set the secrets**, one command each. Each prompts for the value; nothing is echoed to the
   shell history.

   ```bash
   npx wrangler secret put EDITOR_PASSWORD --config worker/wrangler.toml
   ```

   ```bash
   npx wrangler secret put SESSION_SECRET --config worker/wrangler.toml
   ```

   ```bash
   npx wrangler secret put GITHUB_APP_ID --config worker/wrangler.toml
   ```

   ```bash
   npx wrangler secret put GITHUB_INSTALLATION_ID --config worker/wrangler.toml
   ```

   ```bash
   npx wrangler secret put GITHUB_REPO --config worker/wrangler.toml
   ```

   ```bash
   npx wrangler secret put GITHUB_APP_PRIVATE_KEY --config worker/wrangler.toml
   ```

   `EDITOR_PASSWORD` should be a long passphrase you choose yourself — pick your own words; do
   not reuse a password from anywhere else. `SESSION_SECRET` should be random — generate it
   with:

   ```bash
   openssl rand -base64 32
   ```

   and paste the output as the secret value. `GITHUB_REPO` is `attackbackpack/Absurdly-Rational`.
   For `GITHUB_APP_PRIVATE_KEY`, open the downloaded `.pem` file in a text editor and paste its
   entire contents — the whole file, including its first and last header lines — as the secret
   value. Once this secret is set, delete the `.pem` file from Downloads; it should not remain on
   disk anywhere.
9. **Deploy:**

   ```bash
   npx wrangler deploy --config worker/wrangler.toml
   ```

   The command prints the Worker's URL, something like
   `https://absurdly-rational-editor-api.<your-subdomain>.workers.dev`.
10. **Point the editor at the Worker.** Open `editor/index.html` and replace the placeholder
    hostname in the `data-api` attribute on the `<body>` tag with the URL printed in step 9,
    then commit and push to `main`:

    ```bash
    git add editor/index.html
    git commit -m "chore: point the site editor at the deployed Worker"
    git push origin main
    ```

11. **Confirm the boundary.** Sign in at `https://absurdlyrational.com/editor/`, make a text
    edit, save, and verify on GitHub that the commit landed on `editor` and touched only
    `_data/site.json`.

## What the password protects — and what it doesn't

The editor password guards a draft branch (`editor`) of a repository that is already public on
GitHub. It is not a security boundary around the source code or around publishing. `main` stays
branch-protected and requires an owner-approved pull request merge to change the public site, so
even if the editor password leaked, whoever had it could only edit the draft — they could not
publish anything to `absurdlyrational.com` without the owner reviewing and merging the change,
exactly as with Pages CMS today.

## If the Worker is misconfigured

If any of the secrets above is missing or empty, every request to the Worker fails with
`500 Server misconfiguration.` and no further detail — the Worker logs which secret is missing to
its own Cloudflare console (`Workers & Pages` → the worker → **Logs**), but never sends the name
back to the browser. If sign-in or saving stops working after a deploy, check the Cloudflare
Worker logs before anything else.
