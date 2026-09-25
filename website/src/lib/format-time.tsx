/**
 * Time display: UTC by default, with the zone named on every value.
 *
 * ⚠️ UTC IS THE DEFAULT, NOT THE VIEWER'S ZONE (Mike, 2026-09-15: "whatever
 * time you list on the proof, when i click that eth link, it should match
 * exact"). Every instant the site prints is an Ethereum block time or the
 * enclave's signed clock, and the block times sit beside Etherscan links,
 * which show UTC. In the viewer's zone the same block read 1:25:47 PM here
 * and 5:25:47 PM there, so the page contradicted its own link.
 *
 * 2026-09-25: a LABELED local toggle is allowed on top of that rule. The
 * viewer opts in per browser, every value keeps its zone name ("9:45:01 PM
 * EDT"), so a screenshot stays unambiguous without knowing whose machine
 * took it, and Etherscan's own pages carry the same UTC/local switch for
 * the cross-check. Nothing is recorded; the preference lives in this
 * browser only, and UTC returns on any machine that never chose.
 *
 * In a phrase with two times ("between X and Y"), tag only the closing
 * time: one zone per phrase.
 */

import React, { useSyncExternalStore } from "react";

export type TimeZoneMode = "utc" | "local";

const STORAGE_KEY = "bitgraph-timezone";
let mode: TimeZoneMode = "utc";
let storageRead = false;
const subscribers = new Set<() => void>();

const notify = () => { for (const fn of subscribers) fn(); };

/** First subscription (client only, after hydration): adopt the remembered choice. */
function readStorageOnce() {
  if (storageRead) return;
  storageRead = true;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === "local" && mode !== "local") {
      mode = "local";
      queueMicrotask(notify);
    }
  } catch {
    // Private windows or blocked storage: the default stands.
  }
}

export function timeZoneMode(): TimeZoneMode {
  return mode;
}

export function setTimeZoneMode(next: TimeZoneMode): void {
  if (next === mode) return;
  mode = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The flip still applies for this page view.
  }
  notify();
}

/**
 * Subscribe a component to the displayed zone. Components that PRINT times
 * call this once so a toggle re-renders them; the formatters below then read
 * the current mode. Server and first client render are always UTC, so
 * hydration never mismatches; a remembered "local" applies right after.
 */
export function useTimeZoneMode(): TimeZoneMode {
  return useSyncExternalStore(
    (onChange) => {
      subscribers.add(onChange);
      readStorageOnce();
      return () => subscribers.delete(onChange);
    },
    () => mode,
    () => "utc"
  );
}

const zoned = (withName: boolean): Intl.DateTimeFormatOptions =>
  mode === "utc"
    ? withName ? { timeZone: "UTC", timeZoneName: "short" } : { timeZone: "UTC" }
    : withName ? { timeZoneName: "short" } : {};

/** "12:02:47 PM UTC" (or "8:02:47 AM EDT" when the viewer chose local). */
export const timeTz = (d: Date) => d.toLocaleTimeString("en-US", zoned(true));

/** "7/15/2026, 12:02:47 PM UTC" */
export const stampTz = (d: Date) => d.toLocaleString("en-US", zoned(true));

/** "12:02:47 PM" — no zone, for the OPENING time in a two-time phrase (the
 *  closing time carries the one shared zone). */
export const timeNoTz = (d: Date) => d.toLocaleTimeString("en-US", zoned(false));

/** "7/15/2026, 12:02:47 PM" — no zone, opening stamp of a two-stamp phrase. */
export const stampNoTz = (d: Date) => d.toLocaleString("en-US", zoned(false));

/** "September 25, 2026" in the displayed zone (a date is zone-dependent too). */
export const longDateTz = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", ...(mode === "utc" ? { timeZone: "UTC" } : {}) });

/** "9/25/2026" in the displayed zone. */
export const dateTz = (d: Date) => d.toLocaleDateString("en-US", zoned(false));

/** Same calendar day in the DISPLAYED zone, so headings and their times agree. */
export const sameDayTz = (a: Date, b: Date) => dateTz(a) === dateTz(b);

/** The viewer's own short zone name ("EDT"), for the toggle's label and tip. */
function localZoneName(): string {
  try {
    const parts = new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ");
    return parts[parts.length - 1] ?? "local";
  } catch {
    return "local";
  }
}

/**
 * The zone word as the control: reads "UTC" and flips every displayed time to
 * the viewer's zone (relabeled), click again for UTC. Plain text, one weight,
 * no box; the dotted underline is the only hint it acts.
 */
export function TimeZoneToggle({ style }: { style?: React.CSSProperties }) {
  const current = useTimeZoneMode();
  const local = localZoneName();
  return (
    <button
      type="button"
      onClick={() => setTimeZoneMode(current === "utc" ? "local" : "utc")}
      title={current === "utc" ? `Show times in your zone (${local})` : "Show times in UTC"}
      style={{
        background: "none", border: 0, padding: 0, margin: 0, font: "inherit",
        color: "var(--dim)", cursor: "pointer",
        textDecoration: "underline dotted", textUnderlineOffset: 3,
        ...style,
      }}
    >
      {current === "utc" ? "UTC" : local}
    </button>
  );
}
