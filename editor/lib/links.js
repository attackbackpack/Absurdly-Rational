// A link inside the previewed page is safe for the editor to follow only if
// it stays on the site: nav, back-link, and topic-door hrefs are the
// root-relative paths Jekyll's relative_url filter writes (e.g.
// "/readings.html"). Anything with a scheme (https:, mailto:, javascript:) or
// a protocol-relative "//" prefix leaves the site — that's how the Substack,
// Spotify, and LinkedIn links behave today, and clicking them must keep
// behaving that way once other links start navigating.
//
// Browsers strip leading C0 control characters and spaces (WHATWG URL spec)
// before resolving a URL, so " //evil.example" and "\t//evil.example" are
// protocol-relative too, even though the raw string doesn't start with "//".
// Strip that leading trivia before testing.
//
// Browsers also treat "\" as "/" in a URL, so "/\evil.example" and
// "\\evil.example" are protocol-relative too, even though neither starts
// with a literal "//". Normalize backslashes before testing so a disguised
// host can't slip through as "internal".
const LEADING_TRIVIA = /^[\x00-\x20]+/;
const EXTERNAL_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function stripLeadingTrivia(href) {
  return href.replace(LEADING_TRIVIA, "");
}

export function isInternalHref(href) {
  if (typeof href !== "string") return false;
  const normalized = stripLeadingTrivia(href).replace(/\\/g, "/");
  if (normalized === "") return false;
  return !EXTERNAL_HREF.test(normalized);
}

// A fragment-only href (e.g. the homepage's hero button, "#formats") names a
// spot on the SAME document, not a page to load. Assigning it to iframe.src
// would resolve against the *parent* editor shell's URL, not the iframe's
// current document, misnavigating the preview into the editor's own page —
// so it must never reach isInternalHref/onNavigate at all. Returns the id to
// scroll to (possibly "" for a bare "#"), or null if href is not a fragment.
export function fragmentId(href) {
  if (typeof href !== "string") return null;
  const trimmed = stripLeadingTrivia(href);
  return trimmed.startsWith("#") ? trimmed.slice(1) : null;
}
