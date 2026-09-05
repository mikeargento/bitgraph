// Copyright (c) Mike Argento. All rights reserved. See LICENSE.
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { placementForBytes, fusedNamesFor } from "../fuse.js";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(24).fill(0)]);

describe("placementForBytes: decided from the bytes, never the name", () => {
  it("formats that ignore trailing data take trailer/1", () => {
    assert.equal(placementForBytes(bytes(0xff, 0xd8, 0xff, 0xe0)), "trailer/1", "JPEG");
    assert.equal(placementForBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "trailer/1", "PNG");
    assert.equal(placementForBytes(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), "trailer/1", "GIF");
    assert.equal(placementForBytes(bytes(0x49, 0x49, 0x2a, 0x00)), "trailer/1", "TIFF, DNG, CR2");
    assert.equal(placementForBytes(bytes(0x4d, 0x4d, 0x00, 0x2a)), "trailer/1", "TIFF big-endian, NEF");
    assert.equal(placementForBytes(bytes(0x42, 0x4d)), "trailer/1", "BMP");
    assert.equal(placementForBytes(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)), "trailer/1", "RIFF WebP");
  });
  it("everything else takes container/2", () => {
    assert.equal(placementForBytes(new TextEncoder().encode("%PDF-1.7\n")), "container/2", "PDF");
    assert.equal(placementForBytes(bytes(0x50, 0x4b, 0x03, 0x04)), "container/2", "ZIP, Office, EPUB");
    assert.equal(placementForBytes(bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70)), "container/2", "ISO base media");
    assert.equal(placementForBytes(bytes(0x1a, 0x45, 0xdf, 0xa3)), "container/2", "Matroska");
    assert.equal(placementForBytes(bytes(0x49, 0x44, 0x33)), "container/2", "MP3");
    assert.equal(placementForBytes(new TextEncoder().encode("# markdown\n")), "container/2", "text");
    assert.equal(placementForBytes(new Uint8Array(0)), "container/2", "empty");
  });
  it("names keep the extension for trailers and use .tar for containers", () => {
    assert.deepEqual(fusedNamesFor("IMG_0001.jpg", "trailer/1"), { fusedName: "IMG_0001.fused.jpg", frameName: "IMG_0001.jpg.bitgraph-fuse.json" });
    assert.deepEqual(fusedNamesFor("contract.pdf", "container/2"), { fusedName: "contract.fused.tar", frameName: "contract.pdf.bitgraph-fuse.json" });
    assert.deepEqual(fusedNamesFor("README", "container/2"), { fusedName: "README.fused.tar", frameName: "README.bitgraph-fuse.json" });
  });
});
