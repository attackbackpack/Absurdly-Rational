const OVERLAY_STYLE = `
[data-edit], [data-edit-image] { outline-offset: 3px; cursor: text; }
[data-edit]:hover { outline: 2px dashed rgba(111,123,255,.9); }
[data-edit-image] { cursor: pointer; }
[data-edit-image]:hover { outline: 2px dashed rgba(111,123,255,.9); }
[data-edit][contenteditable="plaintext-only"] { outline: 2px solid rgba(111,123,255,1); background: rgba(111,123,255,.08); }
`;

export function attachOverlay({ frame, draft, onDirty, onImageClick }) {
  const doc = frame.contentDocument;
  const style = doc.createElement("style");
  style.textContent = OVERLAY_STYLE;
  doc.head.appendChild(style);

  const listeners = [];
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };

  // Links must not navigate while editing.
  on(doc, "click", (event) => {
    const link = event.target.closest("a");
    if (link) event.preventDefault();
  }, true);

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
      const text = node.textContent.replace(/\s+/g, " ").trim();
      node.textContent = text;
      draft.write(node.dataset.edit, text);
      onDirty();
    });
  }

  for (const node of doc.querySelectorAll("[data-edit-image]")) {
    on(node, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onImageClick(node, node.dataset.editImage);
    });
  }

  return {
    detach() {
      listeners.forEach((remove) => remove());
      style.remove();
      doc.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
    }
  };
}
