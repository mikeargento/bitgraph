// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Consumption markers: the thread's spent-bit.
 *
 * Competing conveyances from one head are sealed files — a receiver
 * cannot SEE whether someone else already accepted a give from the same
 * head. The marker closes that gap: a deterministic, UNSALTED file
 * derived from a message's digest. Every holder of that message derives
 * the SAME bytes, so recording the marker collides via dedup for anyone
 * after the first.
 *
 * WHICH message: the marker that consumes a handoff is the marker of
 * the HEAD BEING HANDED OFF — the file the give's `re` names. The taker
 * derives it and records it. Any later buyer offered a competing give
 * re: the same head derives exactly the same marker from that give's
 * `re` and finds it already recorded: "fresh means unclaimed; a dedup
 * hit means someone already consumed this head." A marker of the GIVE
 * itself would protect nothing: only the give's own named recipient
 * could ever collide with it.
 *
 * Only holders of the predecessor can derive it (a message's digest is
 * unguessable thanks to its salt), so the marker leaks nothing to
 * strangers. And it is DISCOVERY, never VALIDITY: a recorded marker with
 * no valid take behind it is a pulled fire alarm — flag and investigate,
 * never invalidate. Validity is signatures; markers are convenience.
 *
 * Recording the marker file is done through the ordinary BitGraph
 * surfaces, like every other recording. This module only derives bytes.
 */

const MARKER_VERSION = "bitgraph-pm-marker/1";

/**
 * The canonical marker bytes for a predecessor message file digest
 * (lowercase hex). Deterministic and unsalted BY DESIGN: determinism is
 * what makes the second claimant collide.
 */
export function markerBytes(predecessorSha256Hex: string): Buffer {
  const ordered = {
    marker: MARKER_VERSION,
    of: `sha256:${predecessorSha256Hex.toLowerCase()}`,
  };
  return Buffer.from(JSON.stringify(ordered, null, 2) + "\n", "utf8");
}

/** Parse candidate bytes as a marker; undefined for anything else. */
export function parseMarker(bytes: Uint8Array): { of: string } | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj["marker"] !== MARKER_VERSION) return undefined;
  const of = obj["of"];
  if (typeof of !== "string" || !/^sha256:[0-9a-f]{64}$/.test(of)) return undefined;
  if (Object.keys(obj).length !== 2) return undefined;
  return { of };
}
