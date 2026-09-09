import { test } from "node:test";
import assert from "node:assert/strict";
import {
  imageSource,
  imageSpecForTarget,
  isEditorInteraction,
  memeItemsForEditor,
  renderDraftImages,
  renderDraftText,
  syncMemeEditor
} from "./overlay.js";
import { createDraft } from "./draft.js";

test("renderDraftText keeps pending or newly published text visible over an older build", () => {
  const nodes = [
    { dataset: { edit: "site:home.hero.title" }, textContent: "Older deployed title" },
    { dataset: { edit: "site:footer.note" }, textContent: "Older deployed footer" }
  ];
  const values = new Map([
    ["site:home.hero.title", "Current editor title"],
    ["site:footer.note", "Current editor footer"]
  ]);

  renderDraftText(
    { querySelectorAll: () => nodes },
    { read: (spec) => values.get(spec) }
  );

  assert.deepEqual(
    nodes.map((node) => node.textContent),
    ["Current editor title", "Current editor footer"]
  );
});

function targetInside(attribute) {
  return {
    closest(selector) {
      return selector.split(", ").includes(attribute) ? { dataset: {} } : null;
    }
  };
}

test("editor interactions nested inside links do not navigate the preview", () => {
  assert.equal(isEditorInteraction(targetInside("[data-edit]")), true);
  assert.equal(isEditorInteraction(targetInside("[data-edit-image]")), true);
  assert.equal(isEditorInteraction(targetInside("[data-edit-meme]")), true);
});

test("ordinary link content is still treated as navigation", () => {
  assert.equal(isEditorInteraction(targetInside("[data-unrelated]")), false);
  assert.equal(isEditorInteraction(null), false);
});

test("image specs include images edited through the meme panel", () => {
  assert.equal(imageSpecForTarget({ dataset: { editImage: "site:home.hero.image" } }), "site:home.hero.image");
  assert.equal(imageSpecForTarget({ dataset: { editMeme: "memes:items[key=one]" } }), "memes:items[key=one].image");
});

test("meme editor items exclude legacy blank art but keep uploaded and neutral slots", () => {
  const items = [
    { key: "starter", visible: true, image: { path: "" }, art: { headline: "Starter art" } },
    { key: "uploaded", visible: true, image: { path: "assets/uploads/meme.jpg" }, art: { headline: "Starter art" } },
    { key: "hidden", visible: false, image: { path: "assets/uploads/hidden.jpg" }, art: { headline: "" } },
    { key: "new", visible: true, image: { path: "" }, art: { headline: "" } }
  ];

  assert.deepEqual(
    memeItemsForEditor(items, new Set(["new"])).map((item) => item.key),
    ["uploaded", "new"]
  );
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

class FakeDocument {
  constructor() {
    this.body = { dataset: { page: "memes" } };
    this.wall = new FakeElement("section");
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  querySelector(selector) {
    return selector === ".meme-wall" ? this.wall : null;
  }
}

test("syncMemeEditor renders exactly one add control and reattaches a saved blank slot", () => {
  const draft = createDraft(
    {
      site: {},
      readings: {},
      podcasts: {},
      memes: {
        items: [
          { key: "starter", visible: true, image: { path: "", alt: "", fit: "cover", focus: "center" }, art: { headline: "Starter art" } }
        ]
      }
    },
    "abc"
  );
  const initial = syncMemeEditor(new FakeDocument(), draft);
  assert.equal(initial.tiles.length, 0);
  assert.equal(initial.addButton.dataset.editorMemeAdd, "true");

  const item = draft.appendMemeItem();
  const current = syncMemeEditor(new FakeDocument(), draft);
  assert.equal(current.tiles.length, 1);
  assert.equal(current.tiles[0].dataset.editMeme, `memes:items[key=${item.key}]`);
  assert.equal(current.wall.children.filter((node) => node.dataset.editorMemeAdd).length, 1);

  const saved = JSON.parse(
    Buffer.from(draft.buildPayload("save").files.find((file) => file.path === "_data/memes.json").contentBase64, "base64")
  );
  const reattached = createDraft({ site: {}, readings: {}, podcasts: {}, memes: saved }, "def");
  const afterReattach = syncMemeEditor(new FakeDocument(), reattached);
  assert.deepEqual(afterReattach.tiles.map((tile) => tile.dataset.editMeme), [`memes:items[key=${item.key}]`]);
  assert.equal(afterReattach.wall.children.filter((node) => node.dataset.editorMemeAdd).length, 1);
});

test("newly committed local images use the exact GitHub commit asset base", () => {
  assert.equal(
    imageSource("assets/uploads/new image.jpg", "https://raw.githubusercontent.com/owner/repo/abc123/"),
    "https://raw.githubusercontent.com/owner/repo/abc123/assets/uploads/new%20image.jpg"
  );
  assert.equal(imageSource("https://images.example/photo.jpg", "https://unused.example/"), "https://images.example/photo.jpg");
});

function fakeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    has(name) {
      return values.has(name);
    }
  };
}

function fakeImage(source = "") {
  return {
    alt: "",
    classList: fakeClassList(["image-object", "image-fit-cover", "image-focus-center"]),
    closest() {
      return null;
    },
    getAttribute(name) {
      return name === "src" ? this.src : null;
    },
    hidden: false,
    src: source
  };
}

test("renderDraftImages replaces a stale deployed image with the current committed image", () => {
  const img = fakeImage("https://site.example/assets/uploads/old.jpg");
  const target = {
    dataset: { editImage: "site:home.hero.image" },
    hasAttribute() {
      return false;
    },
    querySelector(selector) {
      return selector === "img.image-object" ? img : null;
    }
  };
  const doc = {
    baseURI: "https://site.example/index.html",
    querySelectorAll() {
      return [target];
    }
  };

  renderDraftImages(
    doc,
    { read: () => ({ path: "assets/uploads/new.jpg", alt: "New image", fit: "contain", focus: "top" }) },
    { assetBase: "https://raw.githubusercontent.com/owner/repo/abc123/" }
  );

  assert.equal(img.src, "https://raw.githubusercontent.com/owner/repo/abc123/assets/uploads/new.jpg");
  assert.equal(img.alt, "New image");
  assert.equal(img.classList.has("image-fit-contain"), true);
  assert.equal(img.classList.has("image-focus-top"), true);
});

test("renderDraftImages creates a visible image over stale built-in artwork", () => {
  let appended = null;
  const target = {
    dataset: { editImage: "site:home.hero.image" },
    appendChild(node) {
      appended = node;
    },
    hasAttribute() {
      return false;
    },
    querySelector(selector) {
      return selector === "img.image-object" ? appended : null;
    }
  };
  const doc = {
    baseURI: "https://site.example/index.html",
    createElement() {
      return fakeImage();
    },
    querySelectorAll() {
      return [target];
    }
  };

  renderDraftImages(
    doc,
    { read: () => ({ path: "assets/uploads/new.jpg", alt: "New image", fit: "cover", focus: "center" }) },
    {
      assetBase: "https://raw.githubusercontent.com/owner/repo/abc123/",
      previews: new Map([
        ["site:home.hero.image", { path: "assets/uploads/new.jpg", url: "blob:current-preview" }]
      ])
    }
  );

  assert.equal(appended.src, "blob:current-preview");
  assert.equal(appended.hidden, false);
});
