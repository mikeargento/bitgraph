/**
 * The anchors export's two load-bearing rules, and the honesty file.
 *
 * Rule 2 (dedup by POSITION) is the one that decides whether this is usable at
 * all: the 48,000 file folder is three sets, so it must produce three needs,
 * not 48,000. Asking per proof is the exact mistake undone on 2026-09-07.
 *
 * Rule 3 (only what is MISSING) is the one that decides whether it converges:
 * a folder this export has already anchored must come back with nothing to
 * fetch, or every drop re-downloads everything forever.
 *
 * And the status doc is the point of the phase: an absence must be able to say
 * whether the upper bound was not FETCHED or does not EXIST.
 *
 * Run: node --test src/lib/__tests__/anchor-export.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  positionsNeedingAnchors, positionCount, anchorDirFor, anchorStatusDoc,
  isResolvable, isSettled, readDropShape, ANCHOR_STATUS_VERSION,
  type ExportSite, type BoundState,
} from "../anchor-export.ts";

const EPOCH = "P1IPCIeBd_gbBGJnbQVSDhKFeI7wVzTzWYbfvzZlqcs";

const site = (dirPath: string[], counter: string | null, opts: Partial<ExportSite> = {}): ExportSite => ({
  dirPath, epochId: EPOCH, counter, hasUpper: false, hasLower: false, ...opts,
});

/* ── Rule 2: a set is ONE position ── */

test("48,000 members of three sets produce THREE needs, not 48,000", () => {
  const sites: ExportSite[] = [];
  for (let i = 0; i < 48_000; i++) {
    // Three sets, exactly as the 48k folder was: every member of a set
    // carries the SAME proof.json, so the same epoch and counter.
    const counter = ["1546", "1547", "1548"][i % 3];
    sites.push(site(["Drop", `member-${i}`], counter));
  }
  const needs = positionsNeedingAnchors(sites);
  assert.equal(needs.length, 3, "one need per position, never one per file");
  assert.equal(positionCount(sites), 3);
  assert.equal(needs.reduce((n, x) => n + x.dirs.length, 0), 48_000, "every dir is still accounted for");
});

test("the same counter in a DIFFERENT epoch is a different position", () => {
  const needs = positionsNeedingAnchors([
    site(["Drop", "a"], "1546"),
    { ...site(["Drop", "b"], "1546"), epochId: "some-other-epoch" },
  ]);
  assert.equal(needs.length, 2, "counters are only unique within an epoch");
});

/* ── Rule 3: only what is missing ── */

test("a fully anchored folder has nothing to fetch", () => {
  const needs = positionsNeedingAnchors([
    site(["Drop", "a"], "10", { hasUpper: true, hasLower: true }),
    site(["Drop", "b"], "11", { hasUpper: true, hasLower: true }),
  ]);
  assert.deepEqual(needs, [], "re-dropping an anchored folder must fetch nothing");
});

test("one side present is not both: a half-anchored position still asks, for its half only", () => {
  const [need] = positionsNeedingAnchors([site(["Drop", "a"], "10", { hasLower: true })]);
  assert.equal(need.needLower, false);
  assert.equal(need.needUpper, true, "the missing upper bound is still wanted");
});

test("ONE member of a set carrying the anchors settles the whole position", () => {
  // The many-dir layout writes a set's anchors once. On the next drop the
  // other 47,999 members still show nothing, and that must not re-trigger it.
  const sites = [
    site(["Drop", "m0"], "1546", { hasUpper: true, hasLower: true }),
    ...Array.from({ length: 999 }, (_, i) => site(["Drop", `m${i + 1}`], "1546")),
  ];
  assert.deepEqual(positionsNeedingAnchors(sites), [], "a position is anchored, not a directory");
});

