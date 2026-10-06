import { test } from "node:test";
import assert from "node:assert/strict";
import { createDraft } from "./draft.js";
import { createReorderController, renderDraftOrder } from "./reorder.js";

const data = () => ({
  site: { home: { formats: [{ key: "alpha", title: "Alpha" }, { key: "bravo", title: "Bravo" }, { key: "charlie", title: "Charlie" }] } },
  readings: {},
  podcasts: {},
  memes: {}
});

const dataName = (name) => `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

class FakeClassList {
  constructor(node) { this.node = node; }
  values() { return new Set((this.node.className || "").split(/\s+/).filter(Boolean)); }
  add(name) { const values = this.values(); values.add(name); this.node.className = [...values].join(" "); }
  remove(name) { const values = this.values(); values.delete(name); this.node.className = [...values].join(" "); }
  contains(name) { return this.values().has(name); }
  toggle(name, force) {
    const add = force === undefined ? !this.contains(name) : Boolean(force);
    if (add) this.add(name); else this.remove(name);
    return add;
  }
}

class FakeStyle {
  setProperty(name, value) { this[name] = value; }
}

class FakeAnimation {
  constructor(node, frames) {
    this.node = node;
    const offset = frames[0].transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    node.animationOffset = offset ? { x: Number(offset[1]), y: Number(offset[2]) } : null;
  }
  finish() {
    this.node.animationOffset = null;
    this.onfinish?.();
  }
  cancel() {
    this.node.animationOffset = null;
    this.oncancel?.();
  }
}

class FakeElement {
  constructor(tagName = "div", ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.style = new FakeStyle();
    this.content = "";
    this.dataset = new Proxy({}, {
      get: (_target, key) => this.getAttribute(dataName(String(key))) ?? undefined,
      set: (_target, key, value) => { this.setAttribute(dataName(String(key)), String(value)); return true; },
      deleteProperty: (_target, key) => { this.removeAttribute(dataName(String(key))); return true; }
    });
  }
  get isConnected() {
    let node = this;
    while (node.parentElement) node = node.parentElement;
    return node === this.ownerDocument?.body || node === this.ownerDocument?.head;
  }
  get textContent() { return this.content + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.content = String(value); this.replaceChildren(); }
  set innerHTML(value) { this.content = String(value); }
  get innerHTML() { return this.content; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, before) {
    if (node.parentElement) node.remove();
    const index = before === null ? this.children.length : this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentElement = this;
    node.ownerDocument ||= this.ownerDocument;
    return node;
  }
  before(node) { this.parentElement?.insertBefore(node, this); }
  after(node) {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    this.parentElement.insertBefore(node, siblings[siblings.indexOf(this) + 1] || null);
  }
  replaceWith(node) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    parent.insertBefore(node, this);
    this.remove();
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const node of nodes) this.appendChild(node);
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
    if (name === "id") this.id = String(value);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "class") this.className = "";
    if (name === "style") this.style = new FakeStyle();
  }
  matches(selector) {
    return selector.split(",").some((part) => {
      const token = part.trim();
      if (token.startsWith(".")) return this.classList.contains(token.slice(1));
      const classMatch = token.match(/^([a-z]+)?\.([\w-]+)$/i);
      if (classMatch) return (!classMatch[1] || this.tagName.toLowerCase() === classMatch[1]) && this.classList.contains(classMatch[2]);
      const attrMatch = token.match(/^\[([^\]]+)\]$/);
      if (attrMatch) return this.hasAttribute(attrMatch[1]);
      return this.tagName.toLowerCase() === token.toLowerCase();
    });
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector) { return this.descendants().filter((node) => node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() {
    const index = this.parentElement?.children.indexOf(this) ?? 0;
    const fixed = this.style.position === "fixed";
    const left = fixed ? Number.parseFloat(this.style.left) : 100;
    const top = fixed ? Number.parseFloat(this.style.top) : 100 + index * 100;
    const x = this.animationOffset?.x || 0;
    const y = this.animationOffset?.y || 0;
    return { left: left + x, right: left + x + 200, top: top + y, bottom: top + y + 80, width: 200, height: 80 };
  }
  cloneNode() {
    const clone = new FakeElement(this.tagName, this.ownerDocument);
    for (const [name, value] of this.attributes) clone.setAttribute(name, value);
    clone.content = this.content;
    return clone;
  }
  animate(frames) {
    const animation = new FakeAnimation(this, frames);
    this.animations ||= [];
    this.animations.push(animation);
    return animation;
  }
  setPointerCapture() { this.hasCapture = true; }
  hasPointerCapture() { return this.hasCapture; }
  releasePointerCapture() { this.hasCapture = false; }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.viewListeners = new Map();
    this.activeElement = null;
    this.frames = new Map();
    this.nextFrame = 1;
    this.scrolls = [];
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.defaultView = {
      innerWidth: 900,
      innerHeight: 600,
      scrollX: 0,
      scrollY: 0,
      addEventListener: (type, handler) => {
        const list = this.viewListeners.get(type) || [];
        list.push(handler);
        this.viewListeners.set(type, list);
      },
      removeEventListener: (type, handler) => this.viewListeners.set(type, (this.viewListeners.get(type) || []).filter((entry) => entry !== handler)),
      matchMedia: () => ({ matches: false }),
      getComputedStyle: () => ({ gridColumn: "auto", gridRow: "auto" }),
      requestAnimationFrame: (callback) => {
        const id = this.nextFrame++;
        this.frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id) => this.frames.delete(id),
      scrollBy: (_x, y) => { this.scrolls.push(y); this.defaultView.scrollY += y; }
    };
  }
  createElement(tag) { return new FakeElement(tag, this); }
  querySelectorAll(selector) { return [...this.head.querySelectorAll(selector), ...this.body.querySelectorAll(selector)]; }
  elementFromPoint() { return this.hitTarget || null; }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== handler)); }
  dispatch(type, event) {
    event.target ||= this.body;
    event.preventDefault ||= () => {};
    event.stopImmediatePropagation ||= () => {};
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
  flushFrame() {
    const first = this.frames.entries().next().value;
    if (!first) return;
    this.frames.delete(first[0]);
    first[1]();
  }
}

function fixture(items = data().site.home.formats) {
  const contents = data();
  contents.site.home.formats = items;
  const doc = new FakeDocument();
  const list = doc.createElement("div");
  list.dataset.editorReorderList = "site:home.formats";
  list.dataset.editorReorderKeyField = "key";
  doc.body.appendChild(list);
  for (const { key, title } of items) {
    const card = doc.createElement("a");
    card.dataset.editorReorderKey = key;
    const field = doc.createElement("span");
    field.dataset.edit = `site:home.formats[key=${key}].title`;
    field.textContent = title;
    card.appendChild(field);
    list.appendChild(card);
  }
  return { doc, list, draft: createDraft(contents, "base") };
}

function setCardRect(card, { left, top, width, height }) {
  card.getBoundingClientRect = () => {
    const rectLeft = (card.style.position === "fixed" ? Number.parseFloat(card.style.left) : left) + (card.animationOffset?.x || 0);
    const rectTop = (card.style.position === "fixed" ? Number.parseFloat(card.style.top) : top) + (card.animationOffset?.y || 0);
    return {
      left: rectLeft,
      top: rectTop,
      right: rectLeft + width,
      bottom: rectTop + height,
      width,
      height
    };
  };
}

function key(doc, handle, value) {
  doc.dispatch("keydown", { target: handle, key: value });
}

function handles(doc) { return doc.body.querySelectorAll(".ar-reorder-handle"); }
function previewKeys(list, draggedKey) {
  return list.children.flatMap((node) => {
    if (node.hasAttribute("data-editor-reorder-placeholder")) return [draggedKey];
    if (node.dataset.editorReorderKey === draggedKey && node.classList.contains("ar-reorder-picked")) return [];
    return node.dataset.editorReorderKey ? [node.dataset.editorReorderKey] : [];
  });
}

test("keyboard drop persists a move and restores all grip affordances", () => {
  const { doc, list, draft } = fixture();
  let changes = 0;
  const controller = createReorderController({ doc, draft, onChange: () => changes++ });
  controller.setEnabled(true);
  const handle = handles(doc)[0];
  doc.activeElement = handle;
  key(doc, handle, " ");
  key(doc, handle, "ArrowDown");
  key(doc, handle, " ");

  assert.deepEqual(list.children.map((node) => node.dataset.editorReorderKey), ["bravo", "alpha", "charlie"]);
  assert.deepEqual(draft.read("site:home.formats").map((item) => item.key), ["bravo", "alpha", "charlie"]);
  assert.equal(changes, 1);
  assert.ok(handles(doc).every((grip) => grip.style.opacity === "1" && grip.style.pointerEvents === "auto"));
  assert.deepEqual(handles(doc).map((grip) => grip.getAttribute("aria-label")), ["Move Bravo.", "Move Alpha.", "Move Charlie."]);
  assert.equal(doc.activeElement, handle);
  controller.detach();
});

test("regression: mostly covering a card swaps it even when the grip is outside that card", () => {
  const { doc, list, draft } = fixture();
  list.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900 });
  setCardRect(list.children[0], { left: 15, top: 400, width: 363, height: 220 });
  setCardRect(list.children[1], { left: 400, top: 400, width: 363, height: 220 });
  setCardRect(list.children[2], { left: 785, top: 400, width: 363, height: 220 });
  const controller = createReorderController({ doc, draft });
  controller.setEnabled(true);
  const handle = handles(doc)[1];
  doc.dispatch("pointerdown", { target: handle, button: 0, pointerId: 21, clientX: 790, clientY: 443 });
  // The dragged 363×220 card now covers 98% of alpha, while the grip hotspot
  // sits to alpha's right in the gap. The prior midpoint targeting kept it put.
  doc.dispatch("pointermove", { target: doc.body, pointerId: 21, clientX: 412, clientY: 443 });
  doc.dispatch("pointerup", { target: doc.body, pointerId: 21 });

  assert.deepEqual(list.children.map((node) => node.dataset.editorReorderKey), ["bravo", "alpha", "charlie"]);
  assert.deepEqual(draft.read("site:home.formats").map((item) => item.key), ["bravo", "alpha", "charlie"]);
  controller.detach();
});

test("pointer swap threshold is two-thirds of the smaller card footprint", () => {
  const makeFixture = () => {
    const { doc, list, draft } = fixture();
    setCardRect(list.children[0], { left: 0, top: 100, width: 100, height: 100 });
    setCardRect(list.children[1], { left: 100, top: 100, width: 100, height: 100 });
    setCardRect(list.children[2], { left: 500, top: 100, width: 100, height: 100 });
    const controller = createReorderController({ doc, draft });
    controller.setEnabled(true);
    const handle = handles(doc)[1];
    doc.dispatch("pointerdown", { target: handle, button: 0, pointerId: 31, clientX: 190, clientY: 150 });
    return { doc, list, draft, controller };
  };

  const below = makeFixture();
  below.doc.dispatch("pointermove", { target: below.doc.body, pointerId: 31, clientX: 124, clientY: 150 });
  below.doc.dispatch("pointerup", { target: below.doc.body, pointerId: 31 });
  assert.deepEqual(below.list.children.map((node) => node.dataset.editorReorderKey), ["alpha", "bravo", "charlie"]);
  assert.equal(below.draft.isDirty(), false);
  below.controller.detach();

  const above = makeFixture();
  above.doc.dispatch("pointermove", { target: above.doc.body, pointerId: 31, clientX: 123, clientY: 150 });
  above.doc.dispatch("pointerup", { target: above.doc.body, pointerId: 31 });
  assert.deepEqual(above.list.children.map((node) => node.dataset.editorReorderKey), ["bravo", "alpha", "charlie"]);
  assert.deepEqual(above.draft.read("site:home.formats").map((item) => item.key), ["bravo", "alpha", "charlie"]);
  const saved = JSON.parse(Buffer.from(above.draft.buildPayload("reorder").files[0].contentBase64, "base64").toString("utf8"));
  assert.deepEqual(saved.home.formats.map((item) => item.key), ["bravo", "alpha", "charlie"]);
  above.controller.detach();
});

test("overlap is normalized to the smaller footprint for different-size cards", () => {
  const wideActive = fixture();
  setCardRect(wideActive.list.children[0], { left: 100, top: 100, width: 100, height: 100 });
  setCardRect(wideActive.list.children[1], { left: 200, top: 100, width: 200, height: 100 });
  setCardRect(wideActive.list.children[2], { left: 500, top: 100, width: 100, height: 100 });
  const firstController = createReorderController({ doc: wideActive.doc, draft: wideActive.draft });
  firstController.setEnabled(true);
  wideActive.doc.dispatch("pointerdown", { target: handles(wideActive.doc)[1], button: 0, pointerId: 32, clientX: 290, clientY: 150 });
  // The wide dragged card overlaps only half its own area, but fully covers
  // the smaller target, which is the footprint used for the threshold.
  wideActive.doc.dispatch("pointermove", { target: wideActive.doc.body, pointerId: 32, clientX: 190, clientY: 150 });
  wideActive.doc.dispatch("pointerup", { target: wideActive.doc.body, pointerId: 32 });
  assert.deepEqual(wideActive.list.children.map((node) => node.dataset.editorReorderKey), ["bravo", "alpha", "charlie"]);
  firstController.detach();

  const smallActive = fixture();
  setCardRect(smallActive.list.children[0], { left: 0, top: 100, width: 200, height: 100 });
  setCardRect(smallActive.list.children[1], { left: 200, top: 100, width: 100, height: 100 });
  setCardRect(smallActive.list.children[2], { left: 500, top: 100, width: 100, height: 100 });
  const secondController = createReorderController({ doc: smallActive.doc, draft: smallActive.draft });
  secondController.setEnabled(true);
  smallActive.doc.dispatch("pointerdown", { target: handles(smallActive.doc)[1], button: 0, pointerId: 33, clientX: 290, clientY: 150 });
  // A 70% overlap of the small dragged card is enough, even though that is
  // only 35% of the wider target's area.
  smallActive.doc.dispatch("pointermove", { target: smallActive.doc.body, pointerId: 33, clientX: 220, clientY: 150 });
  smallActive.doc.dispatch("pointerup", { target: smallActive.doc.body, pointerId: 33 });
  assert.deepEqual(smallActive.list.children.map((node) => node.dataset.editorReorderKey), ["bravo", "alpha", "charlie"]);
  secondController.detach();
});

test("left and upward full-card overlap swaps in a single column without oscillating and allows backtracking", () => {
  const { doc, list, draft } = fixture();
  setCardRect(list.children[0], { left: 40, top: 80, width: 100, height: 100 });
  setCardRect(list.children[1], { left: 40, top: 240, width: 100, height: 100 });
  setCardRect(list.children[2], { left: 40, top: 400, width: 100, height: 100 });
  const controller = createReorderController({ doc, draft });
  controller.setEnabled(true);
  const charlieHandle = handles(doc)[2];
  doc.dispatch("pointerdown", { target: charlieHandle, button: 0, pointerId: 34, clientX: 90, clientY: 450 });
  doc.dispatch("pointermove", { target: doc.body, pointerId: 34, clientX: 90, clientY: 130 });
  assert.deepEqual(previewKeys(list, "charlie"), ["charlie", "alpha", "bravo"]);

  // Repeated positions over the same card stay in place while its FLIP
  // animation is running; moving away rearms that target for a return path.
  doc.dispatch("pointermove", { target: doc.body, pointerId: 34, clientX: 90, clientY: 130 });
  doc.dispatch("pointermove", { target: doc.body, pointerId: 34, clientX: 90, clientY: 130 });
  assert.deepEqual(previewKeys(list, "charlie"), ["charlie", "alpha", "bravo"]);
  doc.dispatch("pointermove", { target: doc.body, pointerId: 34, clientX: 290, clientY: 290 });
  doc.dispatch("pointermove", { target: doc.body, pointerId: 34, clientX: 90, clientY: 290 });
  assert.deepEqual(previewKeys(list, "charlie"), ["alpha", "bravo", "charlie"]);
  doc.dispatch("pointerup", { target: doc.body, pointerId: 34 });

  assert.deepEqual(list.children.map((node) => node.dataset.editorReorderKey), ["alpha", "bravo", "charlie"]);
  assert.equal(draft.isDirty(), false);
  controller.detach();
});

test("Escape restores a keyboard move without dirtying the draft", () => {
  const { doc, list, draft } = fixture();
  const controller = createReorderController({ doc, draft });
  controller.setEnabled(true);
  const handle = handles(doc)[0];
  key(doc, handle, " ");
  key(doc, handle, "ArrowDown");
  key(doc, handle, "Escape");

  assert.deepEqual(list.children.map((node) => node.dataset.editorReorderKey), ["alpha", "bravo", "charlie"]);
  assert.equal(draft.isDirty(), false);
  assert.ok(list.children.every((card) => !card.classList.contains("ar-reorder-picked")));
  assert.ok(handles(doc).every((grip) => grip.style.opacity === "1" && grip.style.pointerEvents === "auto"));
  controller.detach();
});

test("leaving reorder mode cancels a pending keyboard pickup", () => {
  const { doc, list, draft } = fixture();
  const controller = createReorderController({ doc, draft });
  controller.setEnabled(true);
  const handle = handles(doc)[0];
  key(doc, handle, " ");
  key(doc, handle, "ArrowDown");
  controller.setEnabled(false);

  assert.deepEqual(list.children.map((node) => node.dataset.editorReorderKey), ["alpha", "bravo", "charlie"]);
  assert.equal(draft.isDirty(), false);
  assert.equal(handles(doc).length, 0);
  assert.ok(list.children.every((card) => !card.classList.contains("ar-reorder-picked")));
  assert.equal(list.hasAttribute("data-editor-reorder-active"), false);
  controller.detach();
});

test("pointer cancellation restores order and auto-scroll stops with the drag", () => {
  const { doc, list, draft } = fixture();
  list.dataset.editorReorderSlotCount = "2";
  const messages = [];
  const controller = createReorderController({ doc, draft, onMessage: (message) => messages.push(message) });
  controller.setEnabled(true);
  const grips = handles(doc);
  const handle = grips[0];
  const thirdCard = list.children[2];
  setCardRect(thirdCard, { left: 100, top: 560, width: 200, height: 80 });
  doc.hitTarget = thirdCard;
  doc.dispatch("pointerdown", { target: handle, button: 0, pointerId: 9, clientX: 110, clientY: 110 });
  doc.dispatch("pointermove", { target: doc.body, pointerId: 9, clientX: 150, clientY: 570 });

  assert.ok(messages.some((message) => message.includes("Moving Alpha. Position 3 of 3.")));
  const placeholder = list.querySelector("[data-editor-reorder-placeholder]");
  assert.equal(placeholder.dataset.editorReorderSlot, "0");
  assert.equal(placeholder.style.gridColumn, undefined);
  assert.equal(messages.some((message) => message.includes("https://")), false);
  doc.flushFrame();
  doc.flushFrame();
  assert.ok(doc.scrolls.length > 0);
  assert.ok([...doc.frames.values()].length > 0);
  doc.dispatch("pointercancel", { target: doc.body, pointerId: 9 });

  assert.deepEqual(list.children.map((node) => node.dataset.editorReorderKey), ["alpha", "bravo", "charlie"]);
  assert.equal(draft.isDirty(), false);
  assert.equal(list.querySelector("[data-editor-reorder-placeholder]"), null);
  assert.equal(list.children[0].getAttribute("style"), null);
  assert.equal(doc.scrolls.length > 0, true);
  controller.detach();
  assert.equal(doc.frames.size, 0, `left frame ids: ${[...doc.frames.keys()]}`);
});

test("a pointer press and release without moving leaves the draft clean", () => {
  const { doc, list, draft } = fixture();
  const controller = createReorderController({ doc, draft });
  controller.setEnabled(true);
  const handle = handles(doc)[0];
  doc.dispatch("pointerdown", { target: handle, button: 0, pointerId: 4, clientX: 110, clientY: 110 });
  doc.dispatch("pointerup", { target: doc.body, pointerId: 4 });

  assert.deepEqual(list.children.map((node) => node.dataset.editorReorderKey), ["alpha", "bravo", "charlie"]);
  assert.equal(draft.isDirty(), false);
  assert.equal(list.querySelector("[data-editor-reorder-placeholder]"), null);
  assert.equal(list.children[0].getAttribute("style"), null);
  controller.detach();
});

test("FLIP completion repositions a grip at its card's settled corner", () => {
  const { doc, list, draft } = fixture();
  const controller = createReorderController({ doc, draft });
  controller.setEnabled(true);
  const handle = handles(doc)[0];
  const dragged = list.children[0];
  doc.hitTarget = list.children[2];
  doc.dispatch("pointerdown", { target: handle, button: 0, pointerId: 15, clientX: 110, clientY: 110 });
  doc.dispatch("pointermove", { target: doc.body, pointerId: 15, clientX: 150, clientY: 340 });
  doc.dispatch("pointerup", { target: doc.body, pointerId: 15 });

  const interimTop = handle.style.top;
  const animations = list.children.flatMap((card) => card.animations || []);
  assert.ok(animations.length > 0);
  animations.forEach((animation) => animation.finish());
  doc.flushFrame();

  const settledRect = dragged.getBoundingClientRect();
  assert.notEqual(interimTop, `${settledRect.top + 8}px`);
  assert.equal(handle.style.left, `${settledRect.right - 48 + doc.defaultView.scrollX}px`);
  assert.equal(handle.style.top, `${settledRect.top + 8 + doc.defaultView.scrollY}px`);
  controller.detach();
});

test("detaching the iframe controller cancels an active drag", () => {
  const { doc, list, draft } = fixture();
  const controller = createReorderController({ doc, draft });
  controller.setEnabled(true);
  doc.hitTarget = list.children[2];
  doc.dispatch("pointerdown", { target: handles(doc)[0], button: 0, pointerId: 12, clientX: 110, clientY: 110 });
  doc.dispatch("pointermove", { target: doc.body, pointerId: 12, clientX: 150, clientY: 340 });
  controller.detach();

  assert.deepEqual(list.children.map((node) => node.dataset.editorReorderKey), ["alpha", "bravo", "charlie"]);
  assert.equal(draft.isDirty(), false);
  assert.equal(list.querySelector("[data-editor-reorder-placeholder]"), null);
  assert.equal(handles(doc).length, 0);
  assert.equal(list.hasAttribute("data-editor-reorder-active"), false);
});

test("draft order repaints a newly attached stale collection", () => {
  const { draft } = fixture();
  draft.reorderCollection("site:home.formats", { keyField: "key", keys: ["charlie", "alpha", "bravo"] });
  const { doc, list } = fixture();
  renderDraftOrder(doc, draft);
  assert.deepEqual(list.children.map((node) => node.dataset.editorReorderKey), ["charlie", "alpha", "bravo"]);
});

test("draft topic order also repaints topic-switcher links without making them draggable", () => {
  const contents = data();
  contents.readings = {
    topics: [
      { slug: "policy", order: 1 },
      { slug: "thinking", order: 2 },
      { slug: "evidence", order: 3 },
      { slug: "hospital", order: 4 }
    ]
  };
  const draft = createDraft(contents, "base");
  const doc = new FakeDocument();
  const nav = doc.createElement("nav");
  nav.dataset.editorTopicSwitcher = "true";
  doc.body.appendChild(nav);
  for (const slug of ["evidence", "policy", "thinking", "hospital"]) {
    const link = doc.createElement("a");
    link.dataset.editorTopicSlug = slug;
    nav.appendChild(link);
  }

  renderDraftOrder(doc, draft);

  assert.deepEqual(nav.children.map((link) => link.dataset.editorTopicSlug), ["policy", "thinking", "evidence", "hospital"]);
  assert.ok(nav.children.every((link) => !link.hasAttribute("data-editor-reorder-key")));
  assert.equal(nav.hasAttribute("data-editor-reorder-list"), false);
});
