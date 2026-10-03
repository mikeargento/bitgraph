// Recompute SHA-256(spec/SPEC.md) and write it into KNOWN_TREE_SPEC_HASHES as the v1 entry.
// Run from the repo root: node spec/pin-hash.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const spec = readFileSync(new URL("./SPEC.md", import.meta.url));
const b64 = createHash("sha256").update(spec).digest("base64");
const path = new URL("../packages/verify/src/tree.ts", import.meta.url);
const src = readFileSync(path, "utf8");
const re = /(\/\/ SPEC\.md v1 \(spec\/SPEC\.md\)\.[^\n]*\n\s*)"[^"]*"/;
if (!re.test(src)) throw new Error("v1 spec hash slot not found in tree.ts");
writeFileSync(path, src.replace(re, `$1"${b64}"`));
console.log(`SPEC.md SHA-256 (base64): ${b64}`);
