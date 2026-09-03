import { test } from "node:test";
import assert from "node:assert/strict";
import { placementFor, fusedNames, toleratesTrailer, MAX_FUSE_BYTES } from "../fuse-placement.ts";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(24).fill(0)]);

test("formats that ignore trailing data take trailer/1", () => {
  assert.equal(placementFor(bytes(0xff, 0xd8, 0xff, 0xe0)), "trailer/1", "JPEG");
  assert.equal(placementFor(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "trailer/1", "PNG");
  assert.equal(placementFor(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), "trailer/1", "GIF");
  assert.equal(placementFor(bytes(0x49, 0x49, 0x2a, 0x00)), "trailer/1", "TIFF little-endian, DNG, CR2");
  assert.equal(placementFor(bytes(0x4d, 0x4d, 0x00, 0x2a)), "trailer/1", "TIFF big-endian, NEF");
  assert.equal(placementFor(bytes(0x42, 0x4d)), "trailer/1", "BMP");
  assert.equal(placementFor(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)), "trailer/1", "RIFF WebP");
});

test("everything else takes container/1", () => {
  assert.equal(placementFor(new TextEncoder().encode("%PDF-1.7\n")), "container/1", "PDF");
  assert.equal(placementFor(bytes(0x50, 0x4b, 0x03, 0x04)), "container/1", "ZIP, Office, EPUB");
  assert.equal(placementFor(bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70)), "container/1", "ISO base media: MP4, MOV, HEIC");
  assert.equal(placementFor(bytes(0x1a, 0x45, 0xdf, 0xa3)), "container/1", "Matroska, WebM");
  assert.equal(placementFor(bytes(0x49, 0x44, 0x33)), "container/1", "MP3 with ID3v2");
  assert.equal(placementFor(new TextEncoder().encode('{"a":1}')), "container/1", "JSON");
  assert.equal(placementFor(new TextEncoder().encode("<svg xmlns=")), "container/1", "SVG");
  assert.equal(placementFor(new TextEncoder().encode("# A markdown document\n")), "container/1", "Markdown");
  assert.equal(placementFor(new Uint8Array(0)), "container/1", "empty");
  assert.equal(toleratesTrailer(new Uint8Array([0x42, 0x4d, 0x00])), false, "a BMP signature without a header is not enough");
});

test("names keep the extension for trailer placements and use .tar for containers", () => {
  assert.deepEqual(fusedNames("IMG_0001.jpg", "trailer/1"), { fusedName: "IMG_0001.fused.jpg", frameName: "IMG_0001.jpg.bitgraph-fuse.json" });
  assert.deepEqual(fusedNames("contract.pdf", "container/1"), { fusedName: "contract.fused.tar", frameName: "contract.pdf.bitgraph-fuse.json" });
  assert.deepEqual(fusedNames("README", "container/1"), { fusedName: "README.fused.tar", frameName: "README.bitgraph-fuse.json" });
  assert.deepEqual(fusedNames(".env", "container/1"), { fusedName: ".env.fused.tar", frameName: ".env.bitgraph-fuse.json" });
  assert.ok(MAX_FUSE_BYTES > 100 * 1024 * 1024);
});
