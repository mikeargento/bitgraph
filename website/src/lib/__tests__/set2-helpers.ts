// Re-exports for the set/2 site test, in one place so the test reads plainly.
export { computeSlotCommitment, buildSetRoot, buildSetTree, buildSetMemberProof, bytesToBase64 } from "@mikeargento/bitgraph-verify";
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let s = "";
  for (let i = 0; i < d.length; i++) s += String.fromCharCode(d[i]!);
  return btoa(s);
}
