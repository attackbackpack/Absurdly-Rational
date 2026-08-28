import { parseSpec } from "./paths.js";

/**
 * The half of scripts/validate-content.js that the editor can now trip.
 *
 * draft.js already mirrors the upload limits with the same warning: anything
 * that passes in the editor and fails in the validator lands on the editor
 * branch and breaks the owner's CI on the very next push (the workflow runs on
 * `_data/**` with no branch filter). The father sees "Saved."; the owner sees a
 * red build he cannot trace back to anything.
 *
 * Every rule below is a deliberate mirror of a named check in
 * scripts/validate-content.js. It must never be STRICTER than the validator —
 * refusing an edit CI would have accepted is its own bug — so each one records
 * which check it copies.
 */

// Mirrors validateText: rejected in every string, anywhere in every data file.
const SCRIPT_CONTENT = /<\/?script\b|javascript:/i;

// Mirrors the internal-URL branch of validateUrl, character for character.
const INTERNAL_URL = /^(?:\/?[A-Za-z0-9][A-Za-z0-9._/-]*|\/[A-Za-z0-9][A-Za-z0-9._/-]*)$/;

/**
 * Spec shapes the validator requires to be a non-empty, non-blank string, and
 * that the editor can now write. Keyed by specShape() so the rule holds however
 * a template happens to address the item ([key=…], [url=…], [index=…]).
 *
 * Deliberately NOT here, because the validator does not require them either:
 * - readings.posts[].subtitle and memes.items[].caption — checked for `typeof
 *   string` only, so "" passes CI.
 * - site.home.hero.cta_url and readings.page.archive_url — validateLinks only
 *   matches keys literally named "url" or "linkedin", so these two are never
 *   URL-checked at all.
 */
const REQUIRED_TEXT = new Map([
  [
    "readings:posts[].title",
    "Every reading needs a title, so this cannot be left blank. The previous title has been put back — type over it to change it."
  ],
  [
    "memes:items[].title",
    "Every meme needs a title, so this cannot be left blank. The previous title has been put back — type over it to change it."
  ]
]);

/**
 * A spec with its item selectors flattened: "readings:posts[url=x].title" and
 * "readings:posts[index=0].title" both become "readings:posts[].title".
 */
export function specShape(spec) {
  const { file, segments } = parseSpec(spec);
  let path = "";
  for (const segment of segments) {
    if (segment.kind === "key") path += path ? `.${segment.name}` : segment.name;
    else path += "[]";
  }
  return `${file}:${path}`;
}

function leafKey(spec) {
  const { segments } = parseSpec(spec);
  const last = segments[segments.length - 1];
  return last && last.kind === "key" ? last.name : "";
}

/**
 * Why this value would fail validateUrl, in words for the person typing it, or
 * null when it would pass. Mirrors validateUrl's order of checks so the first
 * thing the editor complains about is the first thing CI would have.
 */
export function urlRejection(value) {
  const text = typeof value === "string" ? value : "";
  if (!text.trim()) {
    return "A link cannot be left empty. Paste the web address it should open, starting with https://.";
  }
  if (text.startsWith("#")) {
    return null;
  }
  if (!text.includes("://")) {
    return INTERNAL_URL.test(text)
      ? null
      : `“${text}” is not an address this site can use. Paste the whole web address, starting with https://.`;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return `“${text}” is not a web address. Copy it again from the address bar — it should start with https://.`;
  }
  if (url.protocol !== "https:") {
    return "Web addresses here have to start with https:// — an http:// address will not be published.";
  }
  if (/[\s<>]/.test(text)) {
    return "That address has a space or a stray < or > in it. Copy it again from the address bar.";
  }
  return null;
}

/**
 * Why writing `value` at `spec` would fail the validator, or null when it is
 * fine. One entry point for every text write the editor makes — inline
 * click-to-edit and panel fields alike — so there is a single place mirroring
 * scripts/validate-content.js.
 */
export function textRejection(spec, value) {
  const text = typeof value === "string" ? value : "";
  if (SCRIPT_CONTENT.test(text)) {
    return "That text contains “<script” or “javascript:”, which the site refuses to publish. Take that part out and it will save.";
  }
  const leaf = leafKey(spec);
  if (leaf === "url" || leaf === "linkedin") {
    return urlRejection(text);
  }
  const required = REQUIRED_TEXT.get(specShape(spec));
  if (required && !text.trim()) {
    return required;
  }
  return null;
}

/**
 * Mirrors validateImage's alt-text gate: alt is required only once the image
 * has a path, and only when the data does not mark the image decorative.
 * `decorative` here is the panel's combined view (template intent OR data).
 *
 * Omit `path` to ask about an image that is ABOUT to get one — that is the
 * question the file picker needs answered before it stages an upload.
 */
export function altRejection({ alt, path, decorative }) {
  if (decorative) return null;
  if (typeof path === "string" && !path) return null;
  if (typeof alt === "string" && alt.trim()) return null;
  return "This picture needs a short description first — a few words saying what is in it, for people who cannot see it.";
}