test("anchors at the TOP of the drop settle the position they name", () => {
  // What the many-dir layout writes, and what a multi-file package export
  // already writes for its batch. discoverDrop cannot see these; this can.
  const sites = Array.from({ length: 1000 }, (_, i) => site(["Drop", `m${i}`], "1546"));
  const root = new Map([["1546", { upper: true, lower: true }]]);
  assert.deepEqual(positionsNeedingAnchors(sites, root), []);
  // ...and a DIFFERENT position at the top settles nothing here.
  assert.equal(positionsNeedingAnchors(sites, new Map([["9999", { upper: true, lower: true }]])).length, 1);
});

test("a proof with no counter is dropped, never guessed at", () => {
  // The anchor routes are keyed by counter and epoch; a digest will not do.
  assert.deepEqual(positionsNeedingAnchors([site(["Drop", "a"], null)]), []);
  assert.deepEqual(positionsNeedingAnchors([{ ...site(["Drop", "a"], "10"), epochId: null }]), []);
  assert.equal(positionCount([site(["Drop", "a"], null)]), 0);
});

/* ── Layout ── */

test("one dir keeps the existing convention; many dirs get one position-keyed copy", () => {
  const [solo] = positionsNeedingAnchors([site(["Drop", "BitGraph (a.jpg)"], "10")]);
  assert.deepEqual(anchorDirFor(solo), ["Drop", "BitGraph (a.jpg)", "ethereum-anchors"],
    "a lone recording must land where every existing export already puts it, or the check never sees it");

  const [set] = positionsNeedingAnchors([site(["Drop", "m0"], "1546"), site(["Drop", "m1"], "1546")]);
  assert.deepEqual(anchorDirFor(set), ["Drop", "ethereum-anchors", "1546"],
    "18.5 KB once, not 887 MB spread over 48,000 member dirs");
});

test("every path stays INSIDE the dropped folder, or the download merges into nothing", () => {
  // The zip's top level is the folder the user dragged in. A path that loses
  // that first segment lands the files beside the folder instead of in it.
  const needs = positionsNeedingAnchors([
    site(["Photos 2024", "BitGraph (a.jpg)"], "10"),
    site(["Photos 2024", "m0"], "1546"), site(["Photos 2024", "m1"], "1546"),
  ]);
  for (const n of needs) {
    assert.equal(anchorDirFor(n)[0], "Photos 2024", `${n.counter} escaped the dropped folder`);
  }
});

test("a bare proof.json with no folder around it produces a path, not a crash", () => {
  const [need] = positionsNeedingAnchors([site([], "10"), site([], "10")]);
  assert.deepEqual(anchorDirFor(need), ["ethereum-anchors", "10"]);
});

test("two sets in one drop do not write over each other", () => {
  const needs = positionsNeedingAnchors([
    site(["D", "a"], "1546"), site(["D", "b"], "1546"),
    site(["D", "c"], "1547"), site(["D", "d"], "1547"),
  ]);
  const dirs = needs.map((n) => anchorDirFor(n).join("/"));
  assert.equal(new Set(dirs).size, 2, "position-keyed, so one set's anchors cannot land on another's path");
});

/* ── Reading the drop's shape ── */

test("a set's own anchors, written once at the top, settle it on the next drop", () => {
  // The round trip that makes this converge: export writes them, the next
  // drop reads them back, and asks for nothing.
  const walked = [
    { file: "p0", path: ["Drop", "m0", "proof.json"] },
    { file: "p1", path: ["Drop", "m1", "proof.json"] },
    { file: "a", path: ["Drop", "ethereum-anchors", "1546", "anchor-after.json"] },
    { file: "b", path: ["Drop", "ethereum-anchors", "1546", "anchor-before.json"] },
  ];
  const { dirPathOf, rootAnchors } = readDropShape(walked);
  assert.deepEqual(dirPathOf.get("p0"), ["Drop", "m0"]);
  assert.deepEqual(rootAnchors.get("1546"), { upper: true, lower: true });
  assert.deepEqual(
    positionsNeedingAnchors([site(["Drop", "m0"], "1546"), site(["Drop", "m1"], "1546")], rootAnchors),
    [], "the second drop of an anchored set must fetch nothing");
});

