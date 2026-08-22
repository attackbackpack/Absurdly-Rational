import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEditText, editTextChanged } from "./editText.js";

test("normalizeEditText collapses internal whitespace runs to a single space", () => {
  assert.equal(normalizeEditText("Podcasts"), "Podcasts");
  assert.equal(normalizeEditText("Pod   casts"), "Pod casts");
  assert.equal(normalizeEditText("Pod\ncasts"), "Pod casts");
});

test("normalizeEditText trims leading and trailing whitespace", () => {
  assert.equal(normalizeEditText("  Podcasts  "), "Podcasts");
  assert.equal(normalizeEditText("\n  Podcasts\t"), "Podcasts");
});

test("editTextChanged is false when the normalized text is identical", () => {
  assert.equal(editTextChanged("Podcasts", "Podcasts"), false);
  assert.equal(editTextChanged("Podcasts", "  Podcasts  "), false);
  assert.equal(editTextChanged("Pod  casts", "Pod casts"), false);
});

test("editTextChanged is true when the normalized text differs", () => {
  assert.equal(editTextChanged("Podcasts", "Pods"), true);
  assert.equal(editTextChanged("Podcasts", "podcasts"), true);
});

test("editTextChanged treats a null or undefined previous value as a change", () => {
  assert.equal(editTextChanged(null, "Podcasts"), true);
  assert.equal(editTextChanged(undefined, "Podcasts"), true);
});

test("editTextChanged is false for a focus-then-blur with no typing (the bug this guards against)", () => {
  // Focusing a field and clicking away without editing must not be treated
  // as a change, or a stale sibling copy can silently overwrite a real edit.
  assert.equal(editTextChanged("Podcasts", "Podcasts"), false);
});
