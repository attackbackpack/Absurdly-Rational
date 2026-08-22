# Visual Editor — All Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped homepage click-to-edit editor to the whole site — readings index, four reading topic pages, podcasts, memes, plus the shared navigation and footer.

**Architecture:** The v1 machinery already generalises. Templates gain `data-edit` attributes; the draft holds four JSON files instead of one; the Worker returns all four; the site's own links become live so the editor follows them, rebuilding the overlay per page. Editing existing text and images only — adding, deleting, and reordering stay in Pages CMS.

**Tech Stack:** Jekyll/Liquid, vanilla ES modules (no build step), `node --test`, Cloudflare Workers, GitHub Git Data API.

**Source spec:** `docs/superpowers/specs/2026-08-21-editor-all-pages-design.md`

## Global Constraints

- Node engine floor `>=20.9`. No new dependencies of any kind; `sharp` stays the only devDependency. Tests use bare `node --test`.
- ES modules loaded directly by the browser. No bundler, no transpiler, no build step.
- Root `package.json` gains no `"type"` field. `editor/package.json` and `worker/package.json` already scope ESM.
- The editor writes only `_data/*.json` and `assets/uploads/*`, only to the `editor` branch. Both are hard-coded Worker constants and must not be parameterised.
- Editable text outputs must carry `| escape`. Without it, typing `<` round-trips lossily and silently destroys data.
- Collection items are addressed by an existing key — `podcasts.guests[key=…]`, `memes.items[key=…]`, `readings.posts[url=…]`. No `id` field is added.
- Do NOT make internal paths editable: `topics[].path`, `navigation[].url`, `home.formats[].url`. A typo silently breaks navigation.
- Do NOT make ARIA labels or `visible`/`layout`/`variant`/`class_name` editable. Pages CMS owns them.
- `site.brand_image` stays non-editable. It is the rooster mark in the nav and footer, identified in `PRODUCT.md` as a fixed brand asset; swapping it is not routine content editing.
- Baseline is 135 tests passing. Report actual counts; never edit a test to hit a predicted number.

## Deviations from the spec, decided during planning

1. **Meme titles and captions need a panel, not click-to-edit.** `memes.html:38` renders each meme as a `<button>` carrying `data-meme-title` and `data-meme-caption`, which `main.js:61-62` reads into a dialog. Those strings are never visible on the wall, so there is no text node to click. Clicking a meme tile in the editor opens a panel with Title, Caption, and the image controls — the same pattern as the image panel. The visible artwork text (`art.headline`, `art.accent`, `art.stamp`, `art.kicker`) IS click-editable where it renders.
2. **`podcasts.guests[].links[].label` is click-editable; the matching `.url` goes in Page settings.** Link labels are visible text; their destinations are not.

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `editor/lib/pagefields.js` | Per-page Page-settings field lists (SEO + external URLs), keyed by `data-page`. Pure. |
| `editor/lib/pagefields.test.js` | Unit tests, including that every listed spec resolves against real `_data`. |

**Modify:**

| Path | Change |
|---|---|
| `editor/lib/draft.js` | Hold four data files instead of one; emit only changed files. |
| `editor/lib/draft.test.js` | Multi-file cases. |
| `editor/lib/panels.js` | Page-aware settings panel; new meme item panel. |
| `editor/lib/overlay.js` | Allow internal-link navigation; expose the navigation intent to the shell. |
| `editor/editor.js` | Re-attach overlay per page load; unsaved-changes guard before navigating. |
| `worker/src/worker.js` | `GET /content` returns all four data files. |
| `worker/src/worker.test.mjs` | Multi-file read cases. |
| `scripts/validate-content.js` | Key/URL uniqueness for the three collections. |
| `scripts/validate-edit-paths.mjs` | Scan all seven templates and the two shared includes. |
| `_includes/nav.html`, `_includes/footer.html` | Annotate shared chrome. |
| `readings.html`, `readings-{evidence,policy,thinking,hospital}.html`, `podcasts.html`, `memes.html` | Annotate. |
| `docs/TESTING-THE-EDITOR.md` | Multi-page verification steps. |

---

### Task 1: Multi-file draft state

**Files:**
- Modify: `editor/lib/draft.js`, `editor/lib/draft.test.js`

**Interfaces:**
- Consumes: `parseSpec`, `getValue`, `setValue` from `editor/lib/paths.js`.
- Produces: `createDraft(files, baseCommitSha)` where `files` is `{ site, readings, podcasts, memes }` — an object of parsed JSON keyed by data-file name. `read`/`write` keep their `"file:path"` spec signature. `buildPayload(message)` emits one entry per CHANGED file only, each at `_data/<name>.json`.

- [ ] **Step 1: Write the failing tests**

Replace the `createDraft` fixture in `editor/lib/draft.test.js` with a multi-file one and add these cases (keep every existing test, updating only how the draft is constructed):

```javascript
const files = () => ({
  site: { home: { hero: { thesis: "old" } }, footer: { note: "footer old" } },
  readings: { page: { title: "Readings" }, posts: [{ url: "https://a", title: "A" }] },
  podcasts: { page: { title: "Podcasts" }, guests: [{ key: "g1", title: "G1" }] },
  memes: { page: { title: "Memes" }, items: [{ key: "m1", title: "M1" }] }
});

test("reads and writes across all four files", () => {
  const d = createDraft(files(), "abc");
  assert.equal(d.read("readings:posts[url=https://a].title"), "A");
  d.write("memes:items[key=m1].title", "M1 edited");
  assert.equal(d.read("memes:items[key=m1].title"), "M1 edited");
});

test("buildPayload emits only the files that changed", () => {
  const d = createDraft(files(), "abc");
  d.write("readings:page.title", "Selected Readings");
  const paths = d.buildPayload("m").files.map((f) => f.path);
  assert.deepEqual(paths, ["_data/readings.json"]);
});

test("buildPayload emits several files when several changed", () => {
  const d = createDraft(files(), "abc");
  d.write("readings:page.title", "X");
  d.write("site:footer.note", "Y");
  const paths = d.buildPayload("m").files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["_data/readings.json", "_data/site.json"]);
});

test("an unknown data file is rejected", () => {
  const d = createDraft(files(), "abc");
  assert.throws(() => d.read("nope:page.title"), /nope/);
});

test("isDirty is false until a real change", () => {
  const d = createDraft(files(), "abc");
  d.write("site:home.hero.thesis", "old");
  assert.equal(d.isDirty(), false);
  d.write("site:home.hero.thesis", "new");
  assert.equal(d.isDirty(), true);
});

test("the draft never mutates the object it was given", () => {
  const original = files();
  const d = createDraft(original, "abc");
  d.write("readings:page.title", "changed");
  assert.equal(original.readings.page.title, "Readings");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test editor/lib/draft.test.js`
