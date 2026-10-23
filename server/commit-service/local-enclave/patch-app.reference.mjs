import { readFileSync, writeFileSync } from "node:fs";
const p = process.argv[2];
let src = readFileSync(p, "utf8");
const a = 'const nsmClient = new DefaultNsmClient();';
const b = `// LOCAL HARNESS ONLY: fake NSM so the unmodified slot logic below can run off-Nitro.
import { randomBytes as __rb } from "node:crypto";
const nsmClient = {
  async request(req: Record<string, unknown>): Promise<Record<string, unknown>> {
    if ("DescribePCR" in req) return { DescribePCR: { lock: true, data: new Uint8Array(48).fill(0xab) } };
    if ("GetRandom" in req) return { GetRandom: { random: new Uint8Array(__rb(256)) } };
    if ("Attestation" in req) {
      const ud = (req["Attestation"] as { user_data?: Uint8Array }).user_data ?? new Uint8Array();
      return { Attestation: { document: new TextEncoder().encode("FAKE-NSM-DOC:" + Buffer.from(ud).toString("hex")) } };
    }
    throw new Error("fake NSM: unsupported " + JSON.stringify(Object.keys(req)));
  },
};`;
const c = 'const SOCKET_PATH = "/app/enclave.sock";';
const d = 'const SOCKET_PATH = process.env["ENCLAVE_SOCK"] ?? "/app/enclave.sock";';
if (!src.includes(a) || !src.includes(c)) throw new Error("anchors not found");
src = src.replace(a, b).replace(c, d);
writeFileSync(p, src);
