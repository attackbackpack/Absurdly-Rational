import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDraft,
  safeUploadName,
  uploadRejection,
  uploadTag,
  commitMessage,
  describeFiles,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_DIMENSION
} from "./draft.js";

const site = () => ({
  home: {
    hero: { thesis: "old", image: { path: "", alt: "", fit: "contain", focus: "center" } },
    formats: [{ key: "readings", title: "Selected Readings" }]
  }
});

// Wraps the pre-existing single-file `site()` fixture into the multi-file
// shape createDraft now takes, so the existing tests below stay unchanged
// apart from their construction line.
const withSite = () => ({ site: site(), readings: {}, podcasts: {}, memes: {} });

const files = () => ({
  site: { home: { hero: { thesis: "old" } }, footer: { note: "footer old" } },
  readings: { page: { title: "Readings" }, posts: [{ url: "https://a", title: "A" }] },
  podcasts: { page: { title: "Podcasts" }, guests: [{ key: "g1", title: "G1" }] },
  memes: { page: { title: "Memes" }, items: [{ key: "m1", title: "M1" }] }
});

test("a fresh draft is not dirty", () => {
  assert.equal(createDraft(withSite(), "abc").isDirty(), false);
});

test("read returns the current value", () => {
  assert.equal(createDraft(withSite(), "abc").read("site:home.hero.thesis"), "old");
});

test("write marks the draft dirty and read reflects it", () => {
  const draft = createDraft(withSite(), "abc");
  draft.write("site:home.hero.thesis", "new");
  assert.equal(draft.isDirty(), true);
  assert.equal(draft.read("site:home.hero.thesis"), "new");
});

test("writing the same value back does not mark the draft dirty", () => {
  const draft = createDraft(withSite(), "abc");
  draft.write("site:home.hero.thesis", "old");
  assert.equal(draft.isDirty(), false);
});

test("the draft never mutates the object it was given", () => {
  const original = withSite();
  const draft = createDraft(original, "abc");
  draft.write("site:home.hero.thesis", "new");
  assert.equal(original.site.home.hero.thesis, "old");
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

test("write works through an array key match", () => {
  const draft = createDraft(withSite(), "abc");
  draft.write("site:home.formats[key=readings].title", "Essays");
  assert.equal(draft.read("site:home.formats[key=readings].title"), "Essays");
});

test("buildPayload is empty when nothing changed", () => {
  assert.deepEqual(createDraft(withSite(), "abc").buildPayload("m").files, []);
});

test("buildPayload includes site.json once when a field changed", () => {
  const draft = createDraft(withSite(), "abc");
  draft.write("site:home.hero.thesis", "new");
  const payload = draft.buildPayload("edit");
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].path, "_data/site.json");
  assert.equal(payload.baseCommitSha, "abc");
  assert.equal(payload.message, "edit");
});

test("buildPayload round-trips non-ASCII content through base64", () => {
  const draft = createDraft(withSite(), "abc");
  draft.write("site:home.hero.thesis", "Reality’s footnotes — better");
  const encoded = draft.buildPayload("edit").files[0].contentBase64;
  const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(decoded.home.hero.thesis, "Reality’s footnotes — better");
});

test("buildPayload matches the repository's existing JSON formatting", () => {
  const draft = createDraft(withSite(), "abc");
  draft.write("site:home.hero.thesis", "new");
  const text = Buffer.from(draft.buildPayload("m").files[0].contentBase64, "base64").toString("utf8");
  assert.equal(text.endsWith("\n"), true, "_data/site.json ends with a trailing newline");
  assert.ok(text.includes('\n  "home"'), "two-space indent");
});

