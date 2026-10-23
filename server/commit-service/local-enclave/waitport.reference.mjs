import { connect } from "node:net";
const [port, ms] = [Number(process.argv[2]), Number(process.argv[3] ?? 8000)];
const t0 = Date.now();
const tryOnce = () => new Promise((res) => { const s = connect({ host: "127.0.0.1", port }, () => { s.end(); res(true); }); s.on("error", () => res(false)); });
while (Date.now() - t0 < ms) { if (await tryOnce()) { console.log(`port ${port} up after ${Date.now() - t0}ms`); process.exit(0); } await new Promise((r) => setTimeout(r, 150)); }
console.log(`port ${port} NOT up after ${ms}ms`); process.exit(1);
