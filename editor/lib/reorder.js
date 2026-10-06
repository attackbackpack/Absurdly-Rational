const REORDER_STYLE = `
[data-editor-reorder-active] [data-editor-reorder-key] { cursor: grab !important; user-select: none !important; animation: ar-reorder-wiggle 420ms ease-in-out infinite alternate; }
[data-editor-reorder-active] [data-editor-reorder-key]:hover { cursor: grab !important; }
.ar-reorder-handle { position: absolute; z-index: 2147483646; display: grid; width: 44px; height: 44px; place-items: center; padding: 0; border: 1px solid rgba(110,224,205,.8); border-radius: 10px; background: rgba(7,8,10,.92); color: #6ee0cd; cursor: grab; touch-action: none; }
.ar-reorder-handle:hover, .ar-reorder-handle[aria-pressed="true"] { background: #6ee0cd; color: #07080a; }
.ar-reorder-handle:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
.ar-reorder-handle svg { width: 19px; height: 19px; }
.ar-reorder-placeholder { border: 1px dashed rgba(110,224,205,.9) !important; border-radius: 12px !important; background: rgba(110,224,205,.08) !important; }
.ar-reorder-picked { outline: 2px solid #6ee0cd !important; outline-offset: 3px; z-index: 2147483645 !important; }
.ar-reorder-instructions { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0,0,0,0) !important; white-space: nowrap !important; border: 0 !important; }
@keyframes ar-reorder-wiggle { from { rotate: -.35deg; } to { rotate: .35deg; } }
@media (prefers-reduced-motion: reduce) {
  [data-editor-reorder-active] [data-editor-reorder-key] { animation: none !important; transition: none !important; }
}
`;
const POINTER_SWAP_OVERLAP = 2 / 3;
const POINTER_SWAP_REARM = 1 / 2;

function collectionItems(container, excluded = null) {
  return Array.from(container.children).filter(
    (node) => node.hasAttribute("data-editor-reorder-key") && node !== excluded
  );
}

function pinnedControl(container) {
  return Array.from(container.children).find((node) => node.hasAttribute("data-editor-meme-add")) || null;
}

function placeBeforePinned(container, node) {
  container.insertBefore(node, pinnedControl(container));
}

function collectionKeys(container) {
  return collectionItems(container).map((node) => node.dataset.editorReorderKey);
}

function updatePositionRoles(container, active = null) {
  const flowing = Array.from(container.children).filter((node) =>
    (node.hasAttribute("data-editor-reorder-key") && node !== active?.item) ||
    node.hasAttribute("data-editor-reorder-placeholder")
  );

  const slotCount = Number(container.dataset.editorReorderSlotCount || 0);
  if (slotCount > 0) {
    flowing.forEach((node, index) => {
      node.dataset.editorReorderSlot = String(index % slotCount);
    });
  }

  if (container.hasAttribute("data-editor-reorder-lead")) {
    const allCards = Array.from(container.children).filter(
      (node) => node.classList.contains("post-card")
    );
    allCards.forEach((node) => node.classList.toggle("post-card--lead", node === flowing[0]));
    allCards.forEach((node) => {
      const image = node.querySelector("img.image-object");
      if (!image) return;
      if (node === flowing[0]) {
        image.setAttribute("loading", "eager");
        image.setAttribute("fetchpriority", "high");
      } else {
        image.setAttribute("loading", "lazy");
        image.removeAttribute("fetchpriority");
      }
    });
  }
}

