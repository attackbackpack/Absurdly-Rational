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

// --- Adversarial cases for safeUploadName, beyond the brief's three ---

test("safeUploadName: extension-only name still satisfies the allowlist", () => {
  const name = safeUploadName(".png");
  assert.match(`assets/uploads/${name}`, /^assets\/uploads\/[A-Za-z0-9._-]+$/);
});

test("safeUploadName: name that cleans to empty still satisfies the allowlist", () => {
  const name = safeUploadName("!!!");
  assert.match(`assets/uploads/${name}`, /^assets\/uploads\/[A-Za-z0-9._-]+$/);
});

test("safeUploadName: double extension is preserved and safe", () => {
  const name = safeUploadName("a.tar.gz");
  assert.match(`assets/uploads/${name}`, /^assets\/uploads\/[A-Za-z0-9._-]+$/);
});

test("safeUploadName: very long name is still safe", () => {
  const longName = "a".repeat(500) + ".png";
  const name = safeUploadName(longName);
  assert.match(`assets/uploads/${name}`, /^assets\/uploads\/[A-Za-z0-9._-]+$/);
});

test("safeUploadName: leading dot is stripped, still safe", () => {
  const name = safeUploadName(".hidden-file.png");
  assert.match(`assets/uploads/${name}`, /^assets\/uploads\/[A-Za-z0-9._-]+$/);
});

test("safeUploadName: windows-style backslash path is reduced to the basename", () => {
  const name = safeUploadName("C:\\Users\\me\\Pictures\\photo.jpg");
  assert.match(`assets/uploads/${name}`, /^assets\/uploads\/[A-Za-z0-9._-]+$/);
  assert.ok(!name.includes("\\"));
});

test("safeUploadName: name of only separators still satisfies the allowlist", () => {
  const name = safeUploadName("////\\\\\\");
  assert.match(`assets/uploads/${name}`, /^assets\/uploads\/[A-Za-z0-9._-]+$/);
});

test("stageUpload: cleaned-name collisions are deduped and each staged path satisfies the allowlist", () => {
  const draft = createDraft(site(), "abc");
  const a = draft.stageUpload("Rooster Photo.PNG", btoa("one"));
  const b = draft.stageUpload("rooster photo.png", btoa("two"));
  const c = draft.stageUpload("ROOSTER PHOTO.PNG", btoa("three"));
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
  for (const p of [a, b, c]) {
    assert.match(p, /^assets\/uploads\/[A-Za-z0-9._-]+$/);
  }
  const paths = draft.buildPayload("m").files.map((f) => f.path);
  assert.ok(paths.includes(a));
  assert.ok(paths.includes(b));
  assert.ok(paths.includes(c));
});
