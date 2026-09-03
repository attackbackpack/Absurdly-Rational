import { normalizeEditText, editTextChanged } from "./editText.js";
import { isInternalHref, fragmentId } from "./links.js";
import { textRejection } from "./rules.js";

const OVERLAY_STYLE = `
[data-edit], [data-edit-image], [data-edit-meme] { outline-offset: 3px; cursor: text; }
[data-edit]:hover { outline: 2px dashed rgba(111,123,255,.9); }
[data-edit-image], [data-edit-meme] { cursor: pointer; }
[data-edit-image]:hover, [data-edit-meme]:hover { outline: 2px dashed rgba(111,123,255,.9); }
[data-edit]:focus { outline: 2px solid rgba(111,123,255,1); background: rgba(111,123,255,.08); }
/* An emptied field collapses to zero height and stops being clickable, so
   clearing text would otherwise be a one-way door: nothing left to click to
   put it back. Give every empty field a visible target and say what it is.
   The ::before box is generated content — it is not editable and never
   reaches node.textContent, so it cannot be committed to the draft. */
[data-edit]:empty { display: inline-block; min-width: 9ch; min-height: 1.2em; outline: 2px dashed rgba(111,123,255,.55); }
[data-edit]:empty::before { content: "Empty — click to type"; opacity: .6; font-size: .8em; font-weight: 400; font-style: normal; letter-spacing: normal; text-transform: none; white-space: nowrap; }
.ar-refusal { position: absolute; z-index: 2147483647; max-width: min(28rem, 80vw); padding: 10px 12px; border-radius: 10px; background: #2a1114; color: #ffdada; border: 1px solid #7a2b33; box-shadow: 0 8px 24px rgba(0,0,0,.35); font: 400 14px/1.45 system-ui, -apple-system, sans-serif; }
`;

/**
 * Repaint editable text from the current draft before wiring the page up.
 *
 * The iframe can still contain the previous deployed build for roughly a
 * minute after a successful publish. It can also load that older build when
 * the editor navigates between pages with unsaved work. The draft is the
 * current source of truth in both cases, so keep the editor from appearing to
 * undo a change that is either pending or already saved.
 */
export function renderDraftText(doc, draft) {
  for (const node of doc.querySelectorAll("[data-edit]")) {
    node.textContent = draft.read(node.dataset.edit);
  }
}

