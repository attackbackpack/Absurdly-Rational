# Visual Site Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the site's non-technical editor a click-to-edit surface overlaid on the real rendered homepage, replacing a 770-line generic form UI for that page.

**Architecture:** A static editor shell served from `main` at `/editor/` loads the `editor` branch build of the homepage in a same-origin iframe. Templates carry `data-edit="site:home.hero.thesis"` attributes that map DOM nodes to JSON paths. Edits mutate an in-memory draft and the live iframe DOM; Save posts the draft to a Cloudflare Worker, which holds a GitHub App credential and commits to the `editor` branch under a hard-coded path allowlist. The existing preview, validation, review, and merge workflows are untouched.

**Tech Stack:** Jekyll/Liquid (existing), vanilla ES modules (no build step, no framework), Node's built-in `node:test` runner (no new test dependency), Cloudflare Workers + KV, GitHub Git Data API.

**Source spec:** `docs/superpowers/specs/2026-08-19-visual-site-editor-design.md`

## Global Constraints

- Node engine floor is `>=20.9` (`package.json`). CI uses Node 22. Use only APIs available in Node 20.9.
- **No new runtime or test dependencies.** `sharp` remains the only devDependency. Tests use `node --test`.
- All editor JavaScript is ES modules loaded directly by the browser. No bundler, no transpiler, no build step.
- Editable data lives only in `_data/*.json`. The editor never writes templates, CSS, or JavaScript.
- The Worker accepts writes **only** to branch `editor`, and **only** to paths matching `^_data/[a-z-]+\.json$` or `^assets/uploads/[A-Za-z0-9._-]+$`.
- Text editing is `contenteditable="plaintext-only"` and is reduced to `textContent` before entering the draft. `index.html:29` renders `{{ home.hero.thesis }}` unescaped; rich text would inject markup into the page.
- v1 edits `_data/site.json` key `home` only. `site.navigation`, `site.footer`, and `site.brand_image` are out of scope.
- Secrets (GitHub App private key, App ID, editor password, session secret) are set by the repository owner as Worker secrets. They are never committed, never placed in browser JavaScript, and never handled by an agent.
- Preview does not auto-reload after save. The shell reports success and offers a manual **Reload preview** button.
- The DOM/overlay layer is verified in a real browser, not by unit tests. All logic that can be pure is extracted into `editor/lib/*.js` and unit tested. Tasks state which verification applies.

## Deviations from the spec, decided during planning

Two, both simplifications. Carry them forward.

1. **`_includes/image.html` is not modified.** The spec listed it as an edit. It is not needed: every image's editable frame (`.home-signal`, `.door-art`) lives in `index.html` and exists in both the has-image and no-image branches. The editor finds the `<img>` by querying `img.image-object` inside the annotated frame.
2. **Path validation ships as a new script, not as an edit to `scripts/validate-content.js`.** The parser must be shared with the browser, so it lives in `editor/lib/paths.js` as an ES module. `scripts/validate-content.js` is CommonJS and cannot `require()` an ES module on the Node 20.9 floor. A separate `scripts/validate-edit-paths.mjs` imports the shared parser and runs alongside the existing validator via `npm run check`. This keeps one parser, and leaves the 361-line existing validator untouched.

3. **`home.formats[].url` is excluded from v1.** The spec's field inventory listed it. Those three URLs point at the site's own pages (`readings.html`, `podcasts.html`, `memes.html`); making them editable lets one mistyped value silently break a homepage door with no visible warning, and there is no reason for the editor to retarget internal navigation. `home.hero.cta_url` remains editable — it is a genuine call-to-action that may point off-site — and moves to the Page settings panel.

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `editor/lib/paths.js` | Parse `file:path` specs; get/set values in JSON by path. Shared browser + Node. Pure. |
| `editor/lib/paths.test.js` | Unit tests for the above. |
| `editor/lib/imagefit.js` | `fitClass()` / `focusClass()` mirroring `_includes/image.html`. Pure. |
| `editor/lib/imagefit.test.js` | Unit tests, including drift check against the Liquid include. |
| `editor/lib/draft.js` | In-memory draft: field edits, staged uploads, dirty tracking, save payload. Pure. |
| `editor/lib/draft.test.js` | Unit tests for the above. |
| `editor/lib/api.js` | Worker client: `login`, `loadContent`, `save`. Network only, no DOM. |
| `editor/lib/overlay.js` | Iframe scanning, hover outlines, text click-to-edit. DOM. |
| `editor/lib/panels.js` | Image popover and page-settings panel. DOM. |
| `editor/editor.js` | Wiring: auth screen → load → overlay → save. DOM. |
| `editor/editor.css` | Shell chrome and overlay styling. |
| `editor/index.html` | Shell page with `noindex`. |
| `scripts/validate-edit-paths.mjs` | Fails the build if any `data-edit` attribute does not resolve. |
| `scripts/validate-edit-paths.test.mjs` | Unit tests for the extraction logic. |
| `worker/src/worker.js` | Auth, GitHub App token, `GET`/`PUT /content`, allowlist. |
| `worker/src/worker.test.mjs` | Unit tests with mocked `fetch` and KV. |
| `worker/wrangler.toml` | Worker config. |
| `worker/SETUP.md` | Owner's click-by-click GitHub App + Worker deployment steps. |

**Modify:**

| Path | Change |
|---|---|
| `index.html` | Add `data-edit` / `data-edit-image` attributes. No logic change. |
| `_config.yml` | Exclude `docs`, `worker` from the Jekyll build. |
| `robots.txt` | `Disallow: /editor/`. |
| `package.json` | Add `test` and `validate:edit-paths` scripts; extend `check`. |
| `.github/workflows/validate-content.yml` | Run `npm run check`; add templates and `editor/**` to path filters. |
| `OWNER_CMS_SETUP.md` | Document the new editor alongside Pages CMS. |

---

### Task 1: Shared path parser

The single source of truth for turning `site:home.formats[key=readings].title` into a value lookup. Used by the browser editor and by the build-time validator, so it must be pure ES module code with no DOM and no `node:fs`.

**Files:**
- Create: `editor/lib/paths.js`
- Test: `editor/lib/paths.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseSpec(spec: string) -> { file: string, segments: Segment[] }` — throws `Error` on malformed input.
  - `Segment` is `{ kind: "key", name: string }` or `{ kind: "match", key: string, value: string | null }`. `value` is `null` when the source used a Liquid interpolation such as `[key={{ format.key }}]`, meaning "every member".
  - `getValue(data: object, segments: Segment[]) -> unknown` — throws `Error` if any segment does not resolve.
  - `setValue(data: object, segments: Segment[], value: unknown) -> void` — throws `Error` if the parent does not resolve. Never creates missing intermediate objects.
  - `collectMatches(data, segments) -> unknown[]` — resolves wildcard (`value === null`) match segments across every array member. Used by the validator.

- [ ] **Step 1: Write the failing tests**

Create `editor/lib/paths.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec, getValue, setValue, collectMatches } from "./paths.js";

const data = {
  home: {
    hero: { thesis: "Reality, with better footnotes." },
    formats: [
      { key: "readings", title: "Selected Readings" },
      { key: "podcasts", title: "Podcasts" }
    ]
  }
};

test("parseSpec splits the data file from the path", () => {
  assert.deepEqual(parseSpec("site:home.hero.thesis"), {
    file: "site",
    segments: [
      { kind: "key", name: "home" },
      { kind: "key", name: "hero" },
      { kind: "key", name: "thesis" }
    ]
  });
});

test("parseSpec reads a literal array match", () => {
  const { segments } = parseSpec("site:home.formats[key=readings].title");
  assert.deepEqual(segments[2], { kind: "match", key: "key", value: "readings" });
});

test("parseSpec treats a Liquid interpolation as a wildcard match", () => {
  const { segments } = parseSpec("site:home.formats[key={{ format.key }}].title");
  assert.deepEqual(segments[2], { kind: "match", key: "key", value: null });
});

test("parseSpec rejects a spec with no file prefix", () => {
  assert.throws(() => parseSpec("home.hero.thesis"), /file prefix/);
});

test("parseSpec rejects an empty path", () => {
  assert.throws(() => parseSpec("site:"), /empty path/);
});

test("getValue reads a nested key", () => {
  const { segments } = parseSpec("site:home.hero.thesis");
  assert.equal(getValue(data, segments), "Reality, with better footnotes.");
});

test("getValue reads through a literal array match", () => {
  const { segments } = parseSpec("site:home.formats[key=podcasts].title");
  assert.equal(getValue(data, segments), "Podcasts");
});

test("getValue throws on a missing key", () => {
  const { segments } = parseSpec("site:home.hero.missing");
  assert.throws(() => getValue(data, segments), /home\.hero\.missing/);
});

test("getValue throws when no array member matches", () => {
  const { segments } = parseSpec("site:home.formats[key=nope].title");
  assert.throws(() => getValue(data, segments), /key=nope/);
});

test("setValue writes through a literal array match without mutating siblings", () => {
  const copy = structuredClone(data);
  const { segments } = parseSpec("site:home.formats[key=readings].title");
  setValue(copy, segments, "Essays");
  assert.equal(copy.home.formats[0].title, "Essays");
  assert.equal(copy.home.formats[1].title, "Podcasts");
});

test("setValue refuses to create a missing parent", () => {
  const copy = structuredClone(data);
  const { segments } = parseSpec("site:home.nothing.here");
  assert.throws(() => setValue(copy, segments, "x"), /home\.nothing/);
});

test("collectMatches returns every member for a wildcard match", () => {
  const { segments } = parseSpec("site:home.formats[key={{ format.key }}].title");
  assert.deepEqual(collectMatches(data, segments), ["Selected Readings", "Podcasts"]);
});

test("collectMatches throws when one member lacks the field", () => {
  const broken = structuredClone(data);
  delete broken.home.formats[1].title;
  const { segments } = parseSpec("site:home.formats[key={{ format.key }}].title");
  assert.throws(() => collectMatches(broken, segments), /title/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test editor/lib/paths.test.js`
