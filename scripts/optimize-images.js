"use strict";

const fs = require("node:fs");
const path = require("node:path");

let sharp;
try {
  sharp = require("sharp");
} catch (error) {
  console.error("Image optimization requires sharp. Run npm install before running this script.");
  console.error(error.message);
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const uploadsDirectory = path.join(root, "assets", "uploads");
const inputDirectory = path.resolve(root, getArgument("--dir") || "assets/uploads");
const convertToWebp = !process.argv.includes("--no-convert-webp");
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

if (inputDirectory !== uploadsDirectory && !inputDirectory.startsWith(`${uploadsDirectory}${path.sep}`)) {
  console.error("Image optimization is limited to assets/uploads inside this repository.");
  process.exit(1);
}

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function listImages(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listImages(entryPath);
    }
    return supportedExtensions.has(path.extname(entry.name).toLowerCase()) ? [entryPath] : [];
  });
}

function relativeRepositoryPath(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function replaceReferences(value, replacements) {
  let changed = false;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const result = replaceReferences(item, replacements);
      if (result.changed) {
        value[index] = result.value;
        changed = true;
      }
    });
    return { value, changed };
  }
  if (value && typeof value === "object") {
    Object.keys(value).forEach((key) => {
      const result = replaceReferences(value[key], replacements);
      if (result.changed) {
        value[key] = result.value;
        changed = true;
      }
    });
    return { value, changed };
  }
  if (typeof value === "string" && replacements.has(value)) {
    return { value: replacements.get(value), changed: true };
  }
  return { value, changed };
}

async function optimize(sourcePath, targetPath) {
  const temporaryPath = `${targetPath}.tmp`;
  const pipeline = sharp(sourcePath)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 });
  await pipeline.toFile(temporaryPath);
  fs.renameSync(temporaryPath, targetPath);
}

async function main() {
  const files = listImages(inputDirectory);
  const nonWebpStems = new Set(files.filter((file) => path.extname(file).toLowerCase() !== ".webp").map((file) => path.join(path.dirname(file), path.basename(file, path.extname(file)))));
  const replacements = new Map();
  let optimizedCount = 0;

  for (const sourcePath of files) {
    const extension = path.extname(sourcePath).toLowerCase();
    if (convertToWebp && extension === ".webp" && nonWebpStems.has(path.join(path.dirname(sourcePath), path.basename(sourcePath, extension)))) {
      continue;
    }
    const targetPath = convertToWebp && extension !== ".webp"
      ? path.join(path.dirname(sourcePath), `${path.basename(sourcePath, extension)}.webp`)
      : sourcePath;
    await optimize(sourcePath, targetPath);
    optimizedCount += 1;
    if (targetPath !== sourcePath) {
      const oldPath = relativeRepositoryPath(sourcePath);
      const newPath = relativeRepositoryPath(targetPath);
      replacements.set(oldPath, newPath);
      replacements.set(`/${oldPath}`, `/${newPath}`);
      fs.unlinkSync(sourcePath);
    }
  }

  if (replacements.size) {
    const dataDirectory = path.join(root, "_data");
    fs.readdirSync(dataDirectory).filter((file) => file.endsWith(".json")).forEach((file) => {
      const filePath = path.join(dataDirectory, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const result = replaceReferences(data, replacements);
      if (result.changed) {
        fs.writeFileSync(filePath, `${JSON.stringify(result.value, null, 2)}\n`);
        console.log(`Updated image references in _data/${file}.`);
      }
    });
  }

  console.log(`Optimized ${optimizedCount} uploaded image${optimizedCount === 1 ? "" : "s"}${convertToWebp ? " as WebP where possible" : ""}.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