test("stageUpload records the file and returns its repository path", () => {
  const draft = createDraft(withSite(), "abc");
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
  const draft = createDraft(withSite(), "abc");
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

// --- Interior dot runs: the Worker rejects any path containing "..", and it
// rejects the whole batch, so one of these names would brick every later save.

const ALLOWED_UPLOAD_PATH = /^assets\/uploads\/[A-Za-z0-9._-]+$/;

test("safeUploadName: a doubled interior dot is collapsed", () => {
  assert.equal(safeUploadName("v1..final.jpg"), "v1.final.jpg");
  assert.equal(safeUploadName("a.b..c.webp"), "a.b.c.webp");
});

test("safeUploadName: long dot runs collapse to a single dot", () => {
  assert.equal(safeUploadName("a....b.png"), "a.b.png");
});

test("safeUploadName: no cleaned name contains a traversal-shaped run", () => {
  const names = ["v1..final.jpg", "a.b..c.webp", "a....b.png", "....png", "..", "a..", "..a.jpg"];
  for (const name of names) {
    const cleaned = safeUploadName(name);
    assert.ok(!cleaned.includes(".."), `${name} → ${cleaned} still contains ".."`);
    assert.match(`assets/uploads/${cleaned}`, ALLOWED_UPLOAD_PATH);
  }
});

test("stageUpload: a dotted name stages at a path the Worker allowlist accepts", () => {
  const draft = createDraft(withSite(), "abc");
  const staged = draft.stageUpload("v1..final.jpg", btoa("bytes"));
  assert.match(staged, /^assets\/uploads\/v1\.final-[0-9a-z]+\.jpg$/);
  assert.ok(!staged.includes(".."));
  assert.match(staged, ALLOWED_UPLOAD_PATH);
});

// --- uploadRejection mirrors scripts/validate-content.js. Every case below is
// a file that reaches the repository and fails CI if it is not caught here.

test("uploadRejection accepts an ordinary photo", () => {
  assert.equal(uploadRejection({ name: "rooster.jpg", size: 900000, width: 1600, height: 1200 }), null);
});

test("uploadRejection accepts every allowed extension, case-insensitively", () => {
  for (const extension of ["JPG", "jpeg", "PNG", "webp"]) {
    assert.equal(
      uploadRejection({ name: `photo.${extension}`, size: 1000, width: 100, height: 100 }),
      null,
      extension
    );
  }
});

test("uploadRejection rejects an iPhone HEIC by extension", () => {
  const problem = uploadRejection({ name: "IMG_1234.HEIC", size: 2000000, width: 4032, height: 3024 });
  assert.match(problem, /JPG, PNG, or WebP/);
});

test("uploadRejection rejects a file with no extension at all", () => {
  assert.match(uploadRejection({ name: "photo", size: 1000, width: 100, height: 100 }), /JPG, PNG, or WebP/);
});

test("uploadRejection rejects a name that cleaning leaves extensionless", () => {
  // safeUploadName("....png") is "png" — the committed file would have no
  // extension and validateAssetFile would fail on it.
  assert.equal(safeUploadName("....png"), "png");
  assert.match(uploadRejection({ name: "....png", size: 1000, width: 100, height: 100 }), /JPG, PNG, or WebP/);
});

test("uploadRejection rejects a file over the 10 MB limit and names the limit", () => {
  const problem = uploadRejection({
    name: "big.png",
    size: MAX_UPLOAD_BYTES + 1,
    width: 100,
    height: 100
  });
  assert.match(problem, /10 MB/);
});

test("uploadRejection accepts a file exactly at the 10 MB limit", () => {
  assert.equal(
    uploadRejection({ name: "big.png", size: MAX_UPLOAD_BYTES, width: 100, height: 100 }),
    null
  );
});

test("uploadRejection rejects a 48MP phone photo by dimensions", () => {
  const problem = uploadRejection({ name: "IMG_9999.jpg", size: 9000000, width: 8064, height: 6048 });
  assert.match(problem, /8064×6048/);
  assert.match(problem, new RegExp(String(MAX_UPLOAD_DIMENSION)));
});

test("uploadRejection rejects an image over the limit on either side alone", () => {
  assert.ok(uploadRejection({ name: "a.jpg", size: 10, width: MAX_UPLOAD_DIMENSION + 1, height: 10 }));
  assert.ok(uploadRejection({ name: "a.jpg", size: 10, width: 10, height: MAX_UPLOAD_DIMENSION + 1 }));
  assert.equal(
    uploadRejection({
      name: "a.jpg",
      size: 10,
      width: MAX_UPLOAD_DIMENSION,
      height: MAX_UPLOAD_DIMENSION
    }),
    null
  );
});

test("uploadRejection reports a file that could not be decoded as an image", () => {
  const problem = uploadRejection({ name: "broken.png", size: 1000, width: null, height: null });
  assert.match(problem, /could not be read as an image/);
});

test("uploadRejection skips the dimension check when dimensions are unknown", () => {
  assert.equal(uploadRejection({ name: "photo.png", size: 1000 }), null);
});

test("uploadRejection reports the extension problem before the size problem", () => {
  const problem = uploadRejection({ name: "huge.heic", size: MAX_UPLOAD_BYTES * 3, width: null, height: null });
  assert.match(problem, /JPG, PNG, or WebP/);
});

// --- Upload names must not collide with what is already on the editor branch.
// stageUpload used to de-duplicate only within one session, so two sessions
// that each uploaded an "image.jpg" produced the same path and the second
// silently replaced the first.

const ALLOWLIST = /^assets\/uploads\/[A-Za-z0-9._-]+$/;

test("uploadTag is stable for the same bytes and differs for different bytes", () => {
  assert.equal(uploadTag("AAAA"), uploadTag("AAAA"));
  assert.notEqual(uploadTag("AAAA"), uploadTag("AAAB"));
  assert.notEqual(uploadTag(""), uploadTag("A"));
});

test("uploadTag only ever produces allowlist-safe characters", () => {
  for (const bytes of ["", "A", btoa("some bytes"), "x".repeat(5000)]) {
    assert.match(uploadTag(bytes), /^[0-9a-z]+$/, JSON.stringify(bytes.slice(0, 8)));
  }
});

test("the same file name from two sessions stages at different paths", () => {
  const one = createDraft(withSite(), "abc").stageUpload("image.jpg", btoa("guest photo"));
  const two = createDraft(withSite(), "abc").stageUpload("image.jpg", btoa("show artwork"));
  assert.notEqual(one, two);
  assert.match(one, ALLOWLIST);
  assert.match(two, ALLOWLIST);
});

test("case-folded names that collide after cleaning still stage apart", () => {
  const draft = createDraft(withSite(), "abc");
  const a = draft.stageUpload("IMG_0421.JPG", btoa("one"));
  const b = draft.stageUpload("img_0421.jpg", btoa("two"));
  assert.notEqual(a, b);
});

test("the sanitisation is still applied before the tag is appended", () => {
  const draft = createDraft(withSite(), "abc");
  assert.match(
    draft.stageUpload("C:\\Users\\me\\My Rooster Photo!.PNG", btoa("bytes")),
    /^assets\/uploads\/my-rooster-photo-[0-9a-z]+\.png$/
  );
});

test("staging the identical file twice reuses one path, not two", () => {
  const draft = createDraft(withSite(), "abc");
  const a = draft.stageUpload("photo.jpg", btoa("same"));
  const b = draft.stageUpload("photo.jpg", btoa("same"));
  assert.equal(a, b);
  assert.equal(draft.buildPayload("m").files.filter((f) => f.path === a).length, 1);
});

// --- Re-picking an image in one session must not commit the abandoned file.

test("re-picking for the same slot replaces the staged file", () => {
  const draft = createDraft(withSite(), "abc");
  const spec = "site:home.hero.image";
  const first = draft.stageUpload("one.jpg", btoa("first"), spec);
  const second = draft.stageUpload("two.jpg", btoa("second"), spec);
  const paths = draft.buildPayload("m").files.map((f) => f.path);
  assert.ok(paths.includes(second));
  assert.ok(!paths.includes(first), "the abandoned file must not be committed");
});

test("re-picking for one slot leaves another slot's file alone", () => {
  const draft = createDraft(withSite(), "abc");
  const hero = draft.stageUpload("hero.jpg", btoa("hero"), "site:home.hero.image");
  draft.stageUpload("a.jpg", btoa("a"), "site:home.formats[key=readings].image");
  const b = draft.stageUpload("b.jpg", btoa("b"), "site:home.formats[key=readings].image");
  const paths = draft.buildPayload("m").files.map((f) => f.path);
  assert.ok(paths.includes(hero));
  assert.ok(paths.includes(b));
  assert.equal(paths.length, 2);
});

test("one file staged into two slots survives one of them being re-picked", () => {
  const draft = createDraft(withSite(), "abc");
  const shared = draft.stageUpload("shared.jpg", btoa("shared"), "site:home.hero.image");
  assert.equal(draft.stageUpload("shared.jpg", btoa("shared"), "site:home.formats[key=readings].image"), shared);
  draft.stageUpload("other.jpg", btoa("other"), "site:home.hero.image");
  const paths = draft.buildPayload("m").files.map((f) => f.path);
  assert.ok(paths.includes(shared), "the other slot still points at it");
});

test("staging with no spec keeps the old un-scoped behaviour", () => {
  const draft = createDraft(withSite(), "abc");
  const a = draft.stageUpload("one.jpg", btoa("first"));
  const b = draft.stageUpload("two.jpg", btoa("second"));
  const paths = draft.buildPayload("m").files.map((f) => f.path);
  assert.ok(paths.includes(a));
  assert.ok(paths.includes(b));
});

// --- The commit message has to say which pages were edited.

test("commitMessage names one file naturally", () => {
  assert.equal(commitMessage(["site"]), "content(update): homepage edited in the site editor");
  assert.equal(commitMessage(["memes"]), "content(update): meme bank edited in the site editor");
});

test("commitMessage names two files with 'and'", () => {
  assert.equal(
    commitMessage(["readings", "podcasts"]),
    "content(update): readings and podcasts edited in the site editor"
  );
});

test("commitMessage lists three or four files", () => {
  assert.equal(
    commitMessage(["site", "readings", "podcasts"]),
    "content(update): homepage, readings and podcasts edited in the site editor"
  );
  assert.equal(
    commitMessage(["site", "readings", "podcasts", "memes"]),
    "content(update): homepage, readings, podcasts and meme bank edited in the site editor"
  );
});

test("commitMessage stays sensible with nothing to name", () => {
  assert.equal(commitMessage([]), "content(update): edited in the site editor");
  assert.equal(commitMessage(undefined), "content(update): edited in the site editor");
});

test("commitMessage is derived from what the draft actually changed", () => {
  const draft = createDraft(
    { site: site(), readings: { page: { title: "R" } }, podcasts: {}, memes: {} },
    "abc"
  );
  draft.write("readings:page.title", "New");
  assert.equal(commitMessage(draft.changedFiles()), "content(update): readings edited in the site editor");
  draft.write("site:home.hero.thesis", "New");
  assert.equal(
    commitMessage(draft.changedFiles()),
    "content(update): homepage and readings edited in the site editor"
  );
});

test("describeFiles names the pages a reload would cost", () => {
  assert.equal(describeFiles(["site", "memes"]), "homepage and meme bank");
  assert.equal(describeFiles([]), "");
});

// --- A 409 must not cost four files of work when the conflict is elsewhere.

const multi = () => ({
  site: site(),
  readings: { page: { title: "Readings" } },
  podcasts: { page: { title: "Podcasts" } },
  memes: { page: { title: "Memes" } }
});

test("rebase adopts a remote change to a file this draft never touched", () => {
  const draft = createDraft(multi(), "abc");
  draft.write("readings:page.title", "Mine");
  const remote = multi();
  remote.memes.page.title = "Theirs";
  const result = draft.rebase(remote, "def");
  assert.deepEqual(result, { ok: true, files: [] });
  assert.equal(draft.baseCommitSha, "def");
  assert.equal(draft.read("readings:page.title"), "Mine", "my edit survives");
  assert.equal(draft.read("memes:page.title"), "Theirs", "their edit is taken");
  assert.deepEqual(draft.changedFiles(), ["readings"], "only my file is still pending");
});

test("rebase refuses when the same file changed on both sides, and changes nothing", () => {
  const draft = createDraft(multi(), "abc");
  draft.write("readings:page.title", "Mine");
  const remote = multi();
  remote.readings.page.title = "Theirs";
  const result = draft.rebase(remote, "def");
  assert.deepEqual(result, { ok: false, files: ["readings"] });
  assert.equal(draft.baseCommitSha, "abc", "the draft still targets the head it knows");
  assert.equal(draft.read("readings:page.title"), "Mine", "nothing is discarded");
});

test("rebase names every conflicting file", () => {
  const draft = createDraft(multi(), "abc");
  draft.write("readings:page.title", "Mine");
  draft.write("memes:page.title", "Mine");
  const remote = multi();
  remote.readings.page.title = "Theirs";
  remote.memes.page.title = "Theirs";
  remote.podcasts.page.title = "Theirs";
  assert.deepEqual(draft.rebase(remote, "def").files, ["readings", "memes"]);
});

test("rebase re-points buildPayload at the new head", () => {
  const draft = createDraft(multi(), "abc");
  draft.write("readings:page.title", "Mine");
  draft.rebase(multi(), "def");
  assert.equal(draft.buildPayload("m").baseCommitSha, "def");
});

test("a rebased draft still knows it is dirty", () => {
  const draft = createDraft(multi(), "abc");
  draft.write("readings:page.title", "Mine");
  draft.rebase(multi(), "def");
  assert.equal(draft.isDirty(), true);
});
