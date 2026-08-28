import { test } from "node:test";
import assert from "node:assert/strict";
import { isInternalHref, fragmentId } from "./links.js";

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

test("leading whitespace does not defeat the protocol-relative check", () => {
  // Browsers strip leading C0 controls/space before resolving a URL, so these
  // all resolve as "//evil.example" — protocol-relative and external.
  assert.equal(isInternalHref("  //evil.example"), false);
  assert.equal(isInternalHref("\t//evil.example"), false);
  assert.equal(isInternalHref("\n//evil.example"), false);
});

test("leading whitespace does not defeat the scheme check", () => {
  assert.equal(isInternalHref("  https://evil.example"), false);
  assert.equal(isInternalHref("\thttps://evil.example"), false);
  assert.equal(isInternalHref("\njavascript:alert(1)"), false);
});

test("a whitespace-only href is not internal", () => {
  assert.equal(isInternalHref("   "), false);
  assert.equal(isInternalHref("\t\n"), false);
});

test("a fragment href reports its target id", () => {
  assert.equal(fragmentId("#formats"), "formats");
  assert.equal(fragmentId("  #formats"), "formats");
  assert.equal(fragmentId("\t#formats"), "formats");
});

test("a bare fragment reports an empty id rather than null", () => {
  assert.equal(fragmentId("#"), "");
});

test("a non-fragment href is not a fragment", () => {
  assert.equal(fragmentId("/readings.html"), null);
  assert.equal(fragmentId("https://example.com#top"), null);
  assert.equal(fragmentId(""), null);
  assert.equal(fragmentId(null), null);
  assert.equal(fragmentId(undefined), null);
});
