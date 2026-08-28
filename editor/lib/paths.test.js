import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec, getValue, setValue, collectMatches } from "./paths.js";

const data = {
  home: {
    hero: { thesis: "Reality, with better footnotes." },
    formats: [
      { key: "readings", title: "Selected Readings" },
      { key: "podcasts", title: "Podcasts" }
    ]
  }
};

test("parseSpec splits the data file from the path", () => {
  assert.deepEqual(parseSpec("site:home.hero.thesis"), {
    file: "site",
    segments: [
      { kind: "key", name: "home" },
      { kind: "key", name: "hero" },
      { kind: "key", name: "thesis" }
    ]
  });
});

test("parseSpec reads a literal array match", () => {
  const { segments } = parseSpec("site:home.formats[key=readings].title");
  assert.deepEqual(segments[2], { kind: "match", key: "key", value: "readings" });
});

test("parseSpec treats a Liquid interpolation as a wildcard match", () => {
  const { segments } = parseSpec("site:home.formats[key={{ format.key }}].title");
  assert.deepEqual(segments[2], { kind: "match", key: "key", value: null });
});

test("parseSpec rejects a spec with no file prefix", () => {
  assert.throws(() => parseSpec("home.hero.thesis"), /file prefix/);
});

test("parseSpec rejects an empty path", () => {
  assert.throws(() => parseSpec("site:"), /empty path/);
});

test("getValue reads a nested key", () => {
  const { segments } = parseSpec("site:home.hero.thesis");
  assert.equal(getValue(data, segments), "Reality, with better footnotes.");
});

test("getValue reads through a literal array match", () => {
  const { segments } = parseSpec("site:home.formats[key=podcasts].title");
  assert.equal(getValue(data, segments), "Podcasts");
});

test("getValue throws on a missing key", () => {
  const { segments } = parseSpec("site:home.hero.missing");
  assert.throws(() => getValue(data, segments), /home\.hero\.missing/);
});

test("getValue throws when no array member matches", () => {
  const { segments } = parseSpec("site:home.formats[key=nope].title");
  assert.throws(() => getValue(data, segments), /key=nope/);
});

test("setValue writes through a literal array match without mutating siblings", () => {
  const copy = structuredClone(data);
  const { segments } = parseSpec("site:home.formats[key=readings].title");
  setValue(copy, segments, "Essays");
  assert.equal(copy.home.formats[0].title, "Essays");
  assert.equal(copy.home.formats[1].title, "Podcasts");
});

test("setValue refuses to create a missing parent", () => {
  const copy = structuredClone(data);
  const { segments } = parseSpec("site:home.nothing.here");
  assert.throws(() => setValue(copy, segments, "x"), /home\.nothing/);
});

test("collectMatches returns every member for a wildcard match", () => {
  const { segments } = parseSpec("site:home.formats[key={{ format.key }}].title");
  assert.deepEqual(collectMatches(data, segments), ["Selected Readings", "Podcasts"]);
});

test("collectMatches throws when one member lacks the field", () => {
  const broken = structuredClone(data);
  delete broken.home.formats[1].title;
  const { segments } = parseSpec("site:home.formats[key={{ format.key }}].title");
  assert.throws(() => collectMatches(broken, segments), /title/);
});

test("getValue reads through a literal index match", () => {
  const { segments } = parseSpec("site:home.formats[index=1].title");
  assert.equal(getValue(data, segments), "Podcasts");
});

test("getValue throws on an out-of-range index", () => {
  const { segments } = parseSpec("site:home.formats[index=5].title");
  assert.throws(() => getValue(data, segments), /index/);
});

test("getValue throws on a non-numeric index", () => {
  const { segments } = parseSpec("site:home.formats[index=nope].title");
  assert.throws(() => getValue(data, segments), /index/);
});

test("collectMatches expands a wildcard index across every array member", () => {
  const { segments } = parseSpec("site:home.formats[index={{ forloop.index0 }}].title");
  assert.deepEqual(collectMatches(data, segments), ["Selected Readings", "Podcasts"]);
});

// The reviewer's fixture for the compound-spec bug: two guests, the second
// with a SECOND link that is missing the trailing field. Expanding only the
// first wildcard let this pass, because [index=null] resolved as index 0.
const guests = {
  guests: [
    { key: "a", links: [{ label: "one" }, { label: "two" }] },
    { key: "b", links: [{ label: "three" }, { url: "https://example.com" }] }
  ]
};

test("collectMatches expands every wildcard, not only the first", () => {
  const { segments } = parseSpec(
    "podcasts:guests[key={{ guest.key }}].links[index={{ forloop.index0 }}].label"
  );
  const complete = structuredClone(guests);
  complete.guests[1].links[1].label = "four";
  assert.deepEqual(collectMatches(complete, segments), ["one", "two", "three", "four"]);
});

test("collectMatches catches a missing field on a LATER member of a nested wildcard", () => {
  const { segments } = parseSpec(
    "podcasts:guests[key={{ guest.key }}].links[index={{ forloop.index0 }}].label"
  );
  assert.throws(() => collectMatches(guests, segments), /label/);
});

test("collectMatches names the outer member that failed", () => {
  const { segments } = parseSpec(
    "podcasts:guests[key={{ guest.key }}].links[index={{ forloop.index0 }}].label"
  );
  assert.throws(
    () => collectMatches(guests, segments),
    /guests\.\[key=\*\]\[1\]: links\.\[index=\*\]\[1\]: label/
  );
});

test("collectMatches returns the matched objects themselves when the spec ends at the wildcard", () => {
  const { segments } = parseSpec("memes:items[key={{ item.key }}]");
  const items = { items: [{ key: "a" }, { key: "b" }] };
  assert.deepEqual(collectMatches(items, segments), [{ key: "a" }, { key: "b" }]);
});

test("collectMatches expands three wildcards across a deeper shape", () => {
  const deep = {
    groups: [
      { rows: [{ cells: [{ text: "a" }, { text: "b" }] }] },
      { rows: [{ cells: [{ text: "c" }] }, { cells: [{ text: "d" }] }] }
    ]
  };
  const { segments } = parseSpec(
    "site:groups[index={{ a }}].rows[index={{ b }}].cells[index={{ c }}].text"
  );
  assert.deepEqual(collectMatches(deep, segments), ["a", "b", "c", "d"]);
});
