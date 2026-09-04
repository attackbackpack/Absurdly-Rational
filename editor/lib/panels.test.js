import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeImagePreview, imageMimeType, prepareImageFile, seedImageWrites } from "./panels.js";

// The image objects in _data/site.json as they ship: fit and focus only.
const shipped = () => ({ decorative: false, fit: "cover", focus: "center" });

test("a non-decorative slot is completed with path and alt only", () => {
  assert.deepEqual(seedImageWrites(shipped(), false), [
    ["path", ""],
    ["alt", ""]
  ]);
});

test("a decorative slot also records decorative: true in the data", () => {
  // scripts/validate-content.js gates the alt requirement on the DATA field, so
  // without this an uploaded door image fails CI and the panel hides the only
  // control that could fix it.
  assert.deepEqual(seedImageWrites(shipped(), true), [
    ["path", ""],
    ["alt", ""],
    ["decorative", true]
  ]);
});

test("existing string values are never overwritten", () => {
  const image = { path: "assets/uploads/a.png", alt: "A rooster", fit: "cover", focus: "center" };
  assert.deepEqual(seedImageWrites(image, false), []);
});

test("only the missing key is seeded", () => {
  assert.deepEqual(seedImageWrites({ path: "assets/uploads/a.png", fit: "cover" }, false), [["alt", ""]]);
  assert.deepEqual(seedImageWrites({ alt: "x", fit: "cover" }, false), [["path", ""]]);
});

test("a non-string path or alt is replaced, since the validator requires strings", () => {
  assert.deepEqual(seedImageWrites({ path: null, alt: 7 }, false), [
    ["path", ""],
    ["alt", ""]
  ]);
});

test("decorative is not re-written when the data already says true", () => {
  assert.deepEqual(seedImageWrites({ path: "", alt: "", decorative: true }, true), []);
});

test("decorative: false is never written for a slot the template renders normally", () => {
  const writes = seedImageWrites({ path: "", alt: "", decorative: true }, false);
  assert.deepEqual(writes, []);
});

test("nothing is written for an already-complete non-decorative slot", () => {
  assert.deepEqual(seedImageWrites({ path: "", alt: "", decorative: false }, false), []);
});

test("preview MIME types come from the allowed filename extension", () => {
  assert.equal(imageMimeType("IMG_1234.JPG"), "image/jpeg");
  assert.equal(imageMimeType("art.png"), "image/png");
  assert.equal(imageMimeType("card.webp"), "image/webp");
  assert.equal(imageMimeType("photo.heic"), "application/octet-stream");
});

test("prepareImageFile copies photo-library bytes into a typed in-memory Blob", async () => {
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const file = {
    name: "IMG_1234.JPG",
    type: "",
    async arrayBuffer() {
      return original.buffer;
    }
  };

  const prepared = await prepareImageFile(file);

  assert.equal(prepared.bytesBase64, "/9j/2Q==");
  assert.equal(prepared.previewBlob.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await prepared.previewBlob.arrayBuffer()), original);
});

test("decodeImagePreview keeps a successfully decoded URL for the visible preview", async () => {
  let revoked = null;
  const image = {
    naturalWidth: 2048,
    naturalHeight: 1536,
    set src(value) {
      this.value = value;
      queueMicrotask(() => this.onload());
    }
  };

  const preview = await decodeImagePreview(new Blob(["image"]), {
    createUrl: () => "blob:preview",
    revokeUrl: (value) => {
      revoked = value;
    },
    createImage: () => image
  });

  assert.deepEqual(preview, { url: "blob:preview", width: 2048, height: 1536 });
  assert.equal(revoked, null);
});

test("decodeImagePreview revokes a URL when the browser cannot display it", async () => {
  let revoked = null;
  const image = {
    set src(value) {
      this.value = value;
      queueMicrotask(() => this.onerror());
    }
  };

  await assert.rejects(
    decodeImagePreview(new Blob(["broken"]), {
      createUrl: () => "blob:broken",
      revokeUrl: (value) => {
        revoked = value;
      },
      createImage: () => image
    }),
    /could not be decoded/
  );
  assert.equal(revoked, "blob:broken");
});