Expected: FAIL — `Cannot find module` for `./paths.js`.

- [ ] **Step 3: Write the implementation**

Create `editor/lib/paths.js`:

```javascript
const SEGMENT = /^([A-Za-z0-9_]+)(?:\[([A-Za-z0-9_]+)=([^\]]*)\])?$/;
const LIQUID = /\{\{[^}]*\}\}/;

export function parseSpec(spec) {
  const colon = String(spec).indexOf(":");
  if (colon < 1) {
    throw new Error(`"${spec}": missing a data file prefix such as "site:"`);
  }
  const file = spec.slice(0, colon);
  const rest = spec.slice(colon + 1).trim();
  if (!rest) {
    throw new Error(`"${spec}": empty path after the file prefix`);
  }

  const segments = [];
  for (const part of rest.split(".")) {
    const match = SEGMENT.exec(part);
    if (!match) {
      throw new Error(`"${spec}": cannot parse path segment "${part}"`);
    }
    const [, name, matchKey, matchValue] = match;
    segments.push({ kind: "key", name });
    if (matchKey !== undefined) {
      segments.push({
        kind: "match",
        key: matchKey,
        value: LIQUID.test(matchValue) ? null : matchValue
      });
    }
  }
  return { file, segments };
}

function describe(segments, upto) {
  return segments
    .slice(0, upto + 1)
    .map((s) => (s.kind === "key" ? s.name : `[${s.key}=${s.value ?? "*"}]`))
    .join(".");
}

function walk(data, segments, stopBefore) {
  let cursor = data;
  const limit = stopBefore === undefined ? segments.length : stopBefore;
  for (let i = 0; i < limit; i += 1) {
    const segment = segments[i];
    if (cursor === null || typeof cursor !== "object") {
      throw new Error(`${describe(segments, i)}: parent is not an object`);
    }
    if (segment.kind === "key") {
      if (!(segment.name in cursor)) {
        throw new Error(`${describe(segments, i)}: no such key`);
      }
      cursor = cursor[segment.name];
    } else {
      if (!Array.isArray(cursor)) {
        throw new Error(`${describe(segments, i)}: expected an array`);
      }
      const found = cursor.find((item) => item && item[segment.key] === segment.value);
      if (found === undefined) {
        throw new Error(`${describe(segments, i)}: no member with ${segment.key}=${segment.value}`);
      }
      cursor = found;
    }
  }
  return cursor;
}

export function getValue(data, segments) {
  return walk(data, segments);
}

export function setValue(data, segments, value) {
  const last = segments[segments.length - 1];
  if (!last || last.kind !== "key") {
    throw new Error("setValue requires a path ending in a key");
  }
  const parent = walk(data, segments, segments.length - 1);
  if (parent === null || typeof parent !== "object") {
    throw new Error(`${describe(segments, segments.length - 2)}: parent is not an object`);
  }
  parent[last.name] = value;
}

export function collectMatches(data, segments) {
  const wildcardAt = segments.findIndex((s) => s.kind === "match" && s.value === null);
  if (wildcardAt === -1) {
    return [getValue(data, segments)];
  }
  const array = walk(data, segments, wildcardAt);
  if (!Array.isArray(array)) {
    throw new Error(`${describe(segments, wildcardAt)}: expected an array`);
  }
  const tail = segments.slice(wildcardAt + 1);
  return array.map((member, index) => {
    try {
      return getValue(member, tail);
    } catch (error) {
      throw new Error(`${describe(segments, wildcardAt)}[${index}]: ${error.message}`);
    }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test editor/lib/paths.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Add the test script and commit**

In `package.json`, add to `scripts`:

```json
"test": "node --test \"editor/lib/*.test.js\" \"scripts/*.test.mjs\" \"worker/src/*.test.mjs\""
```

Run: `npm test`
Expected: PASS. (`node --test` reports no error for glob patterns that match nothing yet.)

```bash
git add editor/lib/paths.js editor/lib/paths.test.js package.json
git commit -m "feat(editor): shared data-edit path parser"
```

---

### Task 2: Annotate the homepage and enforce the paths

Adds the `data-edit` attributes and, in the same task, the validator that proves every one of them resolves. These ship together because an attribute set with no validator is exactly the drift the spec set out to prevent.

**Files:**
- Create: `scripts/validate-edit-paths.mjs`, `scripts/validate-edit-paths.test.mjs`
- Modify: `index.html`, `package.json`, `_config.yml`, `.github/workflows/validate-content.yml`

**Interfaces:**
- Consumes: `parseSpec`, `collectMatches` from `editor/lib/paths.js` (Task 1).
- Produces: `extractSpecs(html: string) -> { attr: string, spec: string }[]`, exported from `scripts/validate-edit-paths.mjs` for testing. The script runs its check when executed directly.

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-edit-paths.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSpecs } from "./validate-edit-paths.mjs";

test("extractSpecs finds text and image attributes", () => {
  const html = `
    <p data-edit="site:home.hero.thesis">x</p>
    <div data-edit-image="site:home.hero.image"></div>
  `;
  assert.deepEqual(extractSpecs(html), [
    { attr: "data-edit", spec: "site:home.hero.thesis" },
    { attr: "data-edit-image", spec: "site:home.hero.image" }
  ]);
});

test("extractSpecs keeps Liquid interpolation intact", () => {
  const html = `<h3 data-edit="site:home.formats[key={{ format.key }}].title">x</h3>`;
  assert.deepEqual(extractSpecs(html), [
    { attr: "data-edit", spec: "site:home.formats[key={{ format.key }}].title" }
  ]);
});

test("extractSpecs does not confuse data-edit-image for data-edit", () => {
  const html = `<div data-edit-image="site:home.hero.image"></div>`;
  assert.equal(extractSpecs(html).length, 1);
  assert.equal(extractSpecs(html)[0].attr, "data-edit-image");
});

test("extractSpecs returns an empty list for unannotated markup", () => {
  assert.deepEqual(extractSpecs("<p>nothing here</p>"), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/validate-edit-paths.test.mjs`
Expected: FAIL — `Cannot find module './validate-edit-paths.mjs'`.

- [ ] **Step 3: Write the validator**

Create `scripts/validate-edit-paths.mjs`:

```javascript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSpec, collectMatches } from "../editor/lib/paths.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templates = ["index.html"];
const ATTRIBUTE = /\bdata-edit(-image)?="([^"]+)"/g;

export function extractSpecs(html) {
  const found = [];
  for (const match of html.matchAll(ATTRIBUTE)) {
    found.push({ attr: match[1] ? "data-edit-image" : "data-edit", spec: match[2] });
  }
  return found;
}

function run() {
  const errors = [];
  const cache = new Map();

  const readData = (file) => {
    if (!cache.has(file)) {
      const dataPath = path.join(root, "_data", `${file}.json`);
      cache.set(file, JSON.parse(fs.readFileSync(dataPath, "utf8")));
    }
    return cache.get(file);
  };

  let checked = 0;
  for (const template of templates) {
    const html = fs.readFileSync(path.join(root, template), "utf8");
    for (const { attr, spec } of extractSpecs(html)) {
      checked += 1;
      try {
        const { file, segments } = parseSpec(spec);
        const values = collectMatches(readData(file), segments);
        if (attr === "data-edit") {
          values.forEach((value) => {
            if (typeof value !== "string") {
              throw new Error("data-edit must point at a string");
            }
          });
        } else {
          values.forEach((value) => {
            if (value === null || typeof value !== "object" || Array.isArray(value)) {
              throw new Error("data-edit-image must point at an image object");
            }
          });
        }
      } catch (error) {
        errors.push(`${template}: ${attr}="${spec}" — ${error.message}`);
      }
    }
  }

  if (errors.length) {
    console.error(`Edit-path validation failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Edit-path validation passed: ${checked} editable paths resolve against _data.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/validate-edit-paths.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Annotate `index.html`**

Apply exactly these edits. Attributes are added; nothing else changes.

Hero image frame — on the `.home-signal` div, which exists in both the image and fallback branches:

```html
<div class="home-signal{% if hero_image_path != empty %} home-signal--image{% endif %}" data-edit-image="site:home.hero.image"{% if hero_image_path == empty %} aria-hidden="true"{% endif %}>
```

Hero copy block:

```html
<h1><span data-edit="site:home.hero.title_line_one">{{ home.hero.title_line_one | escape }}</span><br><span data-edit="site:home.hero.title_line_two">{{ home.hero.title_line_two | escape }}</span></h1>
<p class="hero-thesis" data-edit="site:home.hero.thesis">{{ home.hero.thesis }}</p>
<p class="hero-description" data-edit="site:home.hero.description">{{ home.hero.description }}</p>
<a class="button button--light" href="{{ home.hero.cta_url }}"><span data-edit="site:home.hero.cta_label">{{ home.hero.cta_label }}</span><span class="link-arrow" aria-hidden="true"></span></a>
```

The `<h1>` gains two `<span>` wrappers because the two lines are separate JSON fields either side of a `<br>`; without wrappers there is no element to make editable. The CTA label is likewise wrapped so the arrow `<span>` stays outside the editable region.

Formats intro:

```html
<h2 id="format-title" data-edit="site:home.formats_intro.title">{{ home.formats_intro.title }}</h2>
<p data-edit="site:home.formats_intro.description">{{ home.formats_intro.description }}</p>
```

