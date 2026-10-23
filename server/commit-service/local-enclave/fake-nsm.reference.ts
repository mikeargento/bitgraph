// Scratchpad-only stand-in for /dev/nsm. Records every user_data it is asked to attest.
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { encode } from "cbor2";
const LOG = process.env["NSM_LOG"] ?? "/dev/null";
export class FakeNsmClient {
  async request(req: Record<string, unknown>): Promise<Record<string, unknown>> {
    const [cmd, args] = Object.entries(req)[0]!;
    if (cmd === "DescribePCR") return { DescribePCR: { lock: true, data: new Uint8Array(48).fill(0xab) } };
    if (cmd === "GetRandom") return { GetRandom: { random: new Uint8Array(randomBytes(256)) } };
    if (cmd === "Attestation") {
      const ud = (args as { user_data?: Uint8Array }).user_data;
      appendFileSync(LOG, (ud ? Buffer.from(ud).toString("base64") : "<none>") + "\n");
      return { Attestation: { document: encode({ fake: "attestation", user_data: ud ?? null }) } };
    }
    throw new Error("FakeNsmClient: unknown command " + cmd);
  }
}
