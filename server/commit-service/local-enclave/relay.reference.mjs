// TCP -> Unix-socket relay standing in for the production socat vsock bridge
// (socat TCP-LISTEN:9000,fork VSOCK-CONNECT:cid:5000). One upstream connection per TCP connection.
import { createServer, connect } from "node:net";
const sock = process.env["ENCLAVE_SOCK"];
const port = Number(process.env["RELAY_PORT"] ?? 19000);
let n = 0;
createServer((tcp) => {
  const id = ++n; const t0 = Date.now(); let action = "?";
  const u = connect(sock);
  tcp.on("data", (d) => { try { const j = JSON.parse(d.toString()); action = j.action + (j.slotId ? " slot=" + String(j.slotId).slice(0, 8) : ""); } catch {} u.write(d); });
  u.on("data", (d) => tcp.write(d));
  tcp.on("end", () => u.end());
  u.on("end", () => { tcp.end(); console.log(`[relay] tcp#${id} ${action} closed after ${Date.now() - t0}ms`); });
  tcp.on("error", (e) => { console.log(`[relay] tcp#${id} error ${e.message}`); u.destroy(); });
  u.on("error", (e) => { console.log(`[relay] unix#${id} error ${e.message}`); tcp.destroy(); });
}).listen(port, "127.0.0.1", () => console.log(`[relay] listening 127.0.0.1:${port} -> ${sock}`));