Format doors — inside the `{% for format in home.formats %}` loop:

```html
<span class="door-art door-art--{{ format_class }}{% if door_image_path != empty %} door-art--image{% endif %}" data-edit-image="site:home.formats[key={{ format.key }}].image" aria-hidden="true">
```

```html
<span class="door-copy">
  <h3 data-edit="site:home.formats[key={{ format.key }}].title">{{ format.title }}</h3>
  <p data-edit="site:home.formats[key={{ format.key }}].description">{{ format.description }}</p>
  <span class="door-meta"><span data-edit="site:home.formats[key={{ format.key }}].meta">{{ format.meta }}</span> <span class="link-arrow" aria-hidden="true"></span></span>
</span>
```

Context section:

```html
<h2 id="context-title" data-edit="site:home.context.title">{{ home.context.title }}</h2>
<p data-edit="site:home.context.description">{{ home.context.description }}</p>
```

```html
<p data-edit="site:home.context.aside">{{ home.context.aside }}</p>
<a class="text-link" href="{{ site.data.site.author.linkedin }}" target="_blank" rel="noopener noreferrer"><span data-edit="site:home.context.contact_label">{{ home.context.contact_label }}</span><span class="link-arrow" aria-hidden="true"></span></a>
```

The CTA anchor's `href` is **not** annotated. `home.hero.cta_url` is edited from the Page settings panel in Task 10, because a URL has no visual representation to click and an in-page href editor would be a third interaction pattern for one field.

- [ ] **Step 6: Run the validator and confirm it passes**

Run: `node scripts/validate-edit-paths.mjs`
Expected: `Edit-path validation passed: 16 editable paths resolve against _data.`

- [ ] **Step 7: Prove the validator actually catches a bad path**

Temporarily change one attribute in `index.html` to `data-edit="site:home.hero.thesisss"`.

Run: `node scripts/validate-edit-paths.mjs`
Expected: exit code 1 and `- index.html: data-edit="site:home.hero.thesisss" — home.hero.thesisss: no such key`

Revert the temporary change. Re-run and confirm it passes again.

- [ ] **Step 8: Wire it into npm and CI**

In `package.json` `scripts`:

```json
"validate:edit-paths": "node scripts/validate-edit-paths.mjs",
"check": "npm run validate:content && npm run validate:edit-paths && npm test"
```

In `.github/workflows/validate-content.yml`, change the run step from `npm run validate:content` to `npm run check`, and add these entries to **both** the `push.paths` and `pull_request.paths` lists:

```yaml
      - "index.html"
      - "_includes/**"
      - "editor/**"
```

In `_config.yml`, add to `exclude` so the plan and spec markdown are not published as pages and the Worker source is not copied into the site:

```yaml
  - docs
  - worker
```

- [ ] **Step 9: Verify the whole check passes and commit**

Run: `npm run check`
Expected: content validation passes, edit-path validation passes, tests pass.

```bash
git add index.html scripts/validate-edit-paths.mjs scripts/validate-edit-paths.test.mjs package.json _config.yml .github/workflows/validate-content.yml
git commit -m "feat(editor): annotate homepage with data-edit paths and enforce them in CI"
```

---

### Task 3: Worker skeleton and password auth

**Files:**
- Create: `worker/src/worker.js`, `worker/src/worker.test.mjs`, `worker/wrangler.toml`

**Interfaces:**
- Consumes: nothing.
- Produces: `export default { fetch(request, env) }`. Env bindings: `EDITOR_PASSWORD`, `SESSION_SECRET`, `ALLOWED_ORIGIN` (vars/secrets) and `RATE_LIMIT` (KV namespace). Also exports `signSession(secret, expiresAt)` and `verifySession(secret, token)` for reuse in later tasks.
- Session token format: `<expiryEpochSeconds>.<base64url HMAC-SHA256 of the expiry string>`.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/worker.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { signSession, verifySession } from "./worker.js";

function makeEnv(overrides = {}) {
  const store = new Map();
  return {
    EDITOR_PASSWORD: "correct-horse-battery-staple",
    SESSION_SECRET: "session-secret-value",
    ALLOWED_ORIGIN: "https://absurdlyrational.com",
    RATE_LIMIT: {
      async get(key) {
        return store.has(key) ? store.get(key) : null;
      },
      async put(key, value) {
        store.set(key, value);
      }
    },
    ...overrides
  };
}

function authRequest(password, ip = "203.0.113.1") {
  return new Request("https://api.example.com/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ password })
  });
}

test("a correct password returns a session token", async () => {
  const response = await worker.fetch(authRequest("correct-horse-battery-staple"), makeEnv());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.token, "string");
});

test("a wrong password returns 401 and no token", async () => {
  const response = await worker.fetch(authRequest("wrong"), makeEnv());
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.token, undefined);
});

test("the eleventh failed attempt from one IP is rate limited", async () => {
  const env = makeEnv();
  for (let i = 0; i < 10; i += 1) {
    await worker.fetch(authRequest("wrong"), env);
  }
  const response = await worker.fetch(authRequest("wrong"), env);
  assert.equal(response.status, 429);
});

test("rate limiting is tracked per IP", async () => {
  const env = makeEnv();
  for (let i = 0; i < 10; i += 1) {
    await worker.fetch(authRequest("wrong", "203.0.113.1"), env);
  }
  const response = await worker.fetch(authRequest("correct-horse-battery-staple", "198.51.100.7"), env);
  assert.equal(response.status, 200);
});

test("a signed session verifies and a tampered one does not", async () => {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const token = await signSession("session-secret-value", expiry);
  assert.equal(await verifySession("session-secret-value", token), true);
  assert.equal(await verifySession("session-secret-value", `${expiry + 1}.${token.split(".")[1]}`), false);
  assert.equal(await verifySession("different-secret", token), false);
});

test("an expired session does not verify", async () => {
  const expiry = Math.floor(Date.now() / 1000) - 1;
  const token = await signSession("session-secret-value", expiry);
  assert.equal(await verifySession("session-secret-value", token), false);
});

test("a preflight request echoes the allowed origin only", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.com/auth", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" }
    }),
    makeEnv()
  );
  assert.notEqual(response.headers.get("access-control-allow-origin"), "https://evil.example");
});

