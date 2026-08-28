import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSpec, collectMatches } from "../editor/lib/paths.js";
import { declaredSpecs } from "../editor/lib/pagefields.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templates = [
  "index.html",
  "readings.html",
  "readings-evidence.html",
  "readings-policy.html",
  "readings-thinking.html",
  "readings-hospital.html",
  "podcasts.html",
  "memes.html",
  "_includes/nav.html",
  "_includes/footer.html"
];
// data-edit-meme was missing here, which took memes.html's meme frame — and
// with it every meme addressed by key — out of the scan entirely.
// data-edit-image-decorative is a boolean attribute with no ="…", so it is not
// matched and does not need excluding.
const ATTRIBUTE = /\bdata-edit(-image|-meme)?="([^"]+)"/g;

// What each annotation promises about the value it resolves to.
const ATTRIBUTE_KIND = {
  "data-edit": "text",
  "data-edit-image": "image",
  "data-edit-meme": "object"
};

export function extractSpecs(html) {
  const found = [];
  for (const match of html.matchAll(ATTRIBUTE)) {
    found.push({ attr: `data-edit${match[1] || ""}`, spec: match[2] });
  }
  return found;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Asserts that `spec` resolves the way its `kind` promises, for EVERY item a
 * Liquid wildcard in it can stand for. Throws with the reason if it does not.
 */
export function assertResolves(data, kind, spec) {
  if (kind === "optional-text") {
    // The parent still has to resolve — a renamed or removed parent is drift,
    // not an absent optional value — but the leaf may simply not be there.
    const dot = spec.lastIndexOf(".");
    const parentSpec = spec.slice(0, dot);
    const leaf = spec.slice(dot + 1);
    const parents = collectMatches(data, parseSpec(parentSpec).segments);
    parents.forEach((parent) => {
      if (!isPlainObject(parent)) {
        throw new Error(`${parentSpec} must point at an object`);
      }
      if (leaf in parent && typeof parent[leaf] !== "string") {
        throw new Error(`optional ${leaf} must be a string when present`);
      }
    });
    return;
  }

  const values = collectMatches(data, parseSpec(spec).segments);
  values.forEach((value) => {
    if (kind === "text") {
      if (typeof value !== "string") {
        throw new Error("must point at a string");
      }
      return;
    }
    if (!isPlainObject(value)) {
      throw new Error(`must point at ${kind === "image" ? "an image object" : "an object"}`);
    }
    if (kind === "image") {
      // The image panel seeds path and alt when they are missing, but it reads
      // fit and focus straight out of the data and validate-content.js only
      // runs validateImage at all when all four are own properties.
      for (const key of ["fit", "focus"]) {
        if (typeof value[key] !== "string") {
          throw new Error(`image object is missing "${key}"`);
        }
      }
    }
  });
}

function run() {
  const errors = [];
  const cache = new Map();

  const readData = (file) => {
    if (!cache.has(file)) {
      const dataPath = path.join(root, "_data", `${file}.json`);
      cache.set(file, JSON.parse(fs.readFileSync(dataPath, "utf8")));
    }
    return cache.get(file);
  };

  let checked = 0;
  const check = (where, kind, spec) => {
    checked += 1;
    try {
      assertResolves(readData(parseSpec(spec).file), kind, spec);
    } catch (error) {
      errors.push(`${where} — ${error.message}`);
    }
  };

  for (const template of templates) {
    const html = fs.readFileSync(path.join(root, template), "utf8");
    for (const { attr, spec } of extractSpecs(html)) {
      check(`${template}: ${attr}="${spec}"`, ATTRIBUTE_KIND[attr], spec);
    }
  }

  // Specs that live only in JavaScript. The page settings panel, the guest link
  // URLs and the meme panel address paths no template annotates, so nothing
  // here would ever have caught a key drifting under them.
  for (const { kind, spec } of declaredSpecs()) {
    check(`editor/lib/pagefields.js: ${spec}`, kind, spec);
  }

  if (errors.length) {
    console.error(`Edit-path validation failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Edit-path validation passed: ${checked} editable paths resolve against _data.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
