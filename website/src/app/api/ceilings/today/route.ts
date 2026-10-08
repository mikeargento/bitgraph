import { NextResponse } from "next/server";
import { listKeysUnderPrefix } from "@/lib/s3";

export const dynamic = "force-dynamic";

// How many ceiling writes today (UTC) has, and the newest key: one LIST, no reads. The Base page polls this
// while it shows today and refreshes itself only when the answer changes (Mike, 2026-10-08: "the base
// transaction page doesnt fetch dynamically and you have to refresh page").
export async function GET() {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const keys = await listKeysUnderPrefix(`ceilings/writes/${day}/`);
    keys.sort();
    return NextResponse.json({ day, count: keys.length, last: keys[keys.length - 1] ?? null }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ledger unreadable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
