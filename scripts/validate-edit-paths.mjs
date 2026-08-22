import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSpec, collectMatches } from "../editor/lib/paths.js";

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
const ATTRIBUTE = /\bdata-edit(-image)?="([^"]+)"/g;

export function extractSpecs(html) {
  const found = [];
  for (const match of html.matchAll(ATTRIBUTE)) {
    found.push({ attr: match[1] ? "data-edit-image" : "data-edit", spec: match[2] });
  }
  return found;
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
  for (const template of templates) {
    const html = fs.readFileSync(path.join(root, template), "utf8");
    for (const { attr, spec } of extractSpecs(html)) {
      checked += 1;
      try {
        const { file, segments } = parseSpec(spec);
        const values = collectMatches(readData(file), segments);
        if (attr === "data-edit") {
          values.forEach((value) => {
            if (typeof value !== "string") {
              throw new Error("data-edit must point at a string");
            }
          });
        } else {
          values.forEach((value) => {
            if (value === null || typeof value !== "object" || Array.isArray(value)) {
              throw new Error("data-edit-image must point at an image object");
            }
          });
        }
      } catch (error) {
        errors.push(`${template}: ${attr}="${spec}" — ${error.message}`);
      }
    }
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
