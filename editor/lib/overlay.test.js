import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDraftText } from "./overlay.js";

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
