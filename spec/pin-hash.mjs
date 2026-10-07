// Recompute SHA-256(spec/SPEC.md) and write it into KNOWN_TREE_SPEC_HASHES as the v1 entry;
// then pin spec/SPEC-v2.md as TREE_SPEC_V2_HASH unless FROZEN.json has frozen v2.
// Run from the repo root: node spec/pin-hash.mjs
//
// FROZEN (2026-10-04): spec/FROZEN.json records v1's hash. Once it is there, this tool
// never rewrites v1. An edited SPEC.md is v2: its hash is added BESIDE v1 in tree.ts by
// hand, with its own entry in FROZEN.json when it freezes, and every verifier keeps both.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const spec = readFileSync(new URL("./SPEC.md", import.meta.url));
const b64 = createHash("sha256").update(spec).digest("base64");
const frozenPath = new URL("./FROZEN.json", import.meta.url);
if (existsSync(frozenPath)) {
  const frozen = JSON.parse(readFileSync(frozenPath, "utf8"));
  const v1 = frozen.v1?.sha256_b64;
  if (v1 === b64) {
    console.log(`SPEC.md SHA-256 (base64): ${b64} (v1, frozen ${frozen.v1.frozen_on}; nothing to pin)`);
    // v2 beside it: pinned into tree.ts until FROZEN.json records it, never after.
    const v2Path = new URL("./SPEC-v2.md", import.meta.url);
    if (existsSync(v2Path)) {
      const b64v2 = createHash("sha256").update(readFileSync(v2Path)).digest("base64");
      if (frozen.v2) {
        if (frozen.v2.sha256_b64 !== b64v2) {
          console.error(`SPEC-v2.md is frozen at ${frozen.v2.sha256_b64} and now hashes to ${b64v2}; v2 never changes: make it v3, beside it.`);
          process.exit(1);
        }
        console.log(`SPEC-v2.md SHA-256 (base64): ${b64v2} (v2, frozen ${frozen.v2.frozen_on}; nothing to pin)`);
        process.exit(0);
      }
      const treePath = new URL("../packages/verify/src/tree.ts", import.meta.url);
      const tree = readFileSync(treePath, "utf8");
      const re2 = /(export const TREE_SPEC_V2_HASH = )"[^"]*"/;
      if (!re2.test(tree)) throw new Error("TREE_SPEC_V2_HASH not found in tree.ts");
      writeFileSync(treePath, tree.replace(re2, `$1"${b64v2}"`));
      console.log(`SPEC-v2.md SHA-256 (base64): ${b64v2} (v2, pinned; not frozen yet)`);
    }
    process.exit(0);
  }
  console.error(`SPEC.md v1 is frozen at ${v1} (${frozen.v1.frozen_on}) and the file now hashes to ${b64}.`);
  console.error("v1 never changes. Either restore the frozen text, or make this a new version: add the new hash beside v1 in packages/verify/src/tree.ts (KNOWN_TREE_SPEC_HASHES), bump the version line in SPEC.md, and record v2 in spec/FROZEN.json when it freezes.");
  process.exit(1);
}
const path = new URL("../packages/verify/src/tree.ts", import.meta.url);
const src = readFileSync(path, "utf8");
const re = /(\/\/ SPEC\.md v1 \(spec\/SPEC\.md\)\.[^\n]*\n\s*)"[^"]*"/;
if (!re.test(src)) throw new Error("v1 spec hash slot not found in tree.ts");
writeFileSync(path, src.replace(re, `$1"${b64}"`));
console.log(`SPEC.md SHA-256 (base64): ${b64}`);
