// Scratch fake enclave: a loopback TCP server that speaks the SAME wire protocol
// the parent's VsockClient uses (raw JSON in, JSON out, socket.end on reply),
// so the REAL parent server.ts can be exercised without Nitro/vsock.
// It mirrors enclave/app.ts handleAllocateSlot/handleCommit control flow
// (pending-slot pool, single-use consumption) and, like the real enclave,
// has NO anchor concept whatsoever. It is anchor-blind by construction.
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

const PORT = Number(process.argv[2] ?? 19000);
const epochId = randomBytes(32).toString("base64");
const publicKeyB64 = randomBytes(32).toString("base64");
const measurement = "ab".repeat(48); // non-zero: parent's debug-mode guard stays quiet
let counter = 0n;
const pendingSlots = new Map();
const SLOT_TTL_MS = 120_000;
const MAX_PENDING_SLOTS = 1000;
const actionsSeen = [];

function cleanExpiredSlots() {
  const now = Date.now();
  for (const [k, v] of pendingSlots) if (now >= v.expiresAt) pendingSlots.delete(k);
}

async function handleRequest(req) {
  const action = req.action;
  actionsSeen.push(action);
  process.stdout.write(`[fake-enclave] action=${action} counter=${counter} pending=${pendingSlots.size}\n`);
  switch (action) {
    case "init":
      return { counter: "0", epochId, chains: 1 };
    case "key":
      return { publicKeyB64, measurement, enforcement: "measured-tee", epochId };
    case "challenge":
      return { challenge: randomBytes(32).toString("base64") };
    case "allocateSlot": {
      cleanExpiredSlots();
      if (pendingSlots.size >= MAX_PENDING_SLOTS) throw new Error("Too many pending slots — try again later");
      counter += 1n;
      const nonceB64 = randomBytes(32).toString("base64");
      const slot = { version: "bitgraph/slot/1", nonceB64, counter: String(counter), epochId, publicKeyB64, signatureB64: "FAKE-NOT-A-SIGNATURE" };
      pendingSlots.set(nonceB64, { record: slot, expiresAt: Date.now() + SLOT_TTL_MS });
      return { slotId: nonceB64, slot, chainId: "default" };
    }
    case "commitDigest": {
      cleanExpiredSlots();
      const entry = pendingSlots.get(req.slotId);
      if (!entry) throw new Error("Slot not found or expired — call allocateSlot before committing");
      pendingSlots.delete(req.slotId);
      counter += 1n;
      const proof = {
        version: "bitgraph/1",
        artifact: { digestB64: req.digestB64, hashAlg: "sha256" },
        commit: { counter: String(counter), epochId, publicKeyB64, slot: entry.record },
        attribution: req.attribution ?? null,
        signatureB64: "FAKE-NOT-A-SIGNATURE",
      };
      return { proof };
    }
    default:
      return { error: `Unknown action: ${String(action)}` };
  }
}

const server = createServer({ allowHalfOpen: true }, (socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let request;
    try { request = JSON.parse(buffer); } catch { return; }
    buffer = "";
    handleRequest(request)
      .then((response) => socket.end(JSON.stringify(response)))
      .catch((err) => socket.end(JSON.stringify({ error: `Enclave error: ${err.message}` })));
  });
  socket.on("error", () => {});
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`[fake-enclave] listening 127.0.0.1:${PORT} epochId=${epochId}\n`);
});

process.on("SIGTERM", () => {
  process.stdout.write(`[fake-enclave] actions seen: ${JSON.stringify(actionsSeen)}\n`);
  process.exit(0);
});
