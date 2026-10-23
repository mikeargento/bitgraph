/**
 * bind: the one way to make a BitGraph (enclave v12). Files are hashed here and
 * only their digests are sent; each comes back as its own BitGraph with two
 * consecutive counts, and its proof is saved beside it when asked.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindFiles, proofPathFor } from "../bind.js";

function fakeSite(): { calls: Array<{ url: string; body: unknown }>; restore: () => void } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const real = globalThis.fetch;
  let counter = 10;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { digests: Array<{ digestB64: string }> };
    calls.push({ url: String(url), body });
    const proofs = body.digests.map((d) => {
      counter += 2;
      return { version: "bitgraph/1", artifact: { hashAlg: "sha256", digestB64: d.digestB64 }, commit: { nonceB64: "n", counter: String(counter), slotCounter: String(counter - 1), atomic: true }, proofHash: "x" };
    });
    return new Response(JSON.stringify(proofs), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("bind hashes each file here, sends only the digests, and saves each proof beside its file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-bind-"));
  const a = join(dir, "a.txt"), b = join(dir, "b.txt");
  await writeFile(a, "alpha"); await writeFile(b, "beta");
  const site = fakeSite();
  try {
    const bound = await bindFiles({ baseUrl: "https://example.test" }, { paths: [a, b] }, { write: true });
    assert.equal(site.calls.length, 1);
    assert.equal(site.calls[0]!.url, "https://example.test/api/commit");
    const sent = (site.calls[0]!.body as { digests: Array<{ digestB64: string }> }).digests.map((d) => d.digestB64);
    assert.deepEqual(sent, [createHash("sha256").update("alpha").digest("base64"), createHash("sha256").update("beta").digest("base64")]);
    for (const x of bound) {
      assert.equal(BigInt(x.counts![1]), BigInt(x.counts![0]) + 1n);
      assert.equal(x.wrote, proofPathFor(x.path!));
      const saved = JSON.parse(await readFile(x.wrote!, "utf8")) as Record<string, unknown>;
      assert.ok(!("proofHash" in saved), "the proof is saved as the enclave signed it");
    }
  } finally { site.restore(); }
});

test("bind without write saves nothing; digests can be bound as given", async () => {
  const site = fakeSite();
  try {
    const d = createHash("sha256").update("given").digest("base64");
    const bound = await bindFiles({ baseUrl: "https://example.test" }, { digests: [d] });
    assert.equal(bound.length, 1);
    assert.equal(bound[0]!.wrote, null);
    assert.equal(bound[0]!.path, null);
  } finally { site.restore(); }
});
