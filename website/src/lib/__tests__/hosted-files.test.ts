/**
 * Hosted files (?files=, lib/hosted-files.ts): the link rule, the fetch caps, the unzip caps, and the
 * match against the page's own proof. Trees are made by the real maker against the stub boundary
 * (tree1-helpers), zipped the way a host serves them (the files, the owner's export, SPEC.md, a
 * README), and must rebuild the signed root exactly; one byte changed, a file missing, or another
 * tree's files show nothing. No network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { makeTree, type TreeInput } from "../fuse-tree-make.ts";
import { buildTreeExport, exportJson, fetchTreeEvidence, ownerExportName, ownerTree } from "../fuse-tree.ts";
import { hashBlob } from "../scan-hash.ts";
import { fetchHostedBundle, hostedSourceOf, matchHostedFiles, unzipHostedBundle, type HostedFile } from "../hosted-files.ts";
import { makeStub, utf8, digestB64, SPEC_BYTES } from "./tree1-helpers.ts";

// ── the link ─────────────────────────────────────────────────────────────────────────────────────

test("https links are followed; http only between loopback hosts; nothing else", () => {
  const ok = hostedSourceOf("https://files.example.org/a/b.zip?x=1", "bitgraph.ing");
  assert.ok(ok.ok && ok.source.host === "files.example.org");
  assert.deepEqual(hostedSourceOf("http://files.example.org/b.zip", "bitgraph.ing"), { ok: false, problem: "not-https", host: "files.example.org" });
  assert.equal(hostedSourceOf("http://localhost:8150/b.zip", "bitgraph.ing").ok, false, "a public page never fetches plain http, even from localhost");
  assert.equal(hostedSourceOf("http://127.0.0.1:8199/b.zip", "localhost").ok, true, "a local build may read a local server");
  assert.equal(hostedSourceOf("http://evil.example/b.zip", "localhost").ok, false);
  assert.equal(hostedSourceOf("javascript:alert(1)", "bitgraph.ing").ok, false);
  assert.equal(hostedSourceOf("data:application/zip;base64,UEsFBg==", "bitgraph.ing").ok, false);
  assert.equal(hostedSourceOf("https://user:pw@files.example.org/b.zip", "bitgraph.ing").ok, false, "no credentials in the link");
  assert.deepEqual(hostedSourceOf("not a url", "bitgraph.ing"), { ok: false, problem: "bad-url", host: null });
  assert.deepEqual(hostedSourceOf(null, "bitgraph.ing"), { ok: false, problem: "bad-url", host: null });
});

// ── the fetch ────────────────────────────────────────────────────────────────────────────────────

const SRC = { url: "https://files.example.org/b.zip", host: "files.example.org" };
const respond = (body: BodyInit | null, init: ResponseInit = {}, url?: string): typeof fetch =>
  (async () => { const r = new Response(body, init); if (url) Object.defineProperty(r, "url", { value: url }); return r; }) as typeof fetch;

test("the fetch: bytes on 200, the status otherwise, the host that answered after a redirect", async () => {
  const ok = await fetchHostedBundle(SRC, { fetchImpl: respond(new Uint8Array([1, 2, 3]), { status: 200 }, "https://cdn.example.net/b.zip") });
  assert.ok(ok.ok);
  assert.deepEqual([...ok.bytes], [1, 2, 3]);
  assert.equal(ok.host, "cdn.example.net", "the label names the host that served the bytes");
  const missing = await fetchHostedBundle(SRC, { fetchImpl: respond("no", { status: 404 }) });
  assert.deepEqual(missing, { ok: false, problem: "status", host: "files.example.org", status: 404 });
  const refused = await fetchHostedBundle(SRC, { fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
  assert.equal(!refused.ok && refused.problem, "unreachable");
});

test("the fetch: over the cap by its declared length, or by what actually streams, is refused", async () => {
  const declared = await fetchHostedBundle(SRC, { maxBytes: 10, fetchImpl: respond(new Uint8Array(5), { headers: { "content-length": "11" } }) });
  assert.equal(!declared.ok && declared.problem, "too-large");
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 4; i++) c.enqueue(new Uint8Array(4)); c.close(); } });
  const streamed = await fetchHostedBundle(SRC, { maxBytes: 10, fetchImpl: respond(stream) });
  assert.equal(!streamed.ok && streamed.problem, "too-large");
  const exact = await fetchHostedBundle(SRC, { maxBytes: 16, fetchImpl: respond(new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 4; i++) c.enqueue(new Uint8Array(4)); c.close(); } })) });
  assert.ok(exact.ok && exact.bytes.byteLength === 16);
});

test("the fetch: a host that does not answer in time is a timeout", async () => {
  const hang = ((_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as typeof fetch;
  const r = await fetchHostedBundle(SRC, { timeoutMs: 30, fetchImpl: hang });
  assert.equal(!r.ok && r.problem, "timeout");
});

// ── the unzip ────────────────────────────────────────────────────────────────────────────────────

test("the unzip: files only (no folders, no macOS litter); not a ZIP, too many entries, too large: null", () => {
  const z = zipSync({ "a.txt": utf8("a"), "dir/": new Uint8Array(0), "dir/b.txt": utf8("b"), "__MACOSX/._a.txt": utf8("x"), ".DS_Store": utf8("x") });
  const files = unzipHostedBundle(z);
  assert.deepEqual(files?.map((f) => f.name).sort(), ["a.txt", "dir/b.txt"]);
  assert.equal(unzipHostedBundle(utf8("<html>not a zip</html>")), null);
  assert.equal(unzipHostedBundle(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), null, "a broken ZIP");
  assert.equal(unzipHostedBundle(zipSync({ "a": utf8("1"), "b": utf8("2"), "c": utf8("3") }), { maxEntries: 2 }), null);
  assert.equal(unzipHostedBundle(zipSync({ "big.bin": new Uint8Array(4096) }), { maxUnzipped: 4095 }), null);
});

// ── the match ────────────────────────────────────────────────────────────────────────────────────

const FOUR = (): Array<{ name: string; bytes: Uint8Array }> => [
  { name: "question.json", bytes: utf8('{\n  "q": "one"\n}\n') },
  { name: "request.json", bytes: utf8('{\n  "r": 2\n}\n') },
  { name: "response.json", bytes: utf8('{\n  "a": true\n}\n') },
  { name: "result.json", bytes: utf8('{\n  "right": [true, false]\n}\n') },
];

/** A tree of the files recorded as they are (as the Ask Jev service records), and the bundle a host serves for it. */
async function hostedTree(files = FOUR()) {
  const stub = await makeStub();
  const inputs: TreeInput[] = files.map((f) => ({ file: new Blob([f.bytes.slice()]), name: f.name, digestB64: digestB64(f.bytes), placement: null, state: null, asIs: true }));
  const made = await makeTree(inputs, { transport: { fetch: stub.fetch } });
  const evidence = await fetchTreeEvidence(made.proof, { fetch: stub.fetch });
  const built = await buildTreeExport(made.proof, ownerTree(made.rootDocument, made.leavesBytes, made.names), evidence);
  const bundle: HostedFile[] = [
    ...files.map((f) => ({ name: f.name, bytes: f.bytes })),
    { name: ownerExportName(made.proof), bytes: utf8(exportJson(built.exp)) },
    { name: "SPEC.md", bytes: SPEC_BYTES },
    { name: "README.txt", bytes: utf8("what these files are\n") },
  ];
  return { proof: made.proof, bundle };
}