Expected: FAIL — `createDraft` currently takes a single site object and rejects any file other than `site`.

- [ ] **Step 3: Rewrite `createDraft` for multiple files**

In `editor/lib/draft.js`, replace the single-site handling. Keep `safeUploadName`, `uploadRejection`, `toBase64`, `seedImageWrites` and the upload staging exactly as they are.

```javascript
const DATA_FILES = ["site", "readings", "podcasts", "memes"];

export function createDraft(files, baseCommitSha) {
  const originals = {};
  const working = {};
  for (const name of DATA_FILES) {
    const text = JSON.stringify(files[name] ?? null);
    originals[name] = text;
    working[name] = JSON.parse(text);
  }
  const uploads = new Map();

  const locate = (spec) => {
    const { file, segments } = parseSpec(spec);
    if (!DATA_FILES.includes(file)) {
      throw new Error(`"${spec}": unknown data file "${file}"`);
    }
    return { file, segments };
  };

  return {
    baseCommitSha,

    read(spec) {
      const { file, segments } = locate(spec);
      return getValue(working[file], segments);
    },

    write(spec, value) {
      const { file, segments } = locate(spec);
      setValue(working[file], segments, value);
    },

    // stageUpload, isDirty and buildPayload follow — see the next step.
  };
}
```

- [ ] **Step 4: Port the remaining methods**

Inside the same returned object, after `write`:

```javascript
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

    changedFiles() {
      return DATA_FILES.filter((name) => JSON.stringify(working[name]) !== originals[name]);
    },

    isDirty() {
      return uploads.size > 0 || this.changedFiles().length > 0;
    },

    buildPayload(message) {
      const out = [];
      for (const name of this.changedFiles()) {
        out.push({
          path: `_data/${name}.json`,
          contentBase64: toBase64(JSON.stringify(working[name], null, 2))
        });
      }
      for (const [path, contentBase64] of uploads) {
        out.push({ path, contentBase64 });
      }
      return { files: out, baseCommitSha, message };
    }
```

