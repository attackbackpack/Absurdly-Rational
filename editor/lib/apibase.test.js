import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiBase } from "./apibase.js";

const PRODUCTION_BASE = "https://absurdly-rational-editor-api.workers.dev";

test("every local hostname form resolves to the dev stand-in API", () => {
  assert.equal(resolveApiBase("localhost", PRODUCTION_BASE), "http://localhost:8788");
  assert.equal(resolveApiBase("127.0.0.1", PRODUCTION_BASE), "http://localhost:8788");
  assert.equal(resolveApiBase("::1", PRODUCTION_BASE), "http://localhost:8788");
  assert.equal(resolveApiBase("[::1]", PRODUCTION_BASE), "http://localhost:8788");
});

test("a production hostname keeps the configured base unchanged", () => {
  assert.equal(
    resolveApiBase("absurdlyrational.com", PRODUCTION_BASE),
    PRODUCTION_BASE
  );
  assert.equal(
    resolveApiBase("www.absurdlyrational.com", PRODUCTION_BASE),
    PRODUCTION_BASE
  );
});

test("near-miss hostnames that merely contain 'localhost' are not treated as local", () => {
  assert.equal(
    resolveApiBase("localhost.evil.example", PRODUCTION_BASE),
    PRODUCTION_BASE
  );
  assert.equal(resolveApiBase("notlocalhost", PRODUCTION_BASE), PRODUCTION_BASE);
});

test("an empty or undefined configured base passes through unchanged on non-local hosts", () => {
  assert.equal(resolveApiBase("absurdlyrational.com", ""), "");
  assert.equal(resolveApiBase("absurdlyrational.com", undefined), undefined);
});

test("with no apiPort override, local hosts get the dev stand-in on 8788", () => {
  assert.equal(resolveApiBase("localhost", PRODUCTION_BASE, undefined), "http://localhost:8788");
});

test("?apiPort=8787 on a local host switches to the wrangler dev port", () => {
  assert.equal(resolveApiBase("localhost", PRODUCTION_BASE, "8787"), "http://localhost:8787");
  assert.equal(resolveApiBase("127.0.0.1", PRODUCTION_BASE, "8787"), "http://localhost:8787");
});

test("apiPort override is ignored on non-local hosts", () => {
  assert.equal(
    resolveApiBase("absurdlyrational.com", PRODUCTION_BASE, "8787"),
    PRODUCTION_BASE
  );
});

test("an apiPort value other than '8787' falls back to the stand-in port", () => {
  assert.equal(resolveApiBase("localhost", PRODUCTION_BASE, "9999"), "http://localhost:8788");
  assert.equal(resolveApiBase("localhost", PRODUCTION_BASE, ""), "http://localhost:8788");
});
