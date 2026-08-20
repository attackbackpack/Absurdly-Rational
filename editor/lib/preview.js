export const DEFAULT_PREVIEW_PATH = "/preview/index.html";

// The value lands in iframe.src inside the trusted editor chrome, so it must be
// a root-relative same-origin path and nothing else.
//
// The leading (?!\/) is load-bearing: "//evil.example/x" starts with a slash and
// is made only of allowed characters, but it is a protocol-relative URL and
// would load a foreign page. Backslash is excluded for the same reason —
// browsers treat "\" as "/" in URLs, so "/\evil.example" is also cross-origin.
const SAME_ORIGIN_PATH = /^\/(?!\/)[A-Za-z0-9._/-]*$/;

export function resolvePreviewPath(raw) {
  return typeof raw === "string" && SAME_ORIGIN_PATH.test(raw) ? raw : DEFAULT_PREVIEW_PATH;
}
