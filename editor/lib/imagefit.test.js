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