test("a batch bracket at the top of the drop is NOT counted as anchoring a position", () => {
  // What a multi-file package export writes: one loose bracket for the whole
  // batch. Mike's ruling 2026-09-08 — a position needs its OWN anchors.
  const { rootAnchors } = readDropShape([
    { file: "a", path: ["Drop", "ethereum-anchors", "anchor-after.json"] },
    { file: "b", path: ["Drop", "ethereum-anchors", "anchor-before.json"] },
  ]);
  assert.equal(rootAnchors.size, 0, "a batch bracket names no position, so it settles none");
});

test("an export dir's OWN anchors are not mistaken for the drop's", () => {
  // Dropping a single export folder puts ethereum-anchors/ at depth 1, the
  // same depth a position-keyed dir sits at. The shapes must not collide.
  const { rootAnchors } = readDropShape([
    { file: "p", path: ["BitGraph (a.jpg)", "proof.json"] },
    { file: "a", path: ["BitGraph (a.jpg)", "ethereum-anchors", "anchor-after.json"] },
  ]);
  assert.equal(rootAnchors.size, 0);
});

test("a folder someone named after a counter is not read as evidence", () => {
  const { rootAnchors } = readDropShape([
    { file: "x", path: ["Drop", "ethereum-anchors", "1546", "notes.txt"] },
    { file: "y", path: ["Drop", "ethereum-anchors", "sunset", "anchor-after.json"] },
  ]);
  assert.equal(rootAnchors.size, 0, "only a numeric counter holding a known anchor file counts");
});

/* ── The honesty file ── */

test("resolvable separates 'not fetched' from 'does not exist'", () => {
  // The distinction the whole phase exists for.
  for (const s of ["pending", "unavailable", "undetermined"] as BoundState[]) {
    assert.equal(isResolvable(s), true, `${s} can still complete later`);
  }
  for (const s of ["closed", "none", "unknown-epoch", "anchored"] as BoundState[]) {
    assert.equal(isResolvable(s), false, `${s} will not change by asking again`);
  }
});

test("a status doc tells a reader what to do while anything can still change", () => {
  const pos = { epochId: EPOCH, counter: "9176" };
  const pending = anchorStatusDoc(pos,
    { state: "pending", note: "not yet" }, { state: "anchored", note: "here", block: 25934741 });
  assert.equal(pending.version, ANCHOR_STATUS_VERSION);
  assert.equal(pending.position.counter, "9176");
  assert.match(pending.askedAt, /^\d{4}-\d\d-\d\dT/, "when it was asked is part of the claim");
  assert.ok(pending.advice, "a temporary absence must say it is temporary");

  const closed = anchorStatusDoc(pos,
    { state: "closed", note: "never" }, { state: "anchored", note: "here" });
  assert.equal(closed.advice, undefined, "a permanent absence must not invite a pointless retry");
});

test("a bracket over MANY positions says which counters its two sides are about", () => {
  // The package export's batch bracket: upper follows the highest position,
  // lower precedes the lowest. Naming one counter would make the file meant
  // to end a misreading the source of a new one.
  const doc = anchorStatusDoc({ epochId: EPOCH, counter: "900" },
    { state: "pending", note: "" }, { state: "anchored", note: "" }, new Date(), "100");
  assert.deepEqual(doc.range, { fromCounter: "100", toCounter: "900" });
  // A single position spans nothing, so it says nothing.
  const solo = anchorStatusDoc({ epochId: EPOCH, counter: "900" },
    { state: "pending", note: "" }, { state: "anchored", note: "" }, new Date(), "900");
  assert.equal(solo.range, undefined);
});

test("a settled position gets no status file at all", () => {
  assert.equal(isSettled("anchored", "anchored"), true);
  // Every other combination is unsettled, including the permanent ones: the
  // file's presence is the signal that something is missing, whatever the
  // reason, so 2,566 finished recordings never sprout one saying "fine".
  assert.equal(isSettled("anchored", "none"), false);
  assert.equal(isSettled("closed", "anchored"), false);
  assert.equal(isSettled("unavailable", "anchored"), false);
});
