import { test } from "node:test";
import assert from "node:assert/strict";
import { isInternalHref } from "./links.js";

test("a root-relative path is internal", () => {
  assert.equal(isInternalHref("/readings.html"), true);
  assert.equal(isInternalHref("/preview/readings.html"), true);
  assert.equal(isInternalHref("/readings/policy.html"), true);
});

test("an absolute URL with a scheme is external", () => {
  assert.equal(isInternalHref("https://open.substack.com/x"), false);
  assert.equal(isInternalHref("http://example.com"), false);
  assert.equal(isInternalHref("mailto:hi@example.com"), false);
  assert.equal(isInternalHref("javascript:alert(1)"), false);
});

test("a protocol-relative URL is external", () => {
  assert.equal(isInternalHref("//evil.example/x"), false);
  assert.equal(isInternalHref("///evil.example/x"), false);
});

test("a backslash-disguised protocol-relative URL is external", () => {
  // Browsers normalize "\" to "/" in a URL, so these are protocol-relative too.
  assert.equal(isInternalHref("/\\evil.example/x"), false);
  assert.equal(isInternalHref("\\\\evil.example/x"), false);
});

test("an empty or non-string href is not internal", () => {
  assert.equal(isInternalHref(""), false);
  assert.equal(isInternalHref(null), false);
  assert.equal(isInternalHref(undefined), false);
});
