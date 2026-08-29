import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePreviewPath, DEFAULT_PREVIEW_PATH } from "./preview.js";

test("no ?preview= parameter falls back to the live homepage", () => {
  assert.equal(resolvePreviewPath(null), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath(undefined), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath(""), DEFAULT_PREVIEW_PATH);
});

test("a root-relative same-origin path is kept", () => {
  assert.equal(resolvePreviewPath("/readings.html"), "/readings.html");
  assert.equal(resolvePreviewPath("/index.html"), "/index.html");
  assert.equal(resolvePreviewPath("/podcasts.html"), "/podcasts.html");
});

test("an absolute cross-origin URL falls back to the default", () => {
  assert.equal(resolvePreviewPath("https://evil.example/x"), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath("http://evil.example/x"), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath("javascript:alert(1)"), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath("data:text/html,<h1>x</h1>"), DEFAULT_PREVIEW_PATH);
});

test("a protocol-relative URL falls back to the default", () => {
  // Starts with "/" and uses only allowed characters, but is cross-origin.
  assert.equal(resolvePreviewPath("//evil.example/x"), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath("///evil.example/x"), DEFAULT_PREVIEW_PATH);
});

test("a backslash-prefixed path falls back to the default", () => {
  // Browsers normalise "\" to "/" in URLs, so this is protocol-relative too.
  assert.equal(resolvePreviewPath("/\\evil.example/x"), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath("\\\\evil.example/x"), DEFAULT_PREVIEW_PATH);
});

test("a path that is not root-relative falls back to the default", () => {
  assert.equal(resolvePreviewPath("index.html"), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath("../index.html"), DEFAULT_PREVIEW_PATH);
});

test("a path carrying a query or fragment falls back to the default", () => {
  assert.equal(resolvePreviewPath("/index.html?x=1"), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath("/index.html#top"), DEFAULT_PREVIEW_PATH);
});

test("a non-string value falls back to the default", () => {
  assert.equal(resolvePreviewPath(42), DEFAULT_PREVIEW_PATH);
  assert.equal(resolvePreviewPath({}), DEFAULT_PREVIEW_PATH);
});