export function attachOverlay({ frame, draft, onDirty, onImageClick, onMemeClick, onNavigate }) {
  const doc = frame.contentDocument;
  renderDraftText(doc, draft);
  const style = doc.createElement("style");
  style.textContent = OVERLAY_STYLE;
  doc.head.appendChild(style);

  const listeners = [];
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };

  // A refused edit has to say why, next to the field that was refused — the
  // shell's status line is outside the iframe and easy to miss, and there is
  // no panel here to hang an .ar-problem on. One reused node: a second refusal
  // replaces the first rather than stacking.
  let refusal = null;
  let refusalTimer = null;
  const clearRefusal = () => {
    if (refusalTimer) frame.contentWindow.clearTimeout(refusalTimer);
    refusalTimer = null;
    if (refusal) refusal.remove();
  };
  const showRefusal = (node, message) => {
    clearRefusal();
    if (!refusal) {
      refusal = doc.createElement("div");
      refusal.className = "ar-refusal";
      refusal.setAttribute("role", "alert");
    }
    refusal.textContent = message;
    doc.body.appendChild(refusal);
    const box = node.getBoundingClientRect();
    const view = frame.contentWindow;
    refusal.style.top = `${box.bottom + view.scrollY + 8}px`;
    refusal.style.left = `${Math.max(8, box.left + view.scrollX)}px`;
    refusalTimer = view.setTimeout(clearRefusal, 8000);
  };

  // A click on a link always cancels the browser's own navigation — the shell
  // decides whether to follow it instead, so it can guard unsaved work first.
  // The [data-edit] check must run first: hero.cta_label, context.contact_label,
  // and every nav label are spans nested inside an <a>, and a click there is
  // meant to place a caret, not navigate.
  on(doc, "click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    if (event.target.closest("[data-edit]")) return;
    const href = link.getAttribute("href") || "";
    // A fragment (e.g. the homepage hero button's "#formats") names a spot on
    // this same document, not a page to load. Assigning it to frame.src would
    // resolve against the editor shell's own URL, not this document's, and
    // misnavigate the preview into the editor's own page — so it must never
    // reach onNavigate. Scroll to the match instead, and never prompt about
    // unsaved work for it, since nothing is being discarded.
    const id = fragmentId(href);
    if (id !== null) {
      const target = id && doc.getElementById(id);
      if (target) target.scrollIntoView();
      return;
    }
    if (!isInternalHref(href)) return;
    onNavigate(href);
  }, true);

  // The same field can render more than once on a page (e.g. the nav
  // appears in both the header and the footer). Group nodes by spec so a
  // committed write can be pushed into the other copies, keeping every
  // rendering of a field in sync with the draft.
  const nodesBySpec = new Map();
  for (const node of doc.querySelectorAll("[data-edit]")) {
    const spec = node.dataset.edit;
    if (!nodesBySpec.has(spec)) nodesBySpec.set(spec, []);
    nodesBySpec.get(spec).push(node);
  }

  for (const node of doc.querySelectorAll("[data-edit]")) {
    node.setAttribute("contenteditable", "plaintext-only");
    node.setAttribute("spellcheck", "true");

    // The text as it stood when this field was last entered. Escape restores
    // it; reading the draft back instead would return whatever the input
    // handler below has already written, which is the typing being abandoned.
    let textOnFocus = null;
    let abandoned = false;

    on(node, "focus", () => {
      textOnFocus = node.textContent;
      abandoned = false;
    });

    on(node, "input", () => {
      draft.write(node.dataset.edit, node.textContent);
      onDirty();
    });

    on(node, "paste", (event) => {
      event.preventDefault();
      const text = (event.clipboardData || frame.contentWindow.clipboardData).getData("text/plain");
      doc.execCommand("insertText", false, text.replace(/\s+/g, " "));
    });

    // A native drop into a plaintext-only region is not covered by the
    // plaintext-only spec (that text only governs paste), so it is not safe
    // to assume every engine strips markup on drop. Intercept it the same
    // way as paste: only ever insert text/plain.
    on(node, "dragover", (event) => {
      event.preventDefault();
    });

    on(node, "drop", (event) => {
      event.preventDefault();
      const text = event.dataTransfer && event.dataTransfer.getData("text/plain");
      if (!text) return;
      doc.execCommand("insertText", false, text.replace(/\s+/g, " "));
    });

    on(node, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        node.blur();
      }
      if (event.key === "Escape") {
        if (textOnFocus !== null) {
          abandoned = true;
          node.textContent = textOnFocus;
          draft.write(node.dataset.edit, textOnFocus);
        }
        node.blur();
        onDirty();
      }
    });

    on(node, "blur", () => {
      // Escape already restored and re-wrote the pre-edit text; letting the
      // normal blur path run would write the abandoned text straight back.
      if (abandoned) {
        abandoned = false;
        textOnFocus = null;
        return;
      }
      const text = normalizeEditText(node.textContent);
      node.textContent = text;
      // Focusing a field and leaving without typing must not write: with a
      // field rendered twice on a page (e.g. the nav in header and footer),
      // an unconditional write here would let a stale, untouched copy
      // silently revert an edit already committed through the other node.
      if (!editTextChanged(textOnFocus, text)) {
        textOnFocus = null;
        return;
      }
      // scripts/validate-content.js would reject some of what can be typed
      // here, and it runs on the owner's push — long after this editor said
      // "Saved." Refuse it now, next to the field, and put back what was
      // there. The input handler above has already written each keystroke
      // into the draft, so the restore has to undo that too.
      const rejection = textRejection(node.dataset.edit, text);
      if (rejection) {
        const restored = textOnFocus ?? "";
        node.textContent = restored;
        draft.write(node.dataset.edit, restored);
        textOnFocus = null;
        showRefusal(node, rejection);
        onDirty();
        return;
      }
      clearRefusal();
      textOnFocus = null;
      draft.write(node.dataset.edit, text);
      // Push the committed value into every other node sharing this spec so
      // the page stays coherent and the stale copy can't be re-committed
      // later. Never touch the node currently being edited, and skip any
      // node that currently has focus — reassigning its textContent would
      // move its caret mid-edit.
      for (const other of nodesBySpec.get(node.dataset.edit) || []) {
        if (other === node || other === doc.activeElement) continue;
        other.textContent = text;
      }
      onDirty();
    });
  }

  for (const node of doc.querySelectorAll("[data-edit-image]")) {
    on(node, "click", (event) => {
      // A nested [data-edit] node (e.g. a guest's art_label) already handles
      // its own click-to-edit; let the caret land there instead of stealing
      // the click into the image panel, which has no field for that text.
      if (event.target.closest("[data-edit]")) return;
      event.preventDefault();
      event.stopPropagation();
      onImageClick(node, node.dataset.editImage);
    });
  }

  for (const node of doc.querySelectorAll("[data-edit-meme]")) {
    on(node, "click", (event) => {
      // Same reasoning as the [data-edit-image] handler above: a nested
      // [data-edit] node (art.kicker / art.stamp) handles its own
      // click-to-edit, and openMemePanel has no field for that text.
      if (event.target.closest("[data-edit]")) return;
      event.preventDefault();
      event.stopPropagation();
      onMemeClick(node, node.dataset.editMeme);
    });
  }

  return {
    detach() {
      listeners.forEach((remove) => remove());
      clearRefusal();
      style.remove();
      doc.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
    }
  };
}