Note the serialisation is unchanged: two-space indent, NO trailing newline. All four `_data/*.json` files must round-trip byte-for-byte through `JSON.stringify(data, null, 2)`; Step 6 proves it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test editor/lib/draft.test.js`
Expected: PASS.

- [ ] **Step 6: Prove all four data files round-trip byte-for-byte**

Run:

```bash
for f in site readings podcasts memes; do node -e "const s=require('./_data/$f.json');process.stdout.write(JSON.stringify(s,null,2))" | diff -q - _data/$f.json && echo "$f OK"; done
```

Expected: `site OK`, `readings OK`, `podcasts OK`, `memes OK`. If any file differs, the first save would reformat that whole file and bury the real change in the owner's review diff. Report it rather than working around it.

- [ ] **Step 7: Run the full suite and commit**

Run: `npm run check`

```bash
git add editor/lib/draft.js editor/lib/draft.test.js
git commit -m "feat(editor): hold all four data files in the draft"
```

---

### Task 2: Worker returns all four data files

**Files:**
- Modify: `worker/src/worker.js`, `worker/src/worker.test.mjs`

**Interfaces:**
- Consumes: `github`, `authorize`, `requireSecrets` (existing).
- Produces: `GET /content` returns `{ files: { site, readings, podcasts, memes }, baseCommitSha }`. The old `site` key is removed — Task 3 updates the only consumer.

- [ ] **Step 1: Write the failing tests**

Append to `worker/src/worker.test.mjs`:

```javascript
function mockFourFiles() {
  const bodies = {
    site: JSON.stringify({ home: { hero: { thesis: "hi" } } }),
    readings: JSON.stringify({ page: { title: "R" } }),
    podcasts: JSON.stringify({ page: { title: "P" } }),
    memes: JSON.stringify({ page: { title: "M" } })
  };
  mock.method(globalThis, "fetch", async (input) => {
    const url = String(input.url ?? input);
    if (url.includes("/git/ref/heads/editor")) {
      return new Response(JSON.stringify({ object: { sha: "abc123" } }), { status: 200 });
    }
    for (const name of Object.keys(bodies)) {
      if (url.includes(`/contents/_data/${name}.json`)) {
        return new Response(
          JSON.stringify({ content: btoa(bodies[name]), encoding: "base64" }),
          { status: 200 }
        );
      }
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

test("GET /content returns all four data files", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mockFourFiles();
  const response = await worker.fetch(
    new Request("https://api.example.com/content", { headers: { authorization: await bearer(env) } }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.baseCommitSha, "abc123");
  assert.deepEqual(Object.keys(body.files).sort(), ["memes", "podcasts", "readings", "site"]);
  assert.equal(body.files.readings.page.title, "R");
});

test("GET /content surfaces a failure on any one file as 502", async () => {
  const env = githubEnv();
  env.__installationToken = "ghs_test";
  mock.method(globalThis, "fetch", async (input) => {
    const url = String(input.url ?? input);
    if (url.includes("/git/ref/heads/editor")) {
      return new Response(JSON.stringify({ object: { sha: "abc123" } }), { status: 200 });
    }
    if (url.includes("/contents/_data/memes.json")) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify({ content: btoa("{}"), encoding: "base64" }), { status: 200 });
  });
  const response = await worker.fetch(
    new Request("https://api.example.com/content", { headers: { authorization: await bearer(env) } }),
    env
  );
  mock.restoreAll();
  assert.equal(response.status, 502);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test worker/src/worker.test.mjs`
Expected: the two new tests FAIL — the response has a `site` key, not `files`.

- [ ] **Step 3: Update `handleGetContent`**

In `worker/src/worker.js`, add the constant near `BRANCH`:

```javascript
const DATA_FILES = ["site", "readings", "podcasts", "memes"];
```

Replace the body of `handleGetContent` after the `requireSecrets` and `authorize` guards (leave both exactly as they are):

```javascript
  try {
    const ref = await github(env, `/git/ref/heads/${BRANCH}`);
    const files = {};
    for (const name of DATA_FILES) {
      const file = await github(env, `/contents/_data/${name}.json?ref=${BRANCH}`);
      files[name] = JSON.parse(decodeBase64Utf8(file.content));
    }
    return json(env, request, 200, { files, baseCommitSha: ref.object.sha });
  } catch (error) {
    return json(env, request, 502, { error: `Could not read the site content. ${error.message}` });
  }
```

Extract the existing base64 decoding into a helper next to `github` so it is not repeated four times, preserving the current UTF-8 handling exactly:

```javascript
function decodeBase64Utf8(content) {
  return decodeURIComponent(
    Array.from(atob(String(content).replace(/\n/g, "")))
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
}
```

`_data/readings.json` and `_data/podcasts.json` contain non-ASCII characters, so this decoding is load-bearing — a plain `atob` would corrupt them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test worker/src/worker.test.mjs`
Expected: PASS. Existing tests that asserted `body.site` must be updated to `body.files.site` — that is a rename of the same assertion, not a weakening.

- [ ] **Step 5: Commit**

Run: `npm run check`

```bash
git add worker/src/worker.js worker/src/worker.test.mjs
git commit -m "feat(worker): return all four data files from GET /content"
```

---

### Task 3: Wire the shell to multi-file content

**Files:**
- Modify: `editor/editor.js`

**Interfaces:**
- Consumes: `createDraft(files, baseCommitSha)` (Task 1), `GET /content` returning `{files, baseCommitSha}` (Task 2).
- Produces: no new exports. This task only keeps the shell working; no user-visible change yet.

- [ ] **Step 1: Update both `createDraft` call sites**

In `editor/editor.js`, `start()` and the post-save refresh both do `createDraft(content.site, content.baseCommitSha)`. Change both to `createDraft(content.files, content.baseCommitSha)`.

Search the file for `content.site` and confirm no other occurrence remains.

- [ ] **Step 2: Verify nothing else references the old shape**

Run: `grep -rn "content\.site\|\.site\b" editor/ --include=*.js | grep -v test`
Expected: no match that refers to the API response shape. If one exists, fix it.

- [ ] **Step 3: Run the suite and commit**

Run: `npm run check`
Expected: PASS, unchanged count from Task 2.

```bash
git add editor/editor.js
git commit -m "feat(editor): read the multi-file content payload"
```

---

### Task 4: Key uniqueness and site-wide path validation

Ships before any annotation, so every attribute added afterwards is checked the moment it appears.

**Files:**
- Modify: `scripts/validate-content.js`, `scripts/validate-edit-paths.mjs`, `scripts/validate-content.test.mjs`, `scripts/validate-edit-paths.test.mjs`

**Interfaces:**
- Produces: `validate-edit-paths.mjs` scans all seven templates plus `_includes/nav.html` and `_includes/footer.html`. `validate-content.js` fails on a duplicate `readings.posts[].url`, `podcasts.guests[].key`, or `memes.items[].key`.

- [ ] **Step 1: Write the failing uniqueness tests**

Append to `scripts/validate-content.test.mjs`, following the existing harness style in that file (it runs the real script over a throwaway copy of the repo):

```javascript
test("a duplicate reading url fails validation", async () => {
  const repo = await makeRepo();
  const readings = await readJson(repo, "_data/readings.json");
  readings.posts[1].url = readings.posts[0].url;
  await writeJson(repo, "_data/readings.json", readings);
  const result = await runValidator(repo);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /readings\.json.*posts.*url.*duplicate/i);
});

test("a duplicate meme key fails validation", async () => {
  const repo = await makeRepo();
  const memes = await readJson(repo, "_data/memes.json");
  memes.items[1].key = memes.items[0].key;
  await writeJson(repo, "_data/memes.json", memes);
  const result = await runValidator(repo);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /memes\.json.*items.*key.*duplicate/i);
});

test("a duplicate podcast guest key fails validation", async () => {
  const repo = await makeRepo();
  const podcasts = await readJson(repo, "_data/podcasts.json");
  podcasts.guests[1].key = podcasts.guests[0].key;
  await writeJson(repo, "_data/podcasts.json", podcasts);
  const result = await runValidator(repo);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /podcasts\.json.*guests.*key.*duplicate/i);
});

test("the real repository data has no duplicates", async () => {
  const repo = await makeRepo();
  assert.equal((await runValidator(repo)).code, 0);
});
```

If the existing test file's helpers are named differently, use its names — do not rewrite the harness.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/validate-content.test.mjs`
Expected: the three duplicate tests FAIL (validator exits 0 today).

- [ ] **Step 3: Add the uniqueness check**

In `scripts/validate-content.js`, near the other collection checks:

```javascript
function requireUniqueKey(items, keyField, location) {
  const seen = new Map();
  (items || []).forEach((item, index) => {
    const value = item && item[keyField];
    if (typeof value !== "string" || !value.trim()) {
      fail(`${location}[${index}].${keyField}: a non-empty ${keyField} is required`);
      return;
    }
    if (seen.has(value)) {
      fail(`${location}[${index}].${keyField}: duplicate ${keyField} "${value}" (also at index ${seen.get(value)})`);
      return;
    }
    seen.set(value, index);
  });
}
```

Call it for each collection:

```javascript
if (readings) requireUniqueKey(readings.posts, "url", "_data/readings.json.posts");
if (podcasts) requireUniqueKey(podcasts.guests, "key", "_data/podcasts.json.guests");
if (memes) requireUniqueKey(memes.items, "key", "_data/memes.json.items");
```

These keys are what the editor uses to address items. A duplicate makes two items resolve to the same one, so an edit silently lands on the wrong card.

- [ ] **Step 4: Extend the path validator to every template**

In `scripts/validate-edit-paths.mjs`, replace the `templates` constant:

```javascript
const templates = [
  "index.html",
  "readings.html",
  "readings-evidence.html",
  "readings-policy.html",
  "readings-thinking.html",
  "readings-hospital.html",
  "podcasts.html",
  "memes.html",
  "_includes/nav.html",
  "_includes/footer.html"
];
```

- [ ] **Step 5: Run and commit**

Run: `npm run check`
Expected: PASS. Edit-path validation still reports 16 paths (only `index.html` is annotated so far) and content validation now also proves the three key sets are unique.

```bash
git add scripts/validate-content.js scripts/validate-edit-paths.mjs scripts/validate-content.test.mjs
git commit -m "validate: require unique collection keys and scan every template"
```

---

### Task 5: Annotate the shared navigation and footer

Smallest annotation, and it appears on all seven pages — a good first proof that the validator covers includes.

**Files:**
- Modify: `_includes/nav.html`, `_includes/footer.html`

- [ ] **Step 1: Annotate `_includes/nav.html`**

On the nav link inside the `{% for item in site.data.site.navigation %}` loop, wrap the label and annotate it. The `<a>` itself must stay unannotated so its `href` is untouched:

```html
      <a class="nav-link" href="{{ item.url | relative_url }}" data-page-link="{{ item.key }}"{% if include.current == item.key %} aria-current="page"{% endif %}><span data-edit="site:navigation[key={{ item.key }}].label">{{ item.label | escape }}</span></a>
```

- [ ] **Step 2: Annotate `_includes/footer.html`**

```html
    <p class="footer-note" data-edit="site:footer.note">{{ site.data.site.footer.note }}</p>
```

and, in the footer nav, the contact link's label plus the repeated navigation labels:

```html
      {% for item in site.data.site.navigation %}
      <a href="{{ item.url | relative_url }}"{% if include.current == item.key %} aria-current="page"{% endif %}><span data-edit="site:navigation[key={{ item.key }}].label">{{ item.label | escape }}</span></a>
      {% endfor %}
      <a href="{{ site.data.site.author.linkedin }}" target="_blank" rel="noopener noreferrer"><span data-edit="site:footer.contact_label">{{ site.data.site.footer.contact_label | escape }}</span></a>
```

Note the same nav label spec appears in both includes. That is correct and intentional: editing it in either place edits the same JSON field, and both nodes update on the next render. The overlay handles duplicate specs without special-casing because each node writes the same value.

Add `| escape` to `footer.note` as well:

```html
    <p class="footer-note" data-edit="site:footer.note">{{ site.data.site.footer.note | escape }}</p>
```

- [ ] **Step 3: Verify the validator now sees them**

Run: `node scripts/validate-edit-paths.mjs`
Expected: a count higher than 16, and PASS. Record the actual number.

- [ ] **Step 4: Prove the validator catches a bad path in an include**

Temporarily change the footer note spec to `site:footer.notee`. Run the validator; expect exit 1 naming `_includes/footer.html`. Revert and re-run to confirm it passes.

- [ ] **Step 5: Commit**

Run: `npm run check`

```bash
git add _includes/nav.html _includes/footer.html
git commit -m "feat(editor): annotate the shared navigation and footer"
```

---

### Task 6: Annotate the readings index and the four topic pages

**Files:**
- Modify: `readings.html`, `readings-evidence.html`, `readings-policy.html`, `readings-thinking.html`, `readings-hospital.html`

The four topic pages are byte-identical apart from their `topic:` front matter and `canonical_path`. Apply the same edits to all four.

- [ ] **Step 1: Annotate `readings.html`**

```html
      <h1 data-edit="readings:page.title">{{ readings.page.title | escape }}</h1>
      <p class="page-lede" data-edit="readings:page.lede">{{ readings.page.lede | escape }}</p>
```

Inside the `{% for topic in topics %}` loop:

```html
              <h2 data-edit="readings:topics[slug={{ topic.slug }}].title">{{ topic.title | escape }}</h2>
```

```html
            <span class="topic-door-description" data-edit="readings:topics[slug={{ topic.slug }}].description">{{ topic.description | escape }}</span>
            <span class="topic-door-footer"><span>{{ topic_posts.size }} {% if topic_posts.size == 1 %}essay{% else %}essays{% endif %}</span><span data-edit="readings:topics[slug={{ topic.slug }}].index_label">{{ topic.index_label | escape }}</span></span>
```

The essay count is computed, not content — leave it unannotated.

The source note:

```html
        <h2 data-edit="readings:page.source_note.index_title">{{ readings.page.source_note.index_title | escape }}</h2>
        <p data-edit="readings:page.source_note.index_description">{{ readings.page.source_note.index_description | escape }}</p>
```

```html
      <a class="text-link" href="{{ readings.page.archive_url }}" target="_blank" rel="noopener noreferrer"><span data-edit="readings:page.source_note.archive_label">{{ readings.page.source_note.archive_label | escape }}</span><span class="link-arrow" aria-hidden="true"></span></a>
```

- [ ] **Step 2: Annotate all four topic pages**

Apply to each of `readings-evidence.html`, `readings-policy.html`, `readings-thinking.html`, `readings-hospital.html`:

```html
    <a class="back-link" href="{{ "/readings.html" | relative_url }}"><span class="back-arrow" aria-hidden="true"></span><span data-edit="readings:page.back_label">{{ readings.page.back_label | escape }}</span></a>
```

```html
      <h1 data-edit="readings:topics[slug={{ topic.slug }}].title">{{ topic.title | escape }}</h1>
      <p class="page-lede" data-edit="readings:topics[slug={{ topic.slug }}].description">{{ topic.description | escape }}</p>
```

Leave `reading-topic-count` unannotated — it is computed.

In the topic switcher, annotate the sibling short titles:

```html
      <a href="{{ sibling.path | relative_url }}"{% if sibling.slug == topic.slug %} aria-current="page"{% endif %}><span data-edit="readings:topics[slug={{ sibling.slug }}].short_title">{{ sibling.short_title | escape }}</span></a>
```

Inside the post loop — this is where `url` becomes the addressing key:

```html
          <span class="post-card-media{% if post_image_path == empty %} post-card-media--fallback{% endif %}" data-edit-image="readings:posts[url={{ post.url }}].image">
```

```html
            <h2 data-edit="readings:posts[url={{ post.url }}].title">{{ post.title | escape }}</h2>
            <span class="post-card-subtitle" data-edit="readings:posts[url={{ post.url }}].subtitle">{{ post.subtitle | escape }}</span>
            <span class="post-card-action"><span data-edit="readings:page.post_cta_label">{{ readings.page.post_cta_label | escape }}</span><span class="link-arrow" aria-hidden="true"></span></span>
```

Leave `post-card-date` unannotated — a date needs a picker, not a text box, and is out of scope.

The compact source note:

```html
        <h2 data-edit="readings:page.source_note.topic_title">{{ readings.page.source_note.topic_title | escape }}</h2>
        <p data-edit="readings:page.source_note.topic_description">{{ readings.page.source_note.topic_description | escape }}</p>
```

```html
      <a class="text-link" href="{{ readings.page.archive_url }}" target="_blank" rel="noopener noreferrer"><span data-edit="readings:page.source_note.topic_archive_label">{{ readings.page.source_note.topic_archive_label | escape }}</span><span class="link-arrow" aria-hidden="true"></span></a>
```

- [ ] **Step 3: Confirm the post URL key parses**

The reading URLs are long Substack links containing `:` and `/`. `parseSpec`'s match-value pattern is `[^\]]*`, so they parse as long as no URL contains `]`. Verify:

```bash
node -e "const d=require('./_data/readings.json');const bad=d.posts.filter(p=>p.url.includes(']'));console.log(bad.length?'*** URLS WITH ] ***':'all post urls are safe as keys', bad.map(p=>p.url))"
```

Expected: `all post urls are safe as keys []`. If any URL contains `]`, stop and report — the addressing key must change.

- [ ] **Step 4: Run the validator and the suite**

Run: `npm run check`
Expected: PASS, with the edit-path count risen again. Record it.

- [ ] **Step 5: Commit**

```bash
git add readings.html readings-evidence.html readings-policy.html readings-thinking.html readings-hospital.html
git commit -m "feat(editor): annotate the readings index and topic pages"
```

---

### Task 7: Annotate the podcasts page

**Files:**
- Modify: `podcasts.html`

- [ ] **Step 1: Annotate the page intro and show block**

```html
      <h1 data-edit="podcasts:page.title">{{ podcasts.title | escape }}</h1>
      <p class="page-lede" data-edit="podcasts:page.lede">{{ podcasts.lede | escape }}</p>
```

```html
      <div class="podcast-visual{% if show_image_path != empty %} podcast-visual--image{% endif %}" data-edit-image="podcasts:page.show.image"{% if show_image_path == empty %} aria-hidden="true"{% endif %}>
```

```html
          <span class="podcast-label" data-edit="podcasts:page.show.label">{{ podcasts.show.label | escape }}</span>
```

```html
        <h2 id="show-title" data-edit="podcasts:page.show.title">{{ podcasts.show.title | escape }}</h2>
        <p data-edit="podcasts:page.show.description">{{ podcasts.show.description | escape }}</p>
        <span class="reading-meta" data-edit="podcasts:page.show.meta">{{ podcasts.show.meta | escape }}</span>
        <a class="button button--light" href="{{ podcasts.show.url }}"{% if podcasts.show.new_tab %} target="_blank" rel="noopener noreferrer"{% endif %}><span data-edit="podcasts:page.show.button_label">{{ podcasts.show.button_label | escape }}</span><span class="link-arrow" aria-hidden="true"></span></a>
```

- [ ] **Step 2: Annotate the guest section**

```html
        <h2 id="guest-title" data-edit="podcasts:page.guests_heading">{{ podcasts.guests_heading | escape }}</h2>
        <p data-edit="podcasts:page.guests_description">{{ podcasts.guests_description | escape }}</p>
```

Inside the `{% for guest in site.data.podcasts.guests %}` loop:

```html
          <div class="guest-art guest-art--{{ guest_class }}{% if guest_image_path != empty %} guest-art--image{% endif %}" data-edit-image="podcasts:guests[key={{ guest.key }}].image"{% if guest_image_path == empty %} aria-hidden="true"{% endif %}>
```

```html
              <span data-edit="podcasts:guests[key={{ guest.key }}].art_label">{{ guest.art_label | escape }}</span>
```

```html
            <h3 data-edit="podcasts:guests[key={{ guest.key }}].title">{{ guest.title | escape }}</h3>
            <p data-edit="podcasts:guests[key={{ guest.key }}].description">{{ guest.description | escape }}</p>
            <span class="reading-meta" data-edit="podcasts:guests[key={{ guest.key }}].meta">{{ guest.meta | escape }}</span>
```

The guest links — label editable, `href` untouched. `forloop.index0` addresses the link within the guest, which is stable because links are not reorderable from the editor:

```html
              <a class="{% if link.arrow %}text-link{% else %}secondary-link{% endif %}" href="{{ link.url }}"{% if link.new_tab %} target="_blank" rel="noopener noreferrer"{% endif %}><span data-edit="podcasts:guests[key={{ guest.key }}].links[index={{ forloop.index0 }}].label">{{ link.label | escape }}</span></a>{% if link.arrow %}<span class="link-arrow" aria-hidden="true"></span>{% endif %}
```

**This introduces a new match form.** `[index=N]` matches by array position rather than a field. `index` is therefore a reserved match key: if a collection ever gains a literal `index` field, this addressing would become ambiguous. No current data file has one — verify with `grep -l '"index"' _data/*.json` returning nothing before relying on it, and say so in your report. `editor/lib/paths.js` does not support it today. Add it in this task: in `parseSpec`'s `SEGMENT` handling, when the match key is the literal `index`, produce `{ kind: "match", key: "index", value }`, and in `walk`, when a match segment has `key === "index"`, select `cursor[Number(segment.value)]` after confirming `cursor` is an array and the index is in range. Add unit tests in `editor/lib/paths.test.js` for a literal index, an out-of-range index (must throw), and a wildcard index from Liquid interpolation.

- [ ] **Step 3: Annotate the invite block**

```html
        <h2 id="invite-title" data-edit="podcasts:page.invite.title">{{ podcasts.invite.title | escape }}</h2>
        <p data-edit="podcasts:page.invite.description">{{ podcasts.invite.description | escape }}</p>
```

```html
      <a class="button button--outline" href="{{ podcasts.invite.url }}"{% if podcasts.invite.new_tab %} target="_blank" rel="noopener noreferrer"{% endif %}><span data-edit="podcasts:page.invite.button_label">{{ podcasts.invite.button_label | escape }}</span><span class="link-arrow" aria-hidden="true"></span></a>
```

- [ ] **Step 4: Run and commit**

Run: `npm run check`
Expected: PASS, including the new `[index=N]` tests. Record the edit-path count.

```bash
git add podcasts.html editor/lib/paths.js editor/lib/paths.test.js
git commit -m "feat(editor): annotate the podcasts page and address links by index"
```

---

### Task 8: Annotate memes and add the meme item panel

**Files:**
- Modify: `memes.html`, `editor/lib/panels.js`, `editor/editor.js`, `editor/editor.css`

**Interfaces:**
- Consumes: `createDraft` (Task 1), `openImagePanel` (existing).
- Produces: `openMemePanel({ anchor, spec, draft, onDirty })` in `editor/lib/panels.js`, opened when a `[data-edit-meme]` tile is clicked.

- [ ] **Step 1: Annotate the visible meme text**

```html
      <h1 data-edit="memes:page.title">{{ memes.page.title | escape }}</h1>
      <p class="page-lede" data-edit="memes:page.lede">{{ memes.page.lede | escape }}</p>
```

```html
      <p><strong data-edit="memes:page.starter_note.label">{{ memes.page.starter_note.label | escape }}</strong> <span data-edit="memes:page.starter_note.description">{{ memes.page.starter_note.description | escape }}</span></p>
```

On the tile `<button>`, add the meme-panel hook. The button already carries `data-meme-*` attributes read by `main.js`; leave those exactly as they are:

```html
          <button class="meme-tile {{ layout_class }}" type="button" data-edit-meme="memes:items[key={{ item.key }}]" aria-label="{{ item.aria_label | escape }}" data-meme-title="{{ item.title | escape }}" data-meme-caption="{{ item.caption | escape }}" data-meme-image-alt="{{ item.image.alt | escape }}">
```

The generated artwork text IS visible and click-editable:

```html
                {% if item.art.kicker %}<span class="meme-art-kicker" data-edit="memes:items[key={{ item.key }}].art.kicker">{{ item.art.kicker | escape }}</span>{% endif %}
                <span class="meme-art-text">{{ item.art.headline | escape | newline_to_br }}</span>
                {% if item.art.accent %}<span class="meme-art-accent">{{ item.art.accent | escape | newline_to_br }}</span>{% endif %}
                {% if item.art.stamp %}<span class="meme-art-stamp" data-edit="memes:items[key={{ item.key }}].art.stamp">{{ item.art.stamp | escape }}</span>{% endif %}
```

Note which two are annotated and which are not. `headline` and `accent` pass through `newline_to_br`, so the rendered node contains `<br>` markup. The overlay commits `textContent`, which flattens those breaks — click-editing a headline would silently destroy its line breaks. They are edited from the meme panel instead, where a `<textarea>` preserves newlines. Only `kicker` and `stamp` are click-editable, because neither uses `newline_to_br`.

```html
      <span class="meme-tile-label" data-edit="memes:page.tile_action_label">{{ memes.page.tile_action_label | escape }}</span>
```

Do not annotate the dialog's own labels — they are chrome, and the dialog is populated by `main.js` at runtime.

- [ ] **Step 2: Add `openMemePanel`**

In `editor/lib/panels.js`, add an export. Reuse the existing `panelRoot`, `field`, `select`, `present` and the image controls from `openImagePanel` rather than duplicating them:

```javascript
export function openMemePanel({ anchor, spec, draft, onDirty }) {
  const { root, close } = panelRoot();
  const box = document.createElement("div");
  box.className = "ar-panel-box";

  const heading = document.createElement("h2");
  heading.textContent = "Meme";
  box.appendChild(heading);

  const note = document.createElement("p");
  note.className = "ar-notice";
  note.textContent = "Title and caption appear when someone opens this meme, not on the wall.";
  box.appendChild(note);

  for (const [suffix, label, type] of [
    ["title", "Title", "text"],
    ["caption", "Caption", "textarea"],
    ["art.headline", "Artwork headline", "textarea"],
    ["art.accent", "Artwork accent", "textarea"]
  ]) {
    let current;
    try {
      current = draft.read(`${spec}.${suffix}`);
    } catch {
      continue;
    }
    box.appendChild(
      field(label, current, (value) => {
        draft.write(`${spec}.${suffix}`, value);
        onDirty();
      }, type)
    );
  }

  const done = document.createElement("button");
  done.textContent = "Done";
  done.addEventListener("click", close);
  box.appendChild(done);

  present(root, box);
}
```

`panelRoot()` returns `{ root, close }`; `present(root, box)` is the existing module-level helper that appends the box AND focuses its first control — do not call `root.appendChild(box)` separately, or the panel will not take focus and Escape will not close it.

The `try/catch` around `draft.read` is deliberate: `art.accent` is optional and absent on some memes, and a missing optional field must skip its control rather than throw.

- [ ] **Step 3: Wire the tile click**

In `editor/lib/overlay.js`, alongside the existing `[data-edit-image]` handling, add a scan for `[data-edit-meme]` that calls a new `onMemeClick(node, spec)` callback, preventing default so the tile does not open the site's own dialog while editing.

In `editor/editor.js`, pass `onMemeClick` into `attachOverlay`:

```javascript
function onMemeClick(anchor, spec) {
  openMemePanel({ anchor, spec, draft, onDirty });
}
```

and import `openMemePanel` from `./lib/panels.js`.

- [ ] **Step 4: Run and commit**

Run: `npm run check`
Expected: PASS. Record the edit-path count.

```bash
git add memes.html editor/lib/panels.js editor/lib/overlay.js editor/editor.js editor/editor.css
git commit -m "feat(editor): annotate memes and add the meme item panel"
```

---

### Task 9: Page-aware settings panel

**Files:**
- Create: `editor/lib/pagefields.js`, `editor/lib/pagefields.test.js`
- Modify: `editor/lib/panels.js`, `editor/editor.js`

**Interfaces:**
- Produces: `fieldsForPage(page)` in `editor/lib/pagefields.js`, returning `{ links: [[spec,label],…], seo: [[spec,label],…] }` for a `data-page` value of `home`, `readings`, `podcasts`, or `memes`. Unknown pages return empty lists.
- `openSettingsPanel({ draft, onDirty, page })` gains the `page` argument.

- [ ] **Step 1: Write the failing tests**

Create `editor/lib/pagefields.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fieldsForPage, PAGES } from "./pagefields.js";
import { parseSpec, collectMatches } from "./paths.js";

const data = {
  site: JSON.parse(fs.readFileSync(new URL("../../_data/site.json", import.meta.url), "utf8")),
  readings: JSON.parse(fs.readFileSync(new URL("../../_data/readings.json", import.meta.url), "utf8")),
  podcasts: JSON.parse(fs.readFileSync(new URL("../../_data/podcasts.json", import.meta.url), "utf8")),
  memes: JSON.parse(fs.readFileSync(new URL("../../_data/memes.json", import.meta.url), "utf8"))
};

test("every page has SEO fields", () => {
  for (const page of PAGES) {
    assert.ok(fieldsForPage(page).seo.length > 0, page);
  }
});

test("every spec on every page resolves against the real data", () => {
  for (const page of PAGES) {
    const { links, seo } = fieldsForPage(page);
    for (const [spec] of [...links, ...seo]) {
      const { file, segments } = parseSpec(spec);
      assert.doesNotThrow(() => collectMatches(data[file], segments), `${page}: ${spec}`);
    }
  }
});

test("an unknown page yields empty lists", () => {
  assert.deepEqual(fieldsForPage("nope"), { links: [], seo: [] });
});

test("no internal path is offered as an editable link", () => {
  for (const page of PAGES) {
    for (const [spec] of fieldsForPage(page).links) {
      assert.doesNotMatch(spec, /navigation|topics\[|formats\[/, `${page}: ${spec}`);
    }
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test editor/lib/pagefields.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `editor/lib/pagefields.js`**

```javascript
export const PAGES = ["home", "readings", "podcasts", "memes"];

const SEO_LABELS = [
  ["seo.title", "Search result title"],
  ["seo.description", "Search result description"],
  ["seo.og_title", "Social share title"],
  ["seo.og_description", "Social share description"],
  ["seo.twitter_description", "Twitter description"]
];

const CONFIG = {
  home: {
    seoPrefix: "site:home.",
    links: [["site:home.hero.cta_url", "Hero button link"]]
  },
  readings: {
    seoPrefix: "readings:page.",
    links: [["readings:page.archive_url", "Substack archive link"]]
  },
  podcasts: {
    seoPrefix: "podcasts:page.",
    links: [
      ["podcasts:page.show.url", "Listen button link"],
      ["podcasts:page.invite.url", "Invite button link"]
    ]
  },
  memes: { seoPrefix: "memes:page.", links: [] }
};

export function fieldsForPage(page) {
  const config = CONFIG[page];
  if (!config) return { links: [], seo: [] };
  return {
    links: config.links,
    seo: SEO_LABELS.map(([suffix, label]) => [`${config.seoPrefix}${suffix}`, label])
  };
}
```

Guest link URLs are deliberately absent: they belong to individual guests, not to the page, and putting a variable-length list of them in a page-level panel would be confusing. They stay in Pages CMS.

- [ ] **Step 4: Make the settings panel page-aware**

In `editor/lib/panels.js`, replace the module-level `LINK_FIELDS` and `SEO_FIELDS` constants with a call to `fieldsForPage(page)` inside `openSettingsPanel`, and import it. Show the page name in the heading, e.g. `Page settings — Readings`, so it is obvious which page's settings are open.

In `editor/editor.js`, determine the current page from the iframe document's `body.dataset.page` and pass it:

```javascript
document.getElementById("settings-button").addEventListener("click", () => {
  if (!draft) return;
  const doc = frame.contentDocument;
  const page = doc && doc.body ? doc.body.dataset.page : "";
  openSettingsPanel({ draft, onDirty, page });
});
```

Every template already sets `data-page` on `<body>` (`home`, `readings`, `podcasts`, `memes`); the four topic pages all use `readings`.

- [ ] **Step 5: Run and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add editor/lib/pagefields.js editor/lib/pagefields.test.js editor/lib/panels.js editor/editor.js
git commit -m "feat(editor): page-aware settings panel"
```

---

### Task 10: Navigate between pages, guarding unsaved work

**Files:**
- Modify: `editor/lib/overlay.js`, `editor/editor.js`

**Interfaces:**
- Consumes: `attachOverlay` / `detach` (existing).
- Produces: `attachOverlay` gains an `onNavigate(href)` callback, invoked when an internal link is clicked. The shell decides whether to follow it.

- [ ] **Step 1: Let internal links request navigation**

In `editor/lib/overlay.js`, the capture-phase click handler currently calls `preventDefault()` on every `<a>`. Change it so that it still always prevents the default, but for an internal link it calls `onNavigate(href)`:

```javascript
  on(doc, "click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    if (event.target.closest("[data-edit]")) return;
    const href = link.getAttribute("href") || "";
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return;
    onNavigate(href);
  }, true);
```

The `[data-edit]` check matters: two annotated labels (`hero.cta_label`, `context.contact_label`, and now the nav labels) are spans INSIDE anchors. A click meant to place the caret must not also navigate.

The scheme test rejects anything with a protocol or protocol-relative prefix, so external links (Substack, Spotify, LinkedIn) stay inert exactly as today.

- [ ] **Step 2: Handle navigation in the shell**

In `editor/editor.js`, pass `onNavigate` into both `attachOverlay` call sites:

```javascript
function onNavigate(href) {
  if (draft && draft.isDirty()) {
    const proceed = confirm(
      "You have unsaved changes on this page. Leaving now discards them.\n\nSave first, or press Cancel to stay."
    );
    if (!proceed) return;
  }
  closePanel();
  frame.src = href;
}
```

The existing `frame.addEventListener("load", …)` already detaches and re-attaches the overlay on every load, so navigation reuses that path with no change. Confirm that handler is registered once, outside `start()`'s body, so navigating does not stack duplicate listeners — if it is registered inside `start()`, move it out.

- [ ] **Step 3: Keep the toolbar honest across pages**

The toolbar reads "Editing the draft homepage". Update it on each load to name the current page from `body.dataset.page`, so the editor never claims to be on a page it is not:

```javascript
const PAGE_NAMES = { home: "homepage", readings: "readings", podcasts: "podcasts", memes: "meme bank" };
// inside the iframe load handler:
const page = frame.contentDocument?.body?.dataset.page || "";
document.getElementById("toolbar-title").textContent =
  `Editing the draft ${PAGE_NAMES[page] || "site"}`;
```

- [ ] **Step 4: Run and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add editor/lib/overlay.js editor/editor.js
git commit -m "feat(editor): follow the site's own links, guarding unsaved work"
```

---

### Task 11: Browser verification across all seven pages

No code, unless it finds defects. This is the task that actually proves the feature, since the DOM layer has no unit tests.

**Files:**
- Modify: `docs/TESTING-THE-EDITOR.md`

- [ ] **Step 1: Start the harness**

Two terminals:

```bash
npm run dev:editor-api
```

```bash
bundle exec jekyll serve --port 4000
```

Open `http://localhost:4000/editor/?preview=/index.html`, sign in with `test-password`. No file edits are needed — the editor resolves the local API automatically on a localhost hostname.

- [ ] **Step 2: Walk every page**

For each of the homepage, readings index, all four topic pages, podcasts, and memes:

1. Hover several text fields — a dashed outline appears on the hovered element only.
2. Click one and type — the text changes live in the real site styling.
3. Press Escape — the original text returns and Save disables again if nothing else is dirty.
4. Click an image frame — the image panel opens with Replace/Alt/Fit/Focus, or the built-in-artwork notice when the slot is empty.
5. Open **Page settings** — the heading names the current page, and the fields shown are that page's SEO plus its external links.
6. Confirm the toolbar title names the page you are on.

- [ ] **Step 3: Exercise navigation**

1. With no unsaved changes, click a nav link — the editor follows and the overlay works on the new page.
2. Make an edit, then click a nav link — you are warned before losing it. Cancel; the edit survives and you stay put.
3. Repeat and accept — the edit is discarded and navigation proceeds.
4. Click an external link (Substack on a reading card, Spotify on podcasts) — nothing navigates.
5. Click a nav label itself (the annotated span inside the anchor) — you get a caret and can type; it does NOT navigate.

- [ ] **Step 4: Exercise the meme panel**

1. Click a meme tile — the meme panel opens with Title, Caption, and artwork fields, not the site's meme dialog.
2. Edit the caption, Save, Reload preview — open the meme on the rendered page and confirm the dialog shows the new caption.
3. Confirm a meme whose `art.accent` is absent shows no accent field rather than erroring.

- [ ] **Step 5: Exercise a cross-file save**

1. Edit a reading title AND the footer note in one session.
2. Save.
3. Run `git diff --stat _data/` and confirm exactly two files changed, each showing only the edited field — no whole-file reformat.
4. Run `git checkout -- _data/ && git clean -fd assets/uploads` to reset.

- [ ] **Step 6: Record results and update the doc**

Add a multi-page section to `docs/TESTING-THE-EDITOR.md` covering steps 2–5 as a checklist the owner can repeat.

Report every defect found rather than fixing it silently; each becomes a finding for the review loop.

- [ ] **Step 7: Commit**

```bash
git add docs/TESTING-THE-EDITOR.md
git commit -m "docs: multi-page verification checklist"
```

---

## Verification summary

Do not report the feature complete without running these.

```bash
npm run check
```

- `node scripts/validate-edit-paths.mjs` reports every annotated path resolving, across all ten scanned files.
- All four `_data/*.json` files round-trip byte-for-byte through `JSON.stringify(data, null, 2)`.
- A save touching two data files produces one commit containing both.
- Navigating with unsaved changes warns before discarding.
- External links remain inert; internal links navigate.