test("the bundle a host serves (files, owner's export, SPEC.md, README) rebuilds the signed tree: the four shown, the rest set aside", async () => {
  const { proof, bundle } = await hostedTree();
  const zipped = unzipHostedBundle(zipSync(Object.fromEntries(bundle.map((f) => [f.name, f.bytes]))))!;
  const m = await matchHostedFiles(proof, zipped);
  assert.ok(m.ok);
  assert.equal(m.kind, "tree");
  assert.deepEqual(m.members.map((f) => f.name).sort(), ["question.json", "request.json", "response.json", "result.json"]);
  assert.deepEqual([...m.extras].sort(), ["README.txt", "SPEC.md", ownerExportName(proof as never)].sort());
});

test("one byte changed in one file: no match, nothing shown", async () => {
  const { proof, bundle } = await hostedTree();
  const tampered = bundle.map((f) => (f.name === "result.json" ? { name: f.name, bytes: utf8('{\n  "right": [true, true]\n}\n') } : f));
  assert.deepEqual(await matchHostedFiles(proof, tampered), { ok: false, problem: "mismatch" });
});

test("a file missing, or only the export and the spec: no match", async () => {
  const { proof, bundle } = await hostedTree();
  assert.equal((await matchHostedFiles(proof, bundle.filter((f) => f.name !== "request.json"))).ok, false);
  assert.equal((await matchHostedFiles(proof, bundle.filter((f) => !f.name.endsWith(".json") || f.name.includes("bitgraph")))).ok, false);
  assert.equal((await matchHostedFiles(proof, [])).ok, false);
});

