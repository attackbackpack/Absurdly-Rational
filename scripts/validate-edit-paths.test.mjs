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
