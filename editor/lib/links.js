// A link inside the previewed page is safe for the editor to follow only if
// it stays on the site: nav, back-link, and topic-door hrefs are the
// root-relative paths Jekyll's relative_url filter writes (e.g.
// "/readings.html", or "/preview/readings.html" once the draft-preview build
// prefixes baseurl). Anything with a scheme (https:, mailto:, javascript:) or
// a protocol-relative "//" prefix leaves the site — that's how the Substack,
// Spotify, and LinkedIn links behave today, and clicking them must keep
// behaving that way once other links start navigating.
//
// Browsers treat "\" as "/" in a URL, so "/\evil.example" and
// "\\evil.example" are protocol-relative too, even though neither starts
// with a literal "//". Normalize backslashes before testing so a disguised
// host can't slip through as "internal".
const EXTERNAL_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function isInternalHref(href) {
  if (typeof href !== "string" || href === "") return false;
  const normalized = href.replace(/\\/g, "/");
  return !EXTERNAL_HREF.test(normalized);
}
