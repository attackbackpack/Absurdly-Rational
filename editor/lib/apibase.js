// Resolves which API origin the editor talks to.
//
// `data-api` on <body> is the production source of truth and is committed
// pointing at the deployed Worker. That is fine for production, but it means
// running the editor locally against the dev stand-in (scripts/dev-editor-api.mjs)
// used to require hand-editing that attribute, rebuilding, testing, and then
// remembering to revert it before committing — miss the revert and production
// silently points at localhost. This module removes that step: when the page
// is being viewed on a local development host, the local stand-in's origin is
// used automatically and `data-api` is never touched.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEV_API_BASE = "http://localhost:8788";
const WRANGLER_DEV_API_BASE = "http://localhost:8787";

// Someone testing against the real Worker locally via `wrangler dev` (which
// listens on 8787, not the stand-in's 8788) can opt into that port with
// ?apiPort=8787 in the editor URL. This is deliberately not an arbitrary
// override: it only ever selects between the two known local Worker ports,
// and only once we've already established the page is on a local host, so it
// can't be used to redirect the editor to a third-party origin.
export function resolveApiBase(hostname, configuredBase, apiPort) {
  if (!LOCAL_HOSTS.has(hostname)) {
    return configuredBase;
  }
  return apiPort === "8787" ? WRANGLER_DEV_API_BASE : DEV_API_BASE;
}