/** Repaint a rendered collection to match its current draft order. */
export function renderDraftOrder(doc, draft) {
  for (const container of doc.querySelectorAll("[data-editor-reorder-list]")) {
    let items;
    try {
      items = draft.read(container.dataset.editorReorderList);
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;

    const keyField = container.dataset.editorReorderKeyField || "key";
    const rank = new Map(items.map((item, index) => [String(item && item[keyField]), index]));
    const cards = collectionItems(container).filter((card) => rank.has(card.dataset.editorReorderKey));
    cards.sort((a, b) => rank.get(a.dataset.editorReorderKey) - rank.get(b.dataset.editorReorderKey));
    cards.forEach((card) => placeBeforePinned(container, card));
    updatePositionRoles(container);
  }

  let topics;
  try {
    topics = draft.read("readings:topics");
  } catch {
    topics = null;
  }
  if (!Array.isArray(topics)) return;

  const topicRank = new Map(topics.map((topic, index) => [String(topic.slug), index]));
  for (const nav of doc.querySelectorAll("[data-editor-topic-switcher]")) {
    const links = Array.from(nav.querySelectorAll("[data-editor-topic-slug]"));
    links.sort((a, b) =>
      (topicRank.get(a.dataset.editorTopicSlug) ?? Number.MAX_SAFE_INTEGER) -
      (topicRank.get(b.dataset.editorTopicSlug) ?? Number.MAX_SAFE_INTEGER)
    );
    links.forEach((link) => nav.appendChild(link));
  }
}

function sameOrder(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function snapshot(container, excluded = null) {
  const positions = new Map();
  for (const node of collectionItems(container, excluded)) positions.set(node, node.getBoundingClientRect());
  return positions;
}

function overlapRatio(first, second) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const smallerArea = Math.max(1, Math.min(first.width * first.height, second.width * second.height));
  return (width * height) / smallerArea;
}

function flowingItems(container, session) {
  return Array.from(container.children).filter((node) =>
    (node.hasAttribute("data-editor-reorder-key") && !(session?.type === "pointer" && node === session.item)) ||
    (session?.type === "pointer" && node === session.placeholder)
  );
}

function moveAnimations(container, before, excluded = null, animations = null, view = null, onAnimationEnd = null) {
  if (!before || view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  for (const node of collectionItems(container, excluded)) {
    const oldRect = before.get(node);
    if (!oldRect) continue;
    const rect = node.getBoundingClientRect();
    const x = oldRect.left - rect.left;
    const y = oldRect.top - rect.top;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
    try {
      const animation = node.animate(
        [{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }],
        { duration: 240, easing: "cubic-bezier(.16, 1, .3, 1)" }
      );
      if (animations) {
        animations.add(animation);
        const settle = () => {
          animations.delete(animation);
          if (onAnimationEnd) onAnimationEnd();
        };
        animation.onfinish = settle;
        animation.oncancel = settle;
      }
    } catch {
      // Older browsers still get the correct order and state without FLIP.
    }
  }
}

function reorderInfo(container) {
  return {
    spec: container.dataset.editorReorderList,
    keyField: container.dataset.editorReorderKeyField || "key",
    filterKey: container.dataset.editorReorderFilterKey || "",
    filterValue: container.dataset.editorReorderFilterValue || "",
    orderField: container.dataset.editorReorderOrderField || ""
  };
}

export function createReorderController({ doc, draft, onChange, onMessage }) {
  const view = doc.defaultView;
  const style = doc.createElement("style");
  style.textContent = REORDER_STYLE;
  doc.head.appendChild(style);

  const instructions = doc.createElement("p");
  instructions.className = "ar-reorder-instructions";
  instructions.textContent = "Press Space to pick up a card. Use the arrow keys to move it. Press Space to drop it or Escape to cancel.";
  instructions.id = "ar-reorder-instructions";
  instructions.setAttribute("aria-live", "polite");
  doc.body.appendChild(instructions);

  const listeners = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  const handles = new Map();
  const cardsByHandle = new Map();
  const editableValues = new Map();
  const animations = new Set();
  let enabled = false;
  let active = null;
  let layoutFrame = 0;
  let autoScrollFrame = 0;
  let detached = false;

  const announce = (message) => {
    instructions.textContent = message;
    if (enabled && onMessage) onMessage(message);
  };

  const cancelAnimations = () => {
    for (const animation of animations) animation.cancel();
    animations.clear();
  };

  const updateHandlePositions = () => {
    layoutFrame = 0;
    for (const [card, handle] of handles) {
      if (!card.isConnected || !enabled) continue;
      const rect = card.getBoundingClientRect();
      handle.style.left = `${rect.right - 48 + view.scrollX}px`;
      handle.style.top = `${rect.top + 8 + view.scrollY}px`;
    }
  };

  const scheduleHandlePositions = () => {
    if (!layoutFrame && enabled) layoutFrame = view.requestAnimationFrame(updateHandlePositions);
  };

  const createHandle = (card) => {
    const handle = doc.createElement("button");
    handle.type = "button";
    handle.className = "ar-reorder-handle";
    handle.setAttribute("aria-describedby", instructions.id);
    handle.setAttribute("aria-pressed", "false");
    handle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="4" r="1.5"/><circle cx="14" cy="4" r="1.5"/><circle cx="6" cy="10" r="1.5"/><circle cx="14" cy="10" r="1.5"/><circle cx="6" cy="16" r="1.5"/><circle cx="14" cy="16" r="1.5"/></g></svg>';
    const label = card.querySelector("[data-edit]")?.textContent?.trim() || card.getAttribute("aria-label") || card.getAttribute("title") || "card";
    handle.setAttribute("aria-label", `Move ${label}.`);
    doc.body.appendChild(handle);
    handles.set(card, handle);
    cardsByHandle.set(handle, card);
  };

  const alignHandleOrder = () => {
    const ordered = Array.from(doc.querySelectorAll("[data-editor-reorder-key]"))
      .map((card) => handles.get(card))
      .filter(Boolean);
    if (!ordered.length) return;

    const focused = ordered.includes(active?.handle)
      ? active.handle
      : ordered.includes(doc.activeElement)
        ? doc.activeElement
        : null;
    if (!focused) {
      ordered.forEach((handle) => doc.body.appendChild(handle));
      return;
    }

    const focusIndex = ordered.indexOf(focused);
    for (const handle of ordered.slice(0, focusIndex)) doc.body.insertBefore(handle, focused);
    const bodyChildren = Array.from(doc.body.children);
    const lastHandleIndex = bodyChildren.reduce(
      (last, node, index) => node.classList.contains("ar-reorder-handle") ? index : last,
      -1
    );
    const afterHandles = bodyChildren[lastHandleIndex + 1] || null;
    for (const handle of ordered.slice(focusIndex + 1)) doc.body.insertBefore(handle, afterHandles);
  };

  const refresh = () => {
    if (!enabled || detached) return;
    const current = new Set(doc.querySelectorAll("[data-editor-reorder-key]"));
    for (const [card, handle] of handles) {
      if (current.has(card)) continue;
      handle.remove();
      handles.delete(card);
      cardsByHandle.delete(handle);
    }
    for (const card of current) {
      const container = card.parentElement;
      if (!container?.hasAttribute("data-editor-reorder-list")) continue;
      if (collectionItems(container).length < 2 || handles.has(card)) continue;
      createHandle(card);
    }
    alignHandleOrder();
    if (layoutFrame) view.cancelAnimationFrame(layoutFrame);
    layoutFrame = 0;
    updateHandlePositions();
  };

  const setFieldsEditable = (allow) => {
    for (const card of doc.querySelectorAll("[data-editor-reorder-key]")) {
      for (const field of card.querySelectorAll("[data-edit]")) {
        if (allow) {
          if (editableValues.has(field)) {
            field.setAttribute("contenteditable", editableValues.get(field));
            editableValues.delete(field);
          }
        } else if (field.hasAttribute("contenteditable")) {
          editableValues.set(field, field.getAttribute("contenteditable"));
          field.removeAttribute("contenteditable");
        }
      }
    }
  };

  const toggleHandlesForSession = (pressed) => {
    for (const [card, handle] of handles) {
      handle.setAttribute("aria-pressed", pressed && active?.item === card ? "true" : "false");
      const dragging = active?.type === "pointer";
      handle.style.pointerEvents = dragging ? "none" : "auto";
      handle.style.opacity = dragging ? "0" : "1";
    }
  };

  const announcePosition = (session, action) => {
    const items = flowingItems(session.container, session);
    const index = items.indexOf(session.type === "pointer" ? session.placeholder : session.item);
    const nextStep = session.type === "pointer"
      ? "Release to drop or press Escape to cancel."
      : "Use arrow keys to move. Press Space to drop or Escape to cancel.";
    announce(`${action} ${session.label}. Position ${Math.max(1, index + 1)} of ${items.length}. ${nextStep}`);
  };

  const restoreStyle = (session) => {
    if (session.styleAttribute === null) session.item.removeAttribute("style");
    else session.item.setAttribute("style", session.styleAttribute);
    session.item.classList.remove("ar-reorder-picked");
  };

  const originalOrder = (session) => {
    for (const card of session.originalItems) placeBeforePinned(session.container, card);
    session.placeholder?.remove();
  };

  const commit = (session) => {
    const keys = collectionKeys(session.container);
    if (sameOrder(session.originalKeys, keys)) return false;
    const changed = draft.reorderCollection(reorderInfo(session.container).spec, {
      ...reorderInfo(session.container),
      keys
    });
    if (changed && onChange) onChange();
    return changed;
  };

  const stopAutoScroll = () => {
    if (!autoScrollFrame) return;
    view.cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = 0;
  };

  const finishPointer = (shouldCommit) => {
    if (!active || active.type !== "pointer") return;
    const session = active;
    stopAutoScroll();
    cancelAnimations();
    const before = snapshot(session.container, session.item);
    before.set(session.item, session.item.getBoundingClientRect());
    active = null;
    if (session.handle.hasPointerCapture?.(session.pointerId)) {
      try { session.handle.releasePointerCapture(session.pointerId); } catch {}
    }

    if (shouldCommit) {
      session.placeholder.replaceWith(session.item);
    } else {
      originalOrder(session);
    }
    restoreStyle(session);
    updatePositionRoles(session.container);
    toggleHandlesForSession(false);
    const changed = shouldCommit && commit(session);
    if (!changed && shouldCommit && !sameOrder(session.originalKeys, collectionKeys(session.container))) {
      originalOrder(session);
      updatePositionRoles(session.container);
    }
    moveAnimations(session.container, before, null, animations, view, scheduleHandlePositions);
    if (changed) {
      const items = collectionItems(session.container);
      announce(`Dropped ${session.label}. Position ${items.indexOf(session.item) + 1} of ${items.length}.`);
    } else {
      announce(shouldCommit ? `No change to ${session.label}.` : `Reorder cancelled. The original order is restored.`);
    }
    refresh();
  };

  const finishKeyboard = (shouldCommit) => {
    if (!active || active.type !== "keyboard") return;
    const session = active;
    cancelAnimations();
    active = null;
    session.item.classList.remove("ar-reorder-picked");
    session.handle.setAttribute("aria-pressed", "false");
    if (!shouldCommit) {
      const before = snapshot(session.container);
      originalOrder(session);
      updatePositionRoles(session.container);
      moveAnimations(session.container, before, null, animations, view, scheduleHandlePositions);
    }
    toggleHandlesForSession(false);
    const changed = shouldCommit && commit(session);
    if (changed) {
      const items = collectionItems(session.container);
      announce(`Dropped ${session.label}. Position ${items.indexOf(session.item) + 1} of ${items.length}.`);
    }
    else announce(shouldCommit ? `No change to ${session.label}.` : `Reorder cancelled. The original order is restored.`);
    refresh();
  };

  const cancelSession = () => {
    if (!active) return;
    if (active.type === "pointer") finishPointer(false);
    else finishKeyboard(false);
  };

  const setEnabled = (next) => {
    if (enabled === Boolean(next) || detached) return;
    if (!next) {
      cancelSession();
      enabled = false;
      cancelAnimations();
      if (layoutFrame) view.cancelAnimationFrame(layoutFrame);
      layoutFrame = 0;
      stopAutoScroll();
      for (const container of doc.querySelectorAll("[data-editor-reorder-list]")) {
        delete container.dataset.editorReorderActive;
      }
      for (const card of doc.querySelectorAll("[data-editor-reorder-key]")) {
        card.classList.remove("ar-reorder-picked");
      }
      for (const handle of handles.values()) handle.remove();
      handles.clear();
      cardsByHandle.clear();
      setFieldsEditable(true);
      if (onMessage) onMessage("");
      return;
    }

    enabled = true;
    for (const container of doc.querySelectorAll("[data-editor-reorder-list]")) {
      container.dataset.editorReorderActive = "true";
    }
    setFieldsEditable(false);
    refresh();
    announce("Drag a grip to move a card, or focus a grip and press Space, use the arrow keys, then press Space to drop. Press Escape to cancel.");
  };

  const beginKeyboard = (handle, item) => {
    const container = item.parentElement;
    const items = collectionItems(container);
    if (items.length < 2) return;
    active = {
      type: "keyboard",
      container,
      item,
      handle,
      originalItems: [...items],
      originalKeys: items.map((card) => card.dataset.editorReorderKey),
      label: handle.getAttribute("aria-label").replace(/^Move /, "").replace(/\.$/, "")
    };
    item.classList.add("ar-reorder-picked");
    toggleHandlesForSession(true);
    announcePosition(active, "Picked up");
  };

  const moveKeyboard = (delta) => {
    const session = active;
    const items = collectionItems(session.container);
    const index = items.indexOf(session.item);
    const nextIndex = Math.max(0, Math.min(items.length - 1, index + delta));
    if (nextIndex === index) {
      announcePosition(session, "At the edge:");
      return;
    }
    cancelAnimations();
    const before = snapshot(session.container);
    if (delta < 0) session.container.insertBefore(session.item, items[nextIndex]);
    else items[nextIndex].after(session.item);
    updatePositionRoles(session.container);
    moveAnimations(session.container, before, null, animations, view, scheduleHandlePositions);
    announcePosition(session, "Picked up");
    scheduleHandlePositions();
  };

  const rememberPointerLayout = (session) => {
    const bounds = snapshot(session.container, session.item);
    const pinned = pinnedControl(session.container);
    if (pinned) bounds.set(pinned, pinned.getBoundingClientRect());
    session.layoutBounds = bounds;
    session.layoutScrollX = view.scrollX;
    session.layoutScrollY = view.scrollY;
  };

  const pointerLayoutRect = (session, node) => {
    const rect = session.layoutBounds.get(node);
    if (!rect) return node.getBoundingClientRect();
    const x = session.layoutScrollX - view.scrollX;
    const y = session.layoutScrollY - view.scrollY;
    return {
      left: rect.left + x,
      right: rect.right + x,
      top: rect.top + y,
      bottom: rect.bottom + y,
      width: rect.width,
      height: rect.height
    };
  };

  const beginPointer = (event, handle, item) => {
    if (event.button !== undefined && event.button !== 0) return;
    const container = item.parentElement;
    const items = collectionItems(container);
    if (items.length < 2) return;
    const rect = item.getBoundingClientRect();
    const placeholder = item.cloneNode(false);
    placeholder.removeAttribute("data-editor-reorder-key");
    placeholder.removeAttribute("data-edit-meme");
    placeholder.removeAttribute("href");
    placeholder.dataset.editorReorderPlaceholder = "true";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.tabIndex = -1;
    placeholder.replaceChildren();
    placeholder.style.height = `${rect.height}px`;
    placeholder.style.minHeight = `${rect.height}px`;
    item.before(placeholder);

    const session = {
      type: "pointer",
      container,
      item,
      placeholder,
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      moved: false,
      originalItems: [...items],
      originalKeys: items.map((card) => card.dataset.editorReorderKey),
      blockedTargets: new Set(),
      styleAttribute: item.hasAttribute("style") ? item.getAttribute("style") : null,
      label: handle.getAttribute("aria-label").replace(/^Move /, "").replace(/\.$/, "")
    };
    active = session;
    item.classList.add("ar-reorder-picked");
    item.style.setProperty("position", "fixed", "important");
    item.style.setProperty("left", `${rect.left}px`, "important");
    item.style.setProperty("top", `${rect.top}px`, "important");
    item.style.setProperty("width", `${rect.width}px`, "important");
    item.style.setProperty("height", `${rect.height}px`, "important");
    item.style.setProperty("margin", "0", "important");
    item.style.setProperty("z-index", "2147483645", "important");
    item.style.setProperty("pointer-events", "none", "important");
    item.style.setProperty("transform", "none", "important");
    item.style.setProperty("transition", "none", "important");
    updatePositionRoles(container, session);
    rememberPointerLayout(session);
    toggleHandlesForSession(true);
    try { handle.setPointerCapture(event.pointerId); } catch {}
    announce(`Picked up ${session.label}. Drag to a new position. Release to drop or press Escape to cancel.`);
  };

  const movePlaceholder = (session, target) => {
    const current = flowingItems(session.container, session);
    const placeholderIndex = current.indexOf(session.placeholder);
    if (target.hasAttribute("data-editor-meme-add") && placeholderIndex === current.length - 1) return false;
    if (!target.hasAttribute("data-editor-meme-add") && current.indexOf(target) === -1) return false;

    const previousIndex = flowingItems(session.container, session).indexOf(session.placeholder);
    cancelAnimations();
    const currentBefore = snapshot(session.container, session.item);
    if (target.hasAttribute("data-editor-meme-add")) {
      session.container.insertBefore(session.placeholder, target);
    } else {
      const targetIndex = current.indexOf(target);
      if (targetIndex < placeholderIndex) target.before(session.placeholder);
      else target.after(session.placeholder);
    }
    updatePositionRoles(session.container, session);
    rememberPointerLayout(session);
    moveAnimations(session.container, currentBefore, session.item, animations, view, scheduleHandlePositions);
    scheduleHandlePositions();
    const nextIndex = flowingItems(session.container, session).indexOf(session.placeholder);
    if (nextIndex !== previousIndex) announcePosition(session, "Moving");
    return nextIndex !== previousIndex;
  };

  const updatePointerPosition = (session, x, y) => {
    session.item.style.setProperty("left", `${x - session.grabX}px`, "important");
    session.item.style.setProperty("top", `${y - session.grabY}px`, "important");
    const draggedRect = session.item.getBoundingClientRect();
    const targets = [...collectionItems(session.container, session.item), pinnedControl(session.container)].filter(Boolean);
    const overlaps = targets.map((target) => ({ target, ratio: overlapRatio(draggedRect, pointerLayoutRect(session, target)) }));

    for (const target of session.blockedTargets) {
      const overlap = overlaps.find((entry) => entry.target === target);
      if (!overlap || overlap.ratio <= POINTER_SWAP_REARM) session.blockedTargets.delete(target);
    }

    const candidate = overlaps
      .filter(({ target, ratio }) => ratio >= POINTER_SWAP_OVERLAP && !session.blockedTargets.has(target))
      .sort((first, second) => second.ratio - first.ratio)[0]?.target;
    if (!candidate) return;

    if (movePlaceholder(session, candidate)) session.blockedTargets.add(candidate);
  };

  const edgeScroll = (session) => {
    autoScrollFrame = 0;
    if (active !== session || session.type !== "pointer") return;
    const edge = 72;
    const y = session.lastY;
    let delta = 0;
    if (y < edge) delta = -Math.ceil((edge - y) / 6);
    else if (y > view.innerHeight - edge) delta = Math.ceil((y - (view.innerHeight - edge)) / 6);
    if (!delta) return;
    view.scrollBy(0, delta);
    updatePointerPosition(session, session.lastX, session.lastY);
    autoScrollFrame = view.requestAnimationFrame(() => edgeScroll(session));
  };

  const scheduleEdgeScroll = (session) => {
    const y = session.lastY;
    if (!autoScrollFrame && (y < 72 || y > view.innerHeight - 72)) {
      autoScrollFrame = view.requestAnimationFrame(() => edgeScroll(session));
    } else if (autoScrollFrame && y >= 72 && y <= view.innerHeight - 72) {
      stopAutoScroll();
    }
  };

  listen(doc, "pointerdown", (event) => {
    if (!enabled) return;
    const handle = event.target.closest?.(".ar-reorder-handle");
    if (handle) {
      const item = cardsByHandle.get(handle);
      if (!item) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (active) cancelSession();
      beginPointer(event, handle, item);
      return;
    }
    if (event.target.closest?.("[data-editor-reorder-key]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  listen(doc, "pointermove", (event) => {
    if (!active || active.type !== "pointer" || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    const session = active;
    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.moved && distance < 4) return;
    session.moved = true;
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    updatePointerPosition(session, session.lastX, session.lastY);
    scheduleEdgeScroll(session);
  }, true);

  listen(doc, "pointerup", (event) => {
    if (active?.type === "pointer" && event.pointerId === active.pointerId) finishPointer(true);
  }, true);
  listen(doc, "pointercancel", (event) => {
    if (active?.type === "pointer" && event.pointerId === active.pointerId) finishPointer(false);
  }, true);
  listen(doc, "lostpointercapture", (event) => {
    if (active?.type === "pointer" && event.pointerId === active.pointerId) finishPointer(false);
  }, true);

  listen(doc, "click", (event) => {
    if (!enabled) return;
    if (event.target.closest?.(".ar-reorder-handle")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.target.closest?.("[data-editor-reorder-key]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  listen(doc, "keydown", (event) => {
    if (!enabled) return;
    if (event.key === "Escape" && active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelSession();
      return;
    }
    const handle = event.target.closest?.(".ar-reorder-handle");
    if (!handle) return;
    const item = cardsByHandle.get(handle);
    if (!item) return;
    if (!active && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      beginKeyboard(handle, item);
      return;
    }
    if (active?.type !== "keyboard" || active.item !== item) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      finishKeyboard(true);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveKeyboard(-1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveKeyboard(1);
    }
  }, true);

  listen(view, "scroll", scheduleHandlePositions, true);
  listen(view, "resize", scheduleHandlePositions);
  listen(view, "blur", () => {
    if (active) cancelSession();
  });

  return {
    setEnabled,
    refresh,
    cancel: cancelSession,
    detach() {
      if (detached) return;
      if (active) cancelSession();
      setEnabled(false);
      detached = true;
      cancelAnimations();
      if (layoutFrame) view.cancelAnimationFrame(layoutFrame);
      layoutFrame = 0;
      listeners.forEach((remove) => remove());
      style.remove();
      instructions.remove();
    }
  };
}
