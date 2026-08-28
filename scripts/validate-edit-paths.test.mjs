import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractSpecs, assertResolves } from "./validate-edit-paths.mjs";

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

// --- data-edit-meme used to be invisible to this scan. memes.html's meme
// frame, and with it every meme addressed by key, was excluded from the count
// entirely — and openMemePanel's bare `catch { continue }` meant a drifted key
// produced no error anywhere, just a panel with fewer fields.

test("extractSpecs finds data-edit-meme", () => {
  const html = `<button data-edit-meme="memes:items[key={{ item.key }}]"></button>`;
  assert.deepEqual(extractSpecs(html), [
    { attr: "data-edit-meme", spec: "memes:items[key={{ item.key }}]" }
  ]);
});

test("extractSpecs tells the three annotations apart on one element's siblings", () => {
  const html = `
    <p data-edit="site:home.hero.thesis">x</p>
    <div data-edit-image="site:home.hero.image"></div>
    <button data-edit-meme="memes:items[key=a]"></button>
  `;
  assert.deepEqual(
    extractSpecs(html).map(({ attr }) => attr),
    ["data-edit", "data-edit-image", "data-edit-meme"]
  );
});

test("the boolean data-edit-image-decorative attribute is not mistaken for a spec", () => {
  const html = `<span data-edit-image="site:home.formats[key=a].image" data-edit-image-decorative></span>`;
  assert.equal(extractSpecs(html).length, 1);
});

test("memes.html's meme frame is now scanned", () => {
  const html = fs.readFileSync(new URL("../memes.html", import.meta.url), "utf8");
  const memeSpecs = extractSpecs(html).filter(({ attr }) => attr === "data-edit-meme");
  assert.equal(memeSpecs.length, 1);
  assert.equal(memeSpecs[0].spec, "memes:items[key={{ item.key }}]");
});

// --- assertResolves

const fixture = {
  items: [
    { key: "a", title: "A", art: { headline: "h", stamp: "S" }, image: { path: "", alt: "", fit: "cover", focus: "center" } },
    { key: "b", title: "B", art: { headline: "h" }, image: { path: "", alt: "", fit: "cover", focus: "center" } }
  ]
};

test("a data-edit-meme spec must resolve to an object, like data-edit-image", () => {
  assert.doesNotThrow(() => assertResolves(fixture, "object", "memes:items[key={{ item.key }}]"));
  assert.throws(
    () => assertResolves(fixture, "object", "memes:items[key={{ item.key }}].title"),
    /must point at an object/
  );
});

test("an image spec must carry fit and focus, which the panel reads straight from the data", () => {
  assert.doesNotThrow(() => assertResolves(fixture, "image", "memes:items[key={{ item.key }}].image"));
  const missing = structuredClone(fixture);
  delete missing.items[1].image.focus;
  assert.throws(
    () => assertResolves(missing, "image", "memes:items[key={{ item.key }}].image"),
    /missing "focus"/
  );
});

test("a required text spec is proved on every item, not just the first", () => {
  const drifted = structuredClone(fixture);
  drifted.items[1].title = 7;
  assert.throws(
    () => assertResolves(drifted, "text", "memes:items[key={{ item.key }}].title"),
    /must point at a string/
  );
});

test("an optional text spec tolerates absence but not drift under it", () => {
  assert.doesNotThrow(
    () => assertResolves(fixture, "optional-text", "memes:items[key={{ item.key }}].art.stamp"),
    "item b simply has no stamp"
  );
  const wrongType = structuredClone(fixture);
  wrongType.items[0].art.stamp = { text: "S" };
  assert.throws(
    () => assertResolves(wrongType, "optional-text", "memes:items[key={{ item.key }}].art.stamp"),
    /must be a string when present/
  );
  const renamedParent = structuredClone(fixture);
  delete renamedParent.items[1].art;
  assert.throws(
    () => assertResolves(renamedParent, "optional-text", "memes:items[key={{ item.key }}].art.stamp"),
    /art/
  );
});
