// Pure text-normalization helpers shared by the overlay's blur handling.
// Kept separate from overlay.js (which is DOM-only) so this logic is
// testable without a DOM harness.

/**
 * Collapse internal whitespace runs to a single space and trim the ends.
 * This mirrors the normalization the overlay applies to a field's text
 * before committing it, so callers can compare like with like.
 */
export function normalizeEditText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

/**
 * Whether a field's text meaningfully changed between focus and blur, after
 * normalization. `previousText` may be null (no prior value captured); that
 * is treated as a change so the caller falls back to its normal write path.
 */
export function editTextChanged(previousText, currentText) {
  if (previousText === null || previousText === undefined) return true;
  return normalizeEditText(currentText) !== normalizeEditText(previousText);
}