test("another tree's bundle against this proof: no match, even with its own valid export", async () => {
  const mine = await hostedTree();
  const other = await hostedTree(FOUR().map((f, i) => (i === 0 ? { name: f.name, bytes: utf8("another question\n") } : f)));
  assert.equal((await matchHostedFiles(mine.proof, other.bundle)).ok, false);
});

test("an export that lies about the leaves cannot make a match: the rebuild against the signed root decides", async () => {
  const mine = await hostedTree();
  const other = await hostedTree(FOUR().map((f, i) => (i === 3 ? { name: f.name, bytes: utf8("a different result\n") } : f)));
  // The other tree's files, with THIS proof's genuine export beside them.
  const mixed = [...other.bundle.filter((f) => !f.name.endsWith(".bitgraph.json")), mine.bundle.find((f) => f.name.endsWith(".bitgraph.json"))!];
  assert.equal((await matchHostedFiles(mine.proof, mixed)).ok, false);
});

test("no export in the ZIP: the files alone, or with the spec the proof pins, still rebuild; an unknown extra file then blocks it", async () => {
  const { proof, bundle } = await hostedTree();
  const noExport = bundle.filter((f) => !f.name.endsWith(".bitgraph.json"));
  assert.equal((await matchHostedFiles(proof, noExport.filter((f) => f.name !== "README.txt"))).ok, true, "files + SPEC.md");
  assert.equal((await matchHostedFiles(proof, noExport.filter((f) => f.name !== "README.txt" && f.name !== "SPEC.md"))).ok, true, "files alone");
  assert.equal((await matchHostedFiles(proof, noExport)).ok, false, "a README with no export to set it aside: no match (said plainly, never guessed)");
});

test("placed files (a tree made from ordinary files) rebuild too", async () => {
  const stub = await makeStub();
  const files = [new File([utf8("first\n")], "a.txt"), new File([utf8("second\n")], "b.txt")];
  const inputs: TreeInput[] = [];
  for (const f of files) { const s = await hashBlob(f); inputs.push({ file: f, name: f.name, digestB64: s.digestB64, placement: s.placement, state: s.state }); }
  const made = await makeTree(inputs, { transport: { fetch: stub.fetch } });
  const m = await matchHostedFiles(made.proof, [{ name: "a.txt", bytes: utf8("first\n") }, { name: "b.txt", bytes: utf8("second\n") }]);
  assert.ok(m.ok && m.members.length === 2);
});

test("a single-file proof: the file whose SHA-256 is the signed digest, and nothing else", async () => {
  const bytes = utf8("one recorded file\n");
  const proof = { artifact: { digestB64: digestB64(bytes), hashAlg: "sha256" } };
  const m = await matchHostedFiles(proof, [{ name: "README.txt", bytes: utf8("hi") }, { name: "file.txt", bytes }]);
  assert.ok(m.ok && m.kind === "file" && m.members[0]!.name === "file.txt");
  assert.deepEqual(m.ok && m.extras, ["README.txt"]);
  assert.equal((await matchHostedFiles(proof, [{ name: "file.txt", bytes: utf8("one recorded file!\n") }])).ok, false);
});
