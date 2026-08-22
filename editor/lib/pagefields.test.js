import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fieldsForPage, PAGES } from "./pagefields.js";
import { parseSpec, collectMatches } from "./paths.js";

const data = {
  site: JSON.parse(fs.readFileSync(new URL("../../_data/site.json", import.meta.url), "utf8")),
  readings: JSON.parse(fs.readFileSync(new URL("../../_data/readings.json", import.meta.url), "utf8")),
  podcasts: JSON.parse(fs.readFileSync(new URL("../../_data/podcasts.json", import.meta.url), "utf8")),
  memes: JSON.parse(fs.readFileSync(new URL("../../_data/memes.json", import.meta.url), "utf8"))
};

test("every page has SEO fields", () => {
  for (const page of PAGES) {
    assert.ok(fieldsForPage(page).seo.length > 0, page);
  }
});

test("every spec on every page resolves against the real data", () => {
  for (const page of PAGES) {
    const { links, seo } = fieldsForPage(page);
    for (const [spec] of [...links, ...seo]) {
      const { file, segments } = parseSpec(spec);
      assert.doesNotThrow(() => collectMatches(data[file], segments), `${page}: ${spec}`);
    }
  }
});

test("an unknown page yields empty lists", () => {
  assert.deepEqual(fieldsForPage("nope"), { links: [], seo: [] });
});

test("no internal path is offered as an editable link", () => {
  for (const page of PAGES) {
    for (const [spec] of fieldsForPage(page).links) {
      assert.doesNotMatch(spec, /navigation|topics\[|formats\[/, `${page}: ${spec}`);
    }
  }
});
