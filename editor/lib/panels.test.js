import { test } from "node:test";
import assert from "node:assert/strict";
import { seedImageWrites } from "./panels.js";

// The image objects in _data/site.json as they ship: fit and focus only.
const shipped = () => ({ decorative: false, fit: "cover", focus: "center" });

test("a non-decorative slot is completed with path and alt only", () => {
  assert.deepEqual(seedImageWrites(shipped(), false), [
    ["path", ""],
    ["alt", ""]
  ]);
});

test("a decorative slot also records decorative: true in the data", () => {
  // scripts/validate-content.js gates the alt requirement on the DATA field, so
  // without this an uploaded door image fails CI and the panel hides the only
  // control that could fix it.
  assert.deepEqual(seedImageWrites(shipped(), true), [
    ["path", ""],
    ["alt", ""],
    ["decorative", true]
  ]);
});

test("existing string values are never overwritten", () => {
  const image = { path: "assets/uploads/a.png", alt: "A rooster", fit: "cover", focus: "center" };
  assert.deepEqual(seedImageWrites(image, false), []);
});

test("only the missing key is seeded", () => {
  assert.deepEqual(seedImageWrites({ path: "assets/uploads/a.png", fit: "cover" }, false), [["alt", ""]]);
  assert.deepEqual(seedImageWrites({ alt: "x", fit: "cover" }, false), [["path", ""]]);
});

test("a non-string path or alt is replaced, since the validator requires strings", () => {
  assert.deepEqual(seedImageWrites({ path: null, alt: 7 }, false), [
    ["path", ""],
    ["alt", ""]
  ]);
});

test("decorative is not re-written when the data already says true", () => {
  assert.deepEqual(seedImageWrites({ path: "", alt: "", decorative: true }, true), []);
});

test("decorative: false is never written for a slot the template renders normally", () => {
  const writes = seedImageWrites({ path: "", alt: "", decorative: true }, false);
  assert.deepEqual(writes, []);
});

test("nothing is written for an already-complete non-decorative slot", () => {
  assert.deepEqual(seedImageWrites({ path: "", alt: "", decorative: false }, false), []);
});
