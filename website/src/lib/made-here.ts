/**
 * Which results this browser made (Mike, 10-06: his own image, reloaded, said "someone clicked"). A
 * per-viewer convenience in localStorage: a reopened result says "you" to the browser that made it and
 * "someone" to everyone else. Never the record of anything; empty or blocked storage just means "someone".
 */
const KEY = "bitgraph-made-here";

export function rememberMade(id: string): void {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!list.includes(id)) { list.push(id); localStorage.setItem(KEY, JSON.stringify(list.slice(-200))); }
  } catch { /* storage unavailable: nothing to remember */ }
}

export function madeHere(id: string): boolean {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).includes(id); } catch { return false; }
}
