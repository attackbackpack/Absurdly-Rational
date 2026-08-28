import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  fieldsForPage,
  guestLinkFields,
  declaredSpecs,
  MEME_FIELDS,
  MEME_ITEM_SPEC,
  PAGES
} from "./pagefields.js";
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

// --- Guest link URLs. The design doc lists them under the page settings panel
// beside show.url and invite.url; they are per-guest, so they are built from
// the draft rather than declared in CONFIG.

test("one field is offered per guest link, in order", () => {
  const fields = guestLinkFields(data.podcasts.guests);
  const expected = data.podcasts.guests.reduce((total, guest) => total + guest.links.length, 0);
  assert.equal(fields.length, expected);
  assert.equal(fields[0][0], `podcasts:guests[key=${data.podcasts.guests[0].key}].links[index=0].url`);
});

test("every guest link spec resolves against the real data", () => {
  for (const [spec] of guestLinkFields(data.podcasts.guests)) {
    const { file, segments } = parseSpec(spec);
    assert.equal(typeof collectMatches(data[file], segments)[0], "string", spec);
  }
});

test("a guest link field is labelled with the wording on the button", () => {
  const [, label] = guestLinkFields(data.podcasts.guests)[0];
  assert.match(label, new RegExp(data.podcasts.guests[0].links[0].label));
});

test("a guest key that would break a spec is skipped rather than mis-addressed", () => {
  const fields = guestLinkFields([
    { key: "ok", links: [{ label: "A", url: "https://a.test" }] },
    { key: "bad]key", links: [{ label: "B", url: "https://b.test" }] },
    { key: "", links: [{ label: "C", url: "https://c.test" }] }
  ]);
  assert.equal(fields.length, 1);
  assert.match(fields[0][0], /key=ok/);
});

test("guestLinkFields survives missing or malformed guests", () => {
  assert.deepEqual(guestLinkFields(undefined), []);
  assert.deepEqual(guestLinkFields([]), []);
  assert.deepEqual(guestLinkFields([{ key: "a" }]), []);
  assert.equal(guestLinkFields([{ key: "a", links: [{}] }])[0][1], "“Link 1” goes to");
});

// --- The specs that live only in JavaScript, which the template scan cannot see.

test("declaredSpecs covers every page settings field", () => {
  const declared = new Set(declaredSpecs().map(({ spec }) => spec));
  for (const page of PAGES) {
    const { links, seo } = fieldsForPage(page);
    for (const [spec] of [...links, ...seo]) {
      assert.ok(declared.has(spec), `${page}: ${spec} is not declared for the build scan`);
    }
  }
});

test("declaredSpecs covers every meme panel field and the meme image", () => {
  const declared = new Set(declaredSpecs().map(({ spec }) => spec));
  for (const [suffix] of MEME_FIELDS) {
    assert.ok(declared.has(`${MEME_ITEM_SPEC}.${suffix}`), suffix);
  }
  assert.ok(declared.has(`${MEME_ITEM_SPEC}.image`));
});

test("declaredSpecs covers the guest link URLs the settings panel builds", () => {
  const declared = declaredSpecs().find(({ spec }) => spec.includes("links["));
  assert.ok(declared, "no guest link URL spec is declared");
  const { file, segments } = parseSpec(declared.spec);
  // With every wildcard expanded this proves the URL on EVERY link of EVERY
  // guest, not just the first — which is what the settings panel writes to.
  const found = collectMatches(data[file], segments);
  const expected = data.podcasts.guests.reduce((total, guest) => total + guest.links.length, 0);
  assert.equal(found.length, expected);
});

test("every declared spec resolves against the real data", () => {
  for (const { kind, spec } of declaredSpecs()) {
    const { file, segments } = parseSpec(spec);
    if (kind === "optional-text") {
      const dot = spec.lastIndexOf(".");
      assert.doesNotThrow(() => collectMatches(data[file], parseSpec(spec.slice(0, dot)).segments), spec);
      continue;
    }
    assert.doesNotThrow(() => collectMatches(data[file], segments), spec);
  }
});