test("an unknown route returns 404", async () => {
  const response = await worker.fetch(new Request("https://api.example.com/nope"), makeEnv());
  assert.equal(response.status, 404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test worker/src/worker.test.mjs`
Expected: FAIL — `Cannot find module './worker.js'`.

- [ ] **Step 3: Write the Worker**

Create `worker/src/worker.js`:

```javascript
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_FAILED_ATTEMPTS = 10;
const RATE_WINDOW_SECONDS = 60 * 60;
const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

export async function signSession(secret, expiresAt) {
  return `${expiresAt}.${base64url(await hmac(secret, String(expiresAt)))}`;
}

export async function verifySession(secret, token) {
  if (typeof token !== "string") return false;
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expected = base64url(await hmac(secret, String(expiresAt)));
  return timingSafeEqual(expected, token.slice(separator + 1));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

async function passwordMatches(secret, candidate) {
  if (typeof candidate !== "string") return false;
  const [expected, actual] = await Promise.all([
    hmac(secret, "password-check"),
    hmac(candidate, "password-check")
  ]);
  return timingSafeEqual(base64url(expected), base64url(actual));
}

function corsHeaders(env, request) {
  const origin = request.headers.get("origin");
  const headers = {
    "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    vary: "origin"
  };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function json(env, request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(env, request) }
  });
}

async function handleAuth(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rateKey = `auth-failures:${ip}`;
  const failures = Number((await env.RATE_LIMIT.get(rateKey)) || 0);
  if (failures >= MAX_FAILED_ATTEMPTS) {
    return json(env, request, 429, { error: "Too many attempts. Try again later." });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  if (!(await passwordMatches(env.EDITOR_PASSWORD, payload.password))) {
    await env.RATE_LIMIT.put(rateKey, String(failures + 1), {
      expirationTtl: RATE_WINDOW_SECONDS
    });
    return json(env, request, 401, { error: "Incorrect password." });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return json(env, request, 200, {
    token: await signSession(env.SESSION_SECRET, expiresAt),
    expiresAt
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (url.pathname === "/auth" && request.method === "POST") {
      return handleAuth(request, env);
    }
    return json(env, request, 404, { error: "Not found" });
  }
};
```

Create `worker/wrangler.toml`:

```toml
name = "absurdly-rational-editor-api"
main = "src/worker.js"
compatibility_date = "2026-08-19"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "replace-with-the-id-printed-by-wrangler-kv-namespace-create"

[vars]
ALLOWED_ORIGIN = "https://absurdlyrational.com"
```

The `id` above is filled in by the repository owner during deployment; `worker/SETUP.md` in Task 12 gives the exact command that prints it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test worker/src/worker.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/worker.js worker/src/worker.test.mjs worker/wrangler.toml
git commit -m "feat(worker): password auth with signed sessions and per-IP rate limiting"
```

---

### Task 4: Worker reads content from the editor branch

**Files:**
- Modify: `worker/src/worker.js`, `worker/src/worker.test.mjs`

**Interfaces:**
- Consumes: `verifySession` (Task 3).
- Produces: `GET /content` returning `{ site: object, baseCommitSha: string }`. Requires `Authorization: Bearer <token>`. Also produces the internal `installationToken(env)` helper used by Task 5.

- [ ] **Step 1: Write the failing tests**

Append to `worker/src/worker.test.mjs`:

```javascript
import { mock } from "node:test";

const PKCS8_TEST_KEY = "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBg\n-----END PRIVATE KEY-----";

function githubEnv(overrides = {}) {
  return makeEnv({
    GITHUB_APP_ID: "123456",
    GITHUB_APP_PRIVATE_KEY: PKCS8_TEST_KEY,
    GITHUB_INSTALLATION_ID: "7891011",
    GITHUB_REPO: "attackbackpack/Absurdly-Rational",
    ...overrides
  });
}

async function bearer(env) {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  return `Bearer ${await signSession(env.SESSION_SECRET, expiry)}`;
}

test("GET /content without a token returns 401", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.com/content"),
    githubEnv()
  );
  assert.equal(response.status, 401);
});

test("GET /content returns site.json and the branch head sha", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const siteJson = JSON.stringify({ home: { hero: { thesis: "hi" } } });
  mock.method(globalThis, "fetch", async (input) => {
    const url = String(input.url ?? input);
    if (url.includes("/git/ref/heads/editor")) {
      return new Response(JSON.stringify({ object: { sha: "abc123" } }), { status: 200 });
    }
    if (url.includes("/contents/_data/site.json")) {
      return new Response(
        JSON.stringify({ content: btoa(siteJson), encoding: "base64" }),
        { status: 200 }
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  });

  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      headers: { authorization: await bearer(env) }
    }),
    env
  );
  mock.restoreAll();

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.baseCommitSha, "abc123");
  assert.equal(body.site.home.hero.thesis, "hi");
});

test("GET /content surfaces a GitHub failure as 502", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mock.method(globalThis, "fetch", async () => new Response("boom", { status: 500 }));
  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      headers: { authorization: await bearer(env) }
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 502);
});
```

The `env.__installationToken` escape hatch lets tests bypass RS256 JWT signing, which needs a real PKCS#8 key. The token-minting path itself is exercised manually against GitHub in Task 12.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test worker/src/worker.test.mjs`
Expected: the three new tests FAIL with 404 (route not implemented).

- [ ] **Step 3: Implement GitHub access**

Add to `worker/src/worker.js`, above the `export default` block:

```javascript
const GITHUB_API = "https://api.github.com";
const BRANCH = "editor";
const USER_AGENT = "absurdly-rational-editor";

function pemToArrayBuffer(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function appJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(
    encoder.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(`${header}.${claims}`)
  );
  return `${header}.${claims}.${base64url(signature)}`;
}

let cachedToken = { value: null, expiresAt: 0 };

async function installationToken(env) {
  if (env.__installationToken) return env.__installationToken;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.value && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const response = await fetch(
    `${GITHUB_API}/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await appJwt(env)}`,
        accept: "application/vnd.github+json",
        "user-agent": USER_AGENT
      }
    }
  );
  if (!response.ok) throw new Error(`installation token request failed: ${response.status}`);
  const body = await response.json();
  cachedToken = { value: body.token, expiresAt: now + 55 * 60 };
  return cachedToken.value;
}

async function github(env, pathname, init = {}) {
  const token = await installationToken(env);
  const response = await fetch(`${GITHUB_API}/repos/${env.GITHUB_REPO}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": USER_AGENT,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub ${init.method || "GET"} ${pathname} failed: ${response.status}`);
  }
  return response.json();
}

async function authorize(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return verifySession(env.SESSION_SECRET, token);
}

async function handleGetContent(request, env) {
  if (!(await authorize(request, env))) {
    return json(env, request, 401, { error: "Sign in again." });
  }
  try {
    const ref = await github(env, `/git/ref/heads/${BRANCH}`);
    const file = await github(env, `/contents/_data/site.json?ref=${BRANCH}`);
    const decoded = decodeURIComponent(
      Array.from(atob(file.content.replace(/\n/g, "")))
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("")
    );
    return json(env, request, 200, {
      site: JSON.parse(decoded),
      baseCommitSha: ref.object.sha
    });
  } catch (error) {
    return json(env, request, 502, { error: `Could not read the site content. ${error.message}` });
  }
}
```

The `decodeURIComponent` dance is required because `atob` yields Latin-1 bytes and `site.json` contains non-ASCII characters (the copy uses typographic apostrophes).

Add the route inside `fetch`, before the 404:

```javascript
    if (url.pathname === "/content" && request.method === "GET") {
      return handleGetContent(request, env);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test worker/src/worker.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/worker.js worker/src/worker.test.mjs
git commit -m "feat(worker): read site.json and branch head from the editor branch"
```

---

### Task 5: Worker commits changes under a path allowlist

The security boundary. The allowlist tests matter more than the happy path.

**Files:**
- Modify: `worker/src/worker.js`, `worker/src/worker.test.mjs`

**Interfaces:**
- Consumes: `github`, `installationToken`, `authorize` (Task 4).
- Produces: `PUT /content`, body `{ files: [{ path, contentBase64 }], baseCommitSha, message }`. Returns `200 { commitSha }`, `409 { error }` on a stale base, `400 { error }` on a disallowed path, `401` without a session.
- Also produces the exported `isAllowedPath(path) -> boolean` for direct testing.

- [ ] **Step 1: Write the failing tests**

Append to `worker/src/worker.test.mjs`:

```javascript
import { isAllowedPath } from "./worker.js";

test("the allowlist accepts data files and uploads", () => {
  assert.equal(isAllowedPath("_data/site.json"), true);
  assert.equal(isAllowedPath("_data/readings.json"), true);
  assert.equal(isAllowedPath("assets/uploads/rooster-2.png"), true);
});

test("the allowlist rejects templates, workflows, and traversal", () => {
  assert.equal(isAllowedPath("index.html"), false);
  assert.equal(isAllowedPath("_includes/head.html"), false);
  assert.equal(isAllowedPath(".github/workflows/deploy-pages-with-draft-preview.yml"), false);
  assert.equal(isAllowedPath("_data/../index.html"), false);
  assert.equal(isAllowedPath("assets/uploads/../../main.js"), false);
  assert.equal(isAllowedPath("/_data/site.json"), false);
  assert.equal(isAllowedPath("_data/site.json.bak"), false);
  assert.equal(isAllowedPath("_data/Site.json"), false);
});

function mockCommitApi({ headSha = "abc123" } = {}) {
  const calls = [];
  mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = String(input.url ?? input);
    calls.push({ url, method: init.method || "GET", body: init.body });
    if (url.includes("/git/ref/heads")) {
      if ((init.method || "GET") === "GET") {
        return new Response(JSON.stringify({ object: { sha: headSha } }), { status: 200 });
      }
      return new Response(JSON.stringify({ object: { sha: "newcommit" } }), { status: 200 });
    }
    if (url.endsWith("/git/blobs")) {
      return new Response(JSON.stringify({ sha: "blobsha" }), { status: 200 });
    }
    if (url.includes("/git/commits/")) {
      return new Response(JSON.stringify({ tree: { sha: "treesha" } }), { status: 200 });
    }
    if (url.endsWith("/git/trees")) {
      return new Response(JSON.stringify({ sha: "newtreesha" }), { status: 200 });
    }
    if (url.endsWith("/git/commits")) {
      return new Response(JSON.stringify({ sha: "newcommit" }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  return calls;
}

async function putRequest(env, body) {
  return new Request("https://api.example.com/content", {
    method: "PUT",
    headers: { authorization: await bearer(env), "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("PUT /content writes an allowed file and returns the new commit sha", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mockCommitApi();
  const response = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "_data/site.json", contentBase64: btoa("{}") }],
      baseCommitSha: "abc123",
      message: "edit homepage"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).commitSha, "newcommit");
});

test("PUT /content rejects a disallowed path before calling GitHub", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "index.html", contentBase64: btoa("<h1>hi</h1>") }],
      baseCommitSha: "abc123",
      message: "sneaky"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("PUT /content rejects the whole batch if any one path is disallowed", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    await putRequest(env, {
      files: [
        { path: "_data/site.json", contentBase64: btoa("{}") },
        { path: "main.js", contentBase64: btoa("evil()") }
      ],
      baseCommitSha: "abc123",
      message: "mixed"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("PUT /content returns 409 when the base commit is stale", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mockCommitApi({ headSha: "somethingelse" });
  const response = await worker.fetch(
    await putRequest(env, {
      files: [{ path: "_data/site.json", contentBase64: btoa("{}") }],
      baseCommitSha: "abc123",
      message: "stale"
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 409);
});

test("PUT /content without a session returns 401 and calls no GitHub API", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  const calls = mockCommitApi();
  const response = await worker.fetch(
    new Request("https://api.example.com/content", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [], baseCommitSha: "abc123", message: "x" })
    }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test worker/src/worker.test.mjs`
Expected: the new tests FAIL — `isAllowedPath` is not exported and `PUT /content` returns 404.

- [ ] **Step 3: Implement the commit path**

Add to `worker/src/worker.js`:

```javascript
const ALLOWED_PATHS = [/^_data\/[a-z-]+\.json$/, /^assets\/uploads\/[A-Za-z0-9._-]+$/];

export function isAllowedPath(candidate) {
  if (typeof candidate !== "string" || candidate.includes("..")) return false;
  return ALLOWED_PATHS.some((pattern) => pattern.test(candidate));
}

async function handlePutContent(request, env) {
  if (!(await authorize(request, env))) {
    return json(env, request, 401, { error: "Sign in again." });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(env, request, 400, { error: "Malformed request body." });
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  if (files.length === 0) {
    return json(env, request, 400, { error: "No files to save." });
  }
  const rejected = files.filter((file) => !isAllowedPath(file.path));
  if (rejected.length) {
    return json(env, request, 400, {
      error: `This editor may not write: ${rejected.map((f) => f.path).join(", ")}`
    });
  }

  try {
    const ref = await github(env, `/git/ref/heads/${BRANCH}`);
    if (ref.object.sha !== payload.baseCommitSha) {
      return json(env, request, 409, {
        error: "Someone else changed the draft while you were editing. Reload before saving."
      });
    }

    const blobs = [];
    for (const file of files) {
      const blob = await github(env, "/git/blobs", {
        method: "POST",
        body: JSON.stringify({ content: file.contentBase64, encoding: "base64" })
      });
      blobs.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }

    const baseCommit = await github(env, `/git/commits/${ref.object.sha}`);
    const tree = await github(env, "/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: blobs })
    });
    const commit = await github(env, "/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message: String(payload.message || "content(update): site editor"),
        tree: tree.sha,
        parents: [ref.object.sha]
      })
    });
    await github(env, `/git/refs/heads/${BRANCH}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha })
    });

    return json(env, request, 200, { commitSha: commit.sha });
  } catch (error) {
    return json(env, request, 502, { error: `Could not save. ${error.message}` });
  }
}
```

Add the route inside `fetch`, before the 404:

```javascript
    if (url.pathname === "/content" && request.method === "PUT") {
      return handlePutContent(request, env);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test worker/src/worker.test.mjs`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/worker.js worker/src/worker.test.mjs
git commit -m "feat(worker): atomic commits to the editor branch under a path allowlist"
```

---

### Task 6: Image class mapping

Small, but it is duplicated logic against `_includes/image.html`, so it gets a drift test.

**Files:**
- Create: `editor/lib/imagefit.js`, `editor/lib/imagefit.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `FITS: string[]`, `FOCUSES: string[]`, `fitClass(fit) -> string`, `focusClass(focus) -> string`. Unknown or missing values fall back to `image-fit-cover` and `image-focus-center`, matching the Liquid defaults.

- [ ] **Step 1: Write the failing tests**

Create `editor/lib/imagefit.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FITS, FOCUSES, fitClass, focusClass } from "./imagefit.js";

test("known values map to their classes", () => {
  assert.equal(fitClass("contain"), "image-fit-contain");
  assert.equal(fitClass("cover"), "image-fit-cover");
  assert.equal(focusClass("top-left"), "image-focus-top-left");
  assert.equal(focusClass("center"), "image-focus-center");
});

test("unknown and missing values fall back to the Liquid defaults", () => {
  assert.equal(fitClass("wobble"), "image-fit-cover");
  assert.equal(fitClass(undefined), "image-fit-cover");
  assert.equal(focusClass("wobble"), "image-focus-center");
  assert.equal(focusClass(undefined), "image-focus-center");
});

test("the value sets match _includes/image.html exactly", () => {
  const liquid = fs.readFileSync(new URL("../../_includes/image.html", import.meta.url), "utf8");
  const whenValues = [...liquid.matchAll(/\{%\s*when\s+"([^"]+)"\s*%\}\{%\s*assign\s+(fit|focus)_class/g)];
  const liquidFits = whenValues.filter((m) => m[2] === "fit").map((m) => m[1]).sort();
  const liquidFocuses = whenValues.filter((m) => m[2] === "focus").map((m) => m[1]).sort();
  assert.deepEqual([...FITS].sort(), liquidFits);
  assert.deepEqual([...FOCUSES].sort(), liquidFocuses);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test editor/lib/imagefit.test.js`
Expected: FAIL — `Cannot find module './imagefit.js'`.

- [ ] **Step 3: Write the implementation**

Create `editor/lib/imagefit.js`:

```javascript
export const FITS = ["cover", "contain"];

export const FOCUSES = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
];

export function fitClass(fit) {
  return FITS.includes(fit) ? `image-fit-${fit}` : "image-fit-cover";
}

export function focusClass(focus) {
  return FOCUSES.includes(focus) ? `image-focus-${focus}` : "image-focus-center";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test editor/lib/imagefit.test.js`
Expected: PASS, 3 tests. If the drift test fails, the sets in `imagefit.js` are wrong — fix them to match the Liquid, not the other way round.

- [ ] **Step 5: Commit**

```bash
git add editor/lib/imagefit.js editor/lib/imagefit.test.js
git commit -m "feat(editor): image fit and focus class mapping with drift test"
```

---

### Task 7: Draft state

All the save-correctness logic, kept out of the DOM so it can be tested.

**Files:**
- Create: `editor/lib/draft.js`, `editor/lib/draft.test.js`

**Interfaces:**
- Consumes: `parseSpec`, `getValue`, `setValue` (Task 1).
- Produces: `createDraft(site, baseCommitSha) -> Draft` with:
  - `read(spec) -> unknown`
  - `write(spec, value) -> void`
  - `stageUpload(fileName, bytesBase64) -> string` — returns the repository path it will be committed to (`assets/uploads/<safeName>`), and records it.
  - `isDirty() -> boolean`
  - `baseCommitSha -> string`
  - `buildPayload(message) -> { files, baseCommitSha, message }` — `files` contains `_data/site.json` only when a field changed, plus one entry per staged upload.

- [ ] **Step 1: Write the failing tests**

Create `editor/lib/draft.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDraft, safeUploadName } from "./draft.js";

const site = () => ({
  home: {
    hero: { thesis: "old", image: { path: "", alt: "", fit: "contain", focus: "center" } },
    formats: [{ key: "readings", title: "Selected Readings" }]
  }
});

test("a fresh draft is not dirty", () => {
  assert.equal(createDraft(site(), "abc").isDirty(), false);
});

test("read returns the current value", () => {
  assert.equal(createDraft(site(), "abc").read("site:home.hero.thesis"), "old");
});

test("write marks the draft dirty and read reflects it", () => {
  const draft = createDraft(site(), "abc");
  draft.write("site:home.hero.thesis", "new");
  assert.equal(draft.isDirty(), true);
  assert.equal(draft.read("site:home.hero.thesis"), "new");
});

test("writing the same value back does not mark the draft dirty", () => {
  const draft = createDraft(site(), "abc");
  draft.write("site:home.hero.thesis", "old");
  assert.equal(draft.isDirty(), false);
});

test("the draft never mutates the object it was given", () => {
  const original = site();
  const draft = createDraft(original, "abc");
  draft.write("site:home.hero.thesis", "new");
  assert.equal(original.home.hero.thesis, "old");
});

test("write works through an array key match", () => {
  const draft = createDraft(site(), "abc");
  draft.write("site:home.formats[key=readings].title", "Essays");
  assert.equal(draft.read("site:home.formats[key=readings].title"), "Essays");
});

test("buildPayload is empty when nothing changed", () => {
  assert.deepEqual(createDraft(site(), "abc").buildPayload("m").files, []);
});

test("buildPayload includes site.json once when a field changed", () => {
  const draft = createDraft(site(), "abc");
  draft.write("site:home.hero.thesis", "new");
  const payload = draft.buildPayload("edit");
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].path, "_data/site.json");
  assert.equal(payload.baseCommitSha, "abc");
  assert.equal(payload.message, "edit");
});

test("buildPayload round-trips non-ASCII content through base64", () => {
  const draft = createDraft(site(), "abc");
  draft.write("site:home.hero.thesis", "Reality’s footnotes — better");
  const encoded = draft.buildPayload("edit").files[0].contentBase64;
  const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(decoded.home.hero.thesis, "Reality’s footnotes — better");
});

test("buildPayload matches the repository's existing JSON formatting", () => {
  const draft = createDraft(site(), "abc");
  draft.write("site:home.hero.thesis", "new");
  const text = Buffer.from(draft.buildPayload("m").files[0].contentBase64, "base64").toString("utf8");
  assert.equal(text.endsWith("\n"), false, "_data/site.json has no trailing newline");
  assert.ok(text.includes('\n  "home"'), "two-space indent");
});

test("stageUpload records the file and returns its repository path", () => {
  const draft = createDraft(site(), "abc");
  const repoPath = draft.stageUpload("Rooster Photo.PNG", btoa("bytes"));
  assert.match(repoPath, /^assets\/uploads\//);
  assert.equal(draft.isDirty(), true);
  const paths = draft.buildPayload("m").files.map((f) => f.path);
  assert.ok(paths.includes(repoPath));
});

test("safeUploadName strips characters the Worker allowlist rejects", () => {
  assert.equal(safeUploadName("Rooster Photo.PNG"), "rooster-photo.png");
  assert.equal(safeUploadName("../../main.js"), "main.js");
  assert.equal(safeUploadName("café pic!.jpg"), "caf-pic.jpg");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test editor/lib/draft.test.js`
Expected: FAIL — `Cannot find module './draft.js'`.

- [ ] **Step 3: Write the implementation**

Create `editor/lib/draft.js`:

```javascript
import { parseSpec, getValue, setValue } from "./paths.js";

const FILE_PATHS = { site: "_data/site.json" };

export function safeUploadName(name) {
  const base = String(name).split("/").pop().split("\\").pop();
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/-+(\.[a-z0-9]+)$/, "$1");
  return cleaned || "upload";
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createDraft(site, baseCommitSha) {
  const original = JSON.stringify(site);
  const working = JSON.parse(original);
  const uploads = new Map();

  const resolve = (spec) => {
    const { file, segments } = parseSpec(spec);
    if (file !== "site") throw new Error(`v1 edits site.json only, not "${file}"`);
    return segments;
  };

  return {
    baseCommitSha,

    read(spec) {
      return getValue(working, resolve(spec));
    },

    write(spec, value) {
      setValue(working, resolve(spec), value);
    },

    stageUpload(fileName, bytesBase64) {
      let name = safeUploadName(fileName);
      let candidate = `assets/uploads/${name}`;
      let counter = 2;
      while (uploads.has(candidate)) {
        const dot = name.lastIndexOf(".");
        const stem = dot === -1 ? name : name.slice(0, dot);
        const extension = dot === -1 ? "" : name.slice(dot);
        candidate = `assets/uploads/${stem}-${counter}${extension}`;
        counter += 1;
      }
      uploads.set(candidate, bytesBase64);
      return candidate;
    },

    isDirty() {
      return uploads.size > 0 || JSON.stringify(working) !== original;
    },

    buildPayload(message) {
      const files = [];
      if (JSON.stringify(working) !== original) {
        files.push({
          path: FILE_PATHS.site,
          contentBase64: toBase64(JSON.stringify(working, null, 2))
        });
      }
      for (const [path, contentBase64] of uploads) {
        files.push({ path, contentBase64 });
      }
      return { files, baseCommitSha, message };
    }
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test editor/lib/draft.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify the emitted JSON matches the repository's existing formatting**

Run:

```bash
node -e "const s=require('./_data/site.json');process.stdout.write(JSON.stringify(s,null,2))" | diff - _data/site.json && echo "FORMAT MATCHES"
```

Expected: `FORMAT MATCHES`. `_data/site.json` is two-space indented with **no trailing newline**, and `JSON.stringify(data, null, 2)` reproduces it byte for byte. If this diff is not empty, the first save would reformat the entire file and bury the real change in an unreadable diff during the owner's review. Fix `buildPayload` to match the existing file before continuing.

- [ ] **Step 6: Commit**

```bash
git add editor/lib/draft.js editor/lib/draft.test.js
git commit -m "feat(editor): draft state with staged uploads and save payload"
```

---

### Task 8: Worker API client and the shell's sign-in screen

First task with a browser surface. Verified by loading the page, not by unit tests.

**Files:**
- Create: `editor/lib/api.js`, `editor/index.html`, `editor/editor.css`, `editor/editor.js`
- Modify: `robots.txt`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `editor/lib/api.js`: `createApi(baseUrl) -> { login(password), loadContent(), save(payload), hasSession() }`. `login` stores the token in `sessionStorage` under `ar-editor-token`. Every method throws `Error` with a human-readable `message` on failure; `save` throws an error carrying `.status === 409` on a stale base commit.
  - `editor/editor.js`: on load, shows the sign-in form; on success, reveals `#workspace` and sets the iframe `src`.
- The Worker base URL is read from `<body data-api="…">` in `editor/index.html` so it can be pointed at a local `wrangler dev` during testing.
- The preview URL defaults to `/preview/index.html` and is overridable with `?preview=` for local testing.

- [ ] **Step 1: Write `editor/lib/api.js`**

```javascript
const TOKEN_KEY = "ar-editor-token";

export function createApi(baseUrl) {
  const url = (pathname) => `${baseUrl.replace(/\/$/, "")}${pathname}`;

  const authHeaders = () => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const parse = async (response) => {
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) {
      const error = new Error(body.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  };

  return {
    hasSession() {
      return Boolean(sessionStorage.getItem(TOKEN_KEY));
    },

    async login(password) {
      const body = await parse(
        await fetch(url("/auth"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password })
        })
      );
      sessionStorage.setItem(TOKEN_KEY, body.token);
    },

    async loadContent() {
      return parse(await fetch(url("/content"), { headers: authHeaders() }));
    },

    async save(payload) {
      return parse(
        await fetch(url("/content"), {
          method: "PUT",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload)
        })
      );
    }
  };
}
```

- [ ] **Step 2: Write `editor/index.html`**

```html
---
permalink: /editor/index.html
sitemap: false
---
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Site editor</title>
<link rel="stylesheet" href="{{ "/editor/editor.css" | relative_url }}">
</head>
<body data-api="https://absurdly-rational-editor-api.workers.dev">
  <div id="signin">
    <form id="signin-form">
      <h1>Site editor</h1>
      <p>Enter the editor password to make changes to the draft site.</p>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      <p id="signin-error" role="alert" hidden></p>
    </form>
  </div>

  <div id="workspace" hidden>
    <header id="toolbar">
      <span id="toolbar-title">Editing the draft homepage</span>
      <span id="status" role="status"></span>
      <button type="button" id="settings-button">Page settings</button>
      <button type="button" id="reload-button">Reload preview</button>
      <button type="button" id="save-button" disabled>Save</button>
    </header>
    <iframe id="preview" title="Homepage preview"></iframe>
  </div>

  <script type="module" src="{{ "/editor/editor.js" | relative_url }}"></script>
</body>
</html>
```

The `workers.dev` hostname above is a placeholder for local work; the owner replaces it with their deployed Worker URL in Task 12.

- [ ] **Step 3: Write `editor/editor.css`**

```css
:root { color-scheme: dark; --ar-accent: #6f7bff; --ar-bg: #07080a; --ar-panel: #14161c; --ar-text: #e9ecf5; }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--ar-bg); color: var(--ar-text); }

#signin { display: grid; place-items: center; min-height: 100vh; padding: 24px; }
#signin-form { width: 100%; max-width: 380px; background: var(--ar-panel); padding: 32px; border-radius: 14px; }
#signin-form h1 { margin: 0 0 8px; font-size: 24px; }
#signin-form p { margin: 0 0 24px; opacity: .75; font-size: 14px; }
#signin-form label { display: block; margin-bottom: 6px; font-size: 13px; opacity: .75; }
input, select, textarea { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #2b2f3a; background: #0d0f14; color: inherit; font: inherit; }
button { padding: 10px 16px; border-radius: 8px; border: 0; background: var(--ar-accent); color: #fff; font: inherit; cursor: pointer; }
button:disabled { opacity: .4; cursor: default; }
button[data-variant="quiet"] { background: #262a35; }
#signin-form button { width: 100%; margin-top: 16px; }
#signin-error { color: #ff8f8f; margin-top: 12px; font-size: 14px; }

#workspace { display: flex; flex-direction: column; height: 100vh; }
#toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--ar-panel); border-bottom: 1px solid #23262f; }
#toolbar-title { font-weight: 600; }
#status { margin-left: auto; font-size: 14px; opacity: .8; }
#preview { flex: 1; width: 100%; border: 0; background: #fff; }
```

- [ ] **Step 4: Write `editor/editor.js` (sign-in only for now)**

```javascript
import { createApi } from "./lib/api.js";

const api = createApi(document.body.dataset.api);
const previewUrl = new URLSearchParams(location.search).get("preview") || "/preview/index.html";

const signin = document.getElementById("signin");
const form = document.getElementById("signin-form");
const errorBox = document.getElementById("signin-error");
const workspace = document.getElementById("workspace");
const frame = document.getElementById("preview");

function showWorkspace() {
  signin.hidden = true;
  workspace.hidden = false;
  frame.src = previewUrl;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  try {
    await api.login(document.getElementById("password").value);
    showWorkspace();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

if (api.hasSession()) {
  showWorkspace();
}
```

- [ ] **Step 5: Add the robots rule**

In `robots.txt`, insert before the `Sitemap:` line:

```
Disallow: /editor/
```

- [ ] **Step 6: Verify in a browser**

Start the Worker locally in one terminal:

```bash
npx wrangler dev --config worker/wrangler.toml --var EDITOR_PASSWORD:test-password --var SESSION_SECRET:test-secret --var ALLOWED_ORIGIN:http://localhost:4000
```

Start Jekyll in another:

```bash
bundle exec jekyll serve --port 4000
```

Temporarily set `data-api="http://localhost:8787"` in `editor/index.html`, then open
`http://localhost:4000/editor/?preview=/index.html`.

Verify, in order:
1. The sign-in form appears.
2. A wrong password shows an inline error and does **not** reveal the workspace.
3. `test-password` reveals the toolbar and loads the homepage in the iframe.
4. Reloading the page keeps you signed in (the token is in `sessionStorage`).
5. Opening a new tab requires signing in again.

Restore `data-api` to the placeholder Worker URL before committing.

- [ ] **Step 7: Commit**

```bash
git add editor/lib/api.js editor/index.html editor/editor.css editor/editor.js robots.txt
git commit -m "feat(editor): shell with password sign-in and preview iframe"
```

---

### Task 9: Hover highlighting and click-to-edit text

**Files:**
- Create: `editor/lib/overlay.js`
- Modify: `editor/editor.js`, `editor/editor.css`

**Interfaces:**
- Consumes: `createDraft` (Task 7).
- Produces: `attachOverlay({ frame, draft, onDirty, onImageClick }) -> { detach() }`. Scans the iframe document for `[data-edit]` and `[data-edit-image]`; wires hover and click behaviour; writes text edits into the draft and calls `onDirty()` after each change. Image clicks are delegated to `onImageClick(element, spec)`, implemented in Task 10.

- [ ] **Step 1: Write `editor/lib/overlay.js`**

```javascript
const OVERLAY_STYLE = `
[data-edit], [data-edit-image] { outline-offset: 3px; cursor: text; }
[data-edit]:hover { outline: 2px dashed rgba(111,123,255,.9); }
[data-edit-image] { cursor: pointer; }
[data-edit-image]:hover { outline: 2px dashed rgba(111,123,255,.9); }
[data-edit][contenteditable="plaintext-only"] { outline: 2px solid rgba(111,123,255,1); background: rgba(111,123,255,.08); }
.ar-editing-blocked { cursor: not-allowed !important; }
`;

export function attachOverlay({ frame, draft, onDirty, onImageClick }) {
  const doc = frame.contentDocument;
  const style = doc.createElement("style");
  style.textContent = OVERLAY_STYLE;
  doc.head.appendChild(style);

  const listeners = [];
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };

  // Links must not navigate while editing.
  on(doc, "click", (event) => {
    const link = event.target.closest("a");
    if (link) event.preventDefault();
  }, true);

  for (const node of doc.querySelectorAll("[data-edit]")) {
    node.setAttribute("contenteditable", "plaintext-only");
    node.setAttribute("spellcheck", "true");

    on(node, "input", () => {
      draft.write(node.dataset.edit, node.textContent);
      onDirty();
    });

    on(node, "paste", (event) => {
      event.preventDefault();
      const text = (event.clipboardData || frame.contentWindow.clipboardData).getData("text/plain");
      doc.execCommand("insertText", false, text.replace(/\s+/g, " "));
    });

    on(node, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        node.blur();
      }
      if (event.key === "Escape") {
        node.textContent = draft.read(node.dataset.edit);
        node.blur();
      }
    });

    on(node, "blur", () => {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      node.textContent = text;
      draft.write(node.dataset.edit, text);
      onDirty();
    });
  }

  for (const node of doc.querySelectorAll("[data-edit-image]")) {
    on(node, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onImageClick(node, node.dataset.editImage);
    });
  }

  return {
    detach() {
      listeners.forEach((remove) => remove());
      style.remove();
      doc.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
    }
  };
}
```

`contenteditable="plaintext-only"` is supported in Chrome, Edge, and Safari. Firefox falls back to non-editable rather than to rich text, which fails safe: the `paste` handler and the `blur` normalisation both reduce to plain text regardless, so no markup can enter the draft in any browser.

- [ ] **Step 2: Wire it into `editor/editor.js`**

Replace the file's contents with:

```javascript
import { createApi } from "./lib/api.js";
import { createDraft } from "./lib/draft.js";
import { attachOverlay } from "./lib/overlay.js";

const api = createApi(document.body.dataset.api);
const previewUrl = new URLSearchParams(location.search).get("preview") || "/preview/index.html";

const signin = document.getElementById("signin");
const form = document.getElementById("signin-form");
const errorBox = document.getElementById("signin-error");
const workspace = document.getElementById("workspace");
const frame = document.getElementById("preview");
const status = document.getElementById("status");
const saveButton = document.getElementById("save-button");
const reloadButton = document.getElementById("reload-button");

let draft = null;
let overlay = null;

function setStatus(message) {
  status.textContent = message;
}

function onDirty() {
  saveButton.disabled = !draft || !draft.isDirty();
  setStatus(draft && draft.isDirty() ? "Unsaved changes" : "");
}

function onImageClick() {
  setStatus("Image editing arrives in the next step.");
}

async function start() {
  signin.hidden = true;
  workspace.hidden = false;
  setStatus("Loading…");
  const content = await api.loadContent();
  draft = createDraft(content.site, content.baseCommitSha);
  frame.addEventListener("load", () => {
    if (overlay) overlay.detach();
    overlay = attachOverlay({ frame, draft, onDirty, onImageClick });
    onDirty();
    setStatus("");
  });
  frame.src = previewUrl;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  try {
    await api.login(document.getElementById("password").value);
    await start();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    signin.hidden = false;
    workspace.hidden = true;
  }
});

reloadButton.addEventListener("click", () => {
  if (draft && draft.isDirty() && !confirm("Reloading discards unsaved changes. Continue?")) return;
  location.reload();
});

window.addEventListener("beforeunload", (event) => {
  if (draft && draft.isDirty()) event.preventDefault();
});

if (api.hasSession()) {
  start().catch((error) => {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    signin.hidden = false;
    workspace.hidden = true;
  });
}
```

- [ ] **Step 3: Verify in a browser**

With `wrangler dev` and `jekyll serve` running as in Task 8, open
`http://localhost:4000/editor/?preview=/index.html` and sign in.

Verify:
1. Hovering the H1 lines, thesis, description, CTA label, format door titles, and context copy shows a dashed outline on each.
2. Clicking the thesis lets you type, and the text changes live in the page's real styling.
3. Pressing **Escape** restores the original text.
4. Pressing **Enter** ends editing without inserting a line break.
5. Clicking a format door does **not** navigate away.
6. Pasting bold, coloured text copied from another web page inserts **plain unstyled text**. Confirm in DevTools that the node's `innerHTML` contains no tags.
7. The **Save** button enables after the first edit and the status reads "Unsaved changes".
8. Attempting to close the tab with unsaved changes prompts for confirmation.

- [ ] **Step 4: Commit**

```bash
git add editor/lib/overlay.js editor/editor.js editor/editor.css
git commit -m "feat(editor): hover highlighting and plain-text click-to-edit"
```

---

### Task 10: Image popover and page settings panel

**Files:**
- Create: `editor/lib/panels.js`
- Modify: `editor/editor.js`, `editor/editor.css`

**Interfaces:**
- Consumes: `fitClass`, `focusClass`, `FITS`, `FOCUSES` (Task 6); `createDraft` (Task 7).
- Produces:
  - `openImagePanel({ anchor, spec, draft, onDirty }) -> void`
  - `openSettingsPanel({ draft, onDirty }) -> void`
  - Both render into a single shared `<div id="ar-panel">` appended to the shell body, replacing any panel already open. Closing is by the panel's Done button, `Escape`, or a click outside.

- [ ] **Step 1: Write `editor/lib/panels.js`**

```javascript
import { FITS, FOCUSES, fitClass, focusClass } from "./imagefit.js";

const LINK_FIELDS = [["site:home.hero.cta_url", "Hero button link"]];

const SEO_FIELDS = [
  ["site:home.seo.title", "Search result title"],
  ["site:home.seo.description", "Search result description"],
  ["site:home.seo.og_title", "Social share title"],
  ["site:home.seo.og_description", "Social share description"],
  ["site:home.seo.twitter_description", "Twitter description"]
];

function panelRoot() {
  let root = document.getElementById("ar-panel");
  if (root) root.remove();
  root = document.createElement("div");
  root.id = "ar-panel";
  document.body.appendChild(root);

  const close = () => root.remove();
  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") close();
    },
    { once: true }
  );
  return { root, close };
}

function field(label, value, onChange, type = "text") {
  const wrapper = document.createElement("label");
  wrapper.className = "ar-field";
  wrapper.textContent = label;
  const input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
  if (type !== "textarea") input.type = type;
  input.value = value ?? "";
  input.addEventListener("input", () => onChange(input.value));
  wrapper.appendChild(input);
  return wrapper;
}

function select(label, options, value, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "ar-field";
  wrapper.textContent = label;
  const element = document.createElement("select");
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option;
    node.textContent = option;
    element.appendChild(node);
  }
  element.value = value;
  element.addEventListener("change", () => onChange(element.value));
  wrapper.appendChild(element);
  return wrapper;
}

async function fileToBase64(file) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function openImagePanel({ anchor, spec, draft, onDirty }) {
  const { root, close } = panelRoot();
  const box = document.createElement("div");
  box.className = "ar-panel-box";
  const image = draft.read(spec);
  const img = anchor.querySelector("img.image-object");

  const heading = document.createElement("h2");
  heading.textContent = "Image";
  box.appendChild(heading);

  if (!img) {
    const notice = document.createElement("p");
    notice.className = "ar-notice";
    notice.textContent =
      "This spot currently shows the built-in artwork. Choose an image, then save — the preview shows it after the site rebuilds.";
    box.appendChild(notice);
  }

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".jpg,.jpeg,.png,.webp";
  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    if (!file) return;
    const repoPath = draft.stageUpload(file.name, await fileToBase64(file));
    draft.write(`${spec}.path`, repoPath);
    if (img) img.src = URL.createObjectURL(file);
    onDirty();
  });
  const pickerLabel = document.createElement("label");
  pickerLabel.className = "ar-field";
  pickerLabel.textContent = "Replace image";
  pickerLabel.appendChild(picker);
  box.appendChild(pickerLabel);

  box.appendChild(
    field("Alternative text", image.alt, (value) => {
      draft.write(`${spec}.alt`, value);
      if (img) img.alt = value;
      onDirty();
    })
  );

  box.appendChild(
    select("Image fit", FITS, image.fit || "cover", (value) => {
      draft.write(`${spec}.fit`, value);
      if (img) {
        img.classList.remove(...FITS.map((f) => `image-fit-${f}`));
        img.classList.add(fitClass(value));
      }
      onDirty();
    })
  );

  box.appendChild(
    select("Crop focus", FOCUSES, image.focus || "center", (value) => {
      draft.write(`${spec}.focus`, value);
      if (img) {
        img.classList.remove(...FOCUSES.map((f) => `image-focus-${f}`));
        img.classList.add(focusClass(value));
      }
      onDirty();
    })
  );

  const done = document.createElement("button");
  done.textContent = "Done";
  done.addEventListener("click", close);
  box.appendChild(done);

  root.appendChild(box);
}

export function openSettingsPanel({ draft, onDirty }) {
  const { root, close } = panelRoot();
  const box = document.createElement("div");
  box.className = "ar-panel-box";

  const heading = document.createElement("h2");
  heading.textContent = "Page settings";
  box.appendChild(heading);

  for (const [spec, label] of LINK_FIELDS) {
    box.appendChild(
      field(label, draft.read(spec), (value) => {
        draft.write(spec, value);
        onDirty();
      })
    );
  }

  const note = document.createElement("p");
  note.className = "ar-notice";
  note.textContent = "The rest do not appear on the page. They are what search engines and social sites show.";
  box.appendChild(note);

  for (const [spec, label] of SEO_FIELDS) {
    box.appendChild(
      field(
        label,
        draft.read(spec),
        (value) => {
          draft.write(spec, value);
          onDirty();
        },
        "textarea"
      )
    );
  }

  const done = document.createElement("button");
  done.textContent = "Done";
  done.addEventListener("click", close);
  box.appendChild(done);

  root.appendChild(box);
}
```

- [ ] **Step 2: Add panel styles to `editor/editor.css`**

```css
#ar-panel { position: fixed; inset: 0; background: rgba(4,5,8,.55); display: grid; place-items: center; z-index: 20; }
.ar-panel-box { width: min(420px, calc(100vw - 32px)); max-height: 85vh; overflow-y: auto; background: var(--ar-panel); border-radius: 14px; padding: 24px; display: grid; gap: 14px; }
.ar-panel-box h2 { margin: 0; font-size: 18px; }
.ar-field { display: grid; gap: 6px; font-size: 13px; opacity: .9; }
.ar-field textarea { min-height: 68px; resize: vertical; }
.ar-notice { margin: 0; font-size: 13px; opacity: .7; }
```

- [ ] **Step 3: Wire the panels into `editor/editor.js`**

Add the import:

```javascript
import { openImagePanel, openSettingsPanel } from "./lib/panels.js";
```

Replace the placeholder `onImageClick` with:

```javascript
function onImageClick(anchor, spec) {
  openImagePanel({ anchor, spec, draft, onDirty });
}
```

And wire the settings button, next to the reload handler:

```javascript
document.getElementById("settings-button").addEventListener("click", () => {
  openSettingsPanel({ draft, onDirty });
});
```

- [ ] **Step 4: Verify in a browser**

Open `http://localhost:4000/editor/?preview=/index.html`, sign in, and verify:
1. Clicking a format door's artwork opens the image panel; clicking the backdrop or pressing Escape closes it.
2. Changing **Crop focus** on a door that already has an image visibly shifts the crop immediately.
3. Changing **Image fit** between `cover` and `contain` visibly changes the framing immediately.
4. Choosing a local `.png` swaps the visible image immediately, and **Save** becomes enabled.
5. Clicking the hero artwork — which has no image — shows the "built-in artwork" notice rather than failing.
6. **Page settings** opens the hero button link plus the five SEO fields, all prefilled from `site.json`, and editing any one of them enables Save.
7. Only one panel is ever open at a time.

- [ ] **Step 5: Commit**

```bash
git add editor/lib/panels.js editor/editor.js editor/editor.css
git commit -m "feat(editor): image popover and page settings panel"
```

---

### Task 11: Save

**Files:**
- Modify: `editor/editor.js`

**Interfaces:**
- Consumes: `api.save` (Task 8), `draft.buildPayload` (Task 7).
- Produces: no new exports. Save posts the payload, reports success with the rebuild wait, handles 409 by telling the editor to reload, and handles 401 by returning to sign-in.

- [ ] **Step 1: Add the save handler to `editor/editor.js`**

```javascript
saveButton.addEventListener("click", async () => {
  if (!draft || !draft.isDirty()) return;
  saveButton.disabled = true;
  setStatus("Saving…");
  try {
    await api.save(draft.buildPayload("content(update): homepage edited in the site editor"));
    setStatus("Saved. The preview rebuilds in about a minute — use Reload preview to see it.");
    const content = await api.loadContent();
    draft = createDraft(content.site, content.baseCommitSha);
    if (overlay) overlay.detach();
    overlay = attachOverlay({ frame, draft, onDirty, onImageClick });
    onDirty();
    setStatus("Saved. The preview rebuilds in about a minute — use Reload preview to see it.");
  } catch (error) {
    if (error.status === 409) {
      setStatus("Someone else changed the draft. Reload the page before saving again.");
    } else if (error.status === 401) {
      setStatus("");
      sessionStorage.clear();
      signin.hidden = false;
      workspace.hidden = true;
      errorBox.textContent = "Your session expired. Sign in again.";
      errorBox.hidden = false;
    } else {
      setStatus(error.message);
      saveButton.disabled = false;
    }
  }
});
```

Reloading the content after a successful save is what resets the dirty state and picks up the new `baseCommitSha`, so a second save in the same session does not hit a stale-base 409.

- [ ] **Step 2: Verify the full round trip in a browser**

This step writes real commits to the `editor` branch. Run `wrangler dev` with the real GitHub App secrets, per `worker/SETUP.md` (Task 12).

Verify, in order:
1. Edit the hero thesis, click **Save**. Status reports success.
2. `git fetch origin editor && git show origin/editor:_data/site.json | head -60` shows the new text.
3. The diff for that commit touches **only** `_data/site.json`, and only the changed field — no reformatting of the rest of the file.
4. Edit again and save again in the same session. It succeeds — no 409.
5. In a second browser tab, sign in and save a different edit, then save from the first tab. The first tab reports the conflict message and does **not** overwrite.
6. Upload a new image on a format door and save. The commit contains both `_data/site.json` and the new `assets/uploads/<name>` file, as **one** commit.
7. Wait for the `Deploy site with draft preview` run to finish, click **Reload preview**, and confirm the change is visible at the preview.
8. Confirm `Validate editable content` passed on that commit.

- [ ] **Step 3: Commit**

```bash
git add editor/editor.js
git commit -m "feat(editor): save to the editor branch with conflict and session handling"
```

---

### Task 12: Owner setup instructions and documentation

The editor cannot run until the owner creates the GitHub App and deploys the Worker. Those steps require credentials and must be done by the owner, not by an agent. This task delivers exact instructions.

**Files:**
- Create: `worker/SETUP.md`
- Modify: `OWNER_CMS_SETUP.md`

- [ ] **Step 1: Write `worker/SETUP.md`**

Include, verbatim and in order:

1. **Create the GitHub App.** GitHub → Settings → Developer settings → GitHub Apps → New GitHub App. Name it `Absurdly Rational Editor`. Homepage `https://absurdlyrational.com`. Uncheck **Webhook → Active**. Repository permissions: **Contents: Read and write**. Everything else stays `No access`. Under "Where can this GitHub App be installed?", choose **Only on this account**. Create it.
2. **Record the App ID** shown on the app's settings page.
3. **Generate a private key** on the same page. A `.pem` file downloads. This file is the credential — do not commit it, do not paste it into a chat, and delete the download once it is in the Worker secret.
4. **Install the app** on `attackbackpack/Absurdly-Rational` only. After installing, the browser URL ends in `/installations/<number>` — record that number as the Installation ID.
5. **Create the KV namespace:**

```bash
npx wrangler kv namespace create RATE_LIMIT
```

   Copy the printed `id` into `worker/wrangler.toml`, replacing the placeholder.
6. **Set the secrets**, one command each. Each prompts for the value; nothing is echoed to the shell history.

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

   `EDITOR_PASSWORD` should be a long passphrase the owner chooses. `SESSION_SECRET` should be random — generate it with `openssl rand -base64 32`. `GITHUB_REPO` is `attackbackpack/Absurdly-Rational`. For the private key, paste the entire contents of the `.pem` file including the `BEGIN`/`END` lines.
7. **Deploy:**

```bash
npx wrangler deploy --config worker/wrangler.toml
```

8. **Point the editor at the Worker.** Copy the deployed URL from the output into the `data-api` attribute in `editor/index.html`, commit, and push to `main`.
9. **Confirm the boundary.** Sign in at `https://absurdlyrational.com/editor/`, make a text edit, save, and verify on GitHub that the commit landed on `editor` and touched only `_data/site.json`.

State plainly in the file: the password protects a draft branch of an already-public repository. `main` stays branch-protected and publishing still requires an owner-approved merge, so a leaked password cannot publish anything.

- [ ] **Step 2: Add a section to `OWNER_CMS_SETUP.md`**

Add a `## The visual site editor` section after `## Dad's browser-only workflow` stating:

- The editor is at `https://absurdlyrational.com/editor/` and covers the **homepage only** for now.
- Sign in with the editor password. Hover to see what can be changed; click text to type; click an image for its options.
- Save writes to the `editor` branch exactly as Pages CMS does. The same preview, `Request owner review`, and merge steps apply unchanged.
- Pages CMS remains available and is still the way to edit readings, podcasts, memes, navigation, and the footer.
- Adding a first image where the built-in artwork currently shows requires a save and rebuild before the preview reflects it.

- [ ] **Step 3: Verify the documentation is followable**

Re-read `worker/SETUP.md` and confirm every step names an exact page, command, or value with no "configure appropriately" gaps. Confirm no secret value appears anywhere in the repository:

```bash
git grep -nE "BEGIN (RSA )?PRIVATE KEY|ghp_|ghs_|github_pat_" -- . ':!docs' ':!*.test.mjs' || echo "NO SECRETS COMMITTED"
```

Expected: `NO SECRETS COMMITTED`.

- [ ] **Step 4: Run the full check and commit**

Run: `npm run check`
Expected: content validation, edit-path validation, and all tests pass.

```bash
git add worker/SETUP.md OWNER_CMS_SETUP.md
git commit -m "docs: GitHub App and Worker setup for the visual site editor"
```

---

## Verification summary

After Task 12, all of the following must hold. Do not report the feature complete without running them.

```bash
npm run check
```

- `grep -o "data-edit" index.html | wc -l` returns 16 (14 text, 2 image).
- The `editor` branch contains commits made by the editor touching only `_data/site.json` and `assets/uploads/`.
- `https://absurdlyrational.com/editor/` returns a page carrying `<meta name="robots" content="noindex, nofollow, noarchive">`.
- `robots.txt` contains `Disallow: /editor/`.
- Pages CMS still opens and saves normally.
