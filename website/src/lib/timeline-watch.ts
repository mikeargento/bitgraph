/**
 * The outside check of the enclave host: the site's cron asks the host's /health every five minutes and emails
 * (through the same SNS topic as the host's own alerts) when the host does not answer, answers not ok, or has no
 * timeline running. The host alerts on everything finer; this exists for when the host itself is down and cannot say so.
 *
 * Functions are stateless, so the last verdict is kept in one small object (monitor/timeline-health.json), written
 * only when the verdict changes or a reminder goes out: one email when it goes down, one an hour while it stays down,
 * one when it is back.
 */

export interface WatchState {
  down: boolean;
  since: number | null;
  lastSentAt: number | null;
  reason: string | null;
}

export const WATCH_STATE_KEY = "monitor/timeline-health.json";
export const INITIAL_WATCH_STATE: WatchState = { down: false, since: null, lastSentAt: null, reason: null };

interface HealthTimeline { problems?: unknown; journal?: unknown }

/**
 * Down or up, and why, from /health's answer (or the error asking for it). /health answers
 * { ok, epochId, timeline: { problems, journal }, alerts }. The timeline's problems name what it runs without
 * (a journal kept on disk only, say); they are reported but do not make the host down.
 */
export function judgeHealth(answer: { status: number; body: unknown } | Error, _now?: number): { down: boolean; reason: string } {
  if (answer instanceof Error) return { down: true, reason: `the enclave host did not answer /health: ${answer.message}` };
  if (answer.status !== 200) return { down: true, reason: `the enclave host answered /health with HTTP ${answer.status}` };
  const b = answer.body as { ok?: boolean; timeline?: HealthTimeline | null } | null;
  if (!b || b.ok !== true) return { down: true, reason: "the enclave host's /health is not ok" };
  const t = b.timeline;
  if (!t || typeof t !== "object") return { down: true, reason: "the timeline is not running on the enclave host" };
  const problems = Array.isArray(t.problems) ? t.problems.filter((p): p is string => typeof p === "string") : [];
  return { down: false, reason: problems.length ? `up, running without: ${problems.join("; ")}` : "up" };
}

/** The next state, and the email to send now, if any. */
export function decideWatch(prev: WatchState, verdict: { down: boolean; reason: string }, now: number, repeatMs = 3_600_000): { next: WatchState; email: { subject: string; body: string } | null } {
  if (verdict.down && !prev.down) {
    return { next: { down: true, since: now, lastSentAt: now, reason: verdict.reason }, email: { subject: "[BitGraph timeline] OUTSIDE CHECK: down", body: verdict.reason } };
  }
  if (verdict.down && prev.down) {
    if (prev.lastSentAt !== null && now - prev.lastSentAt < repeatMs) return { next: prev, email: null };
    return { next: { ...prev, lastSentAt: now, reason: verdict.reason }, email: { subject: "[BitGraph timeline] OUTSIDE CHECK: still down", body: `${verdict.reason}\n(down since ${new Date(prev.since ?? now).toISOString()})` } };
  }
  if (!verdict.down && prev.down) {
    return { next: INITIAL_WATCH_STATE, email: { subject: "[BitGraph timeline] OUTSIDE CHECK: back", body: `back after ${Math.round((now - (prev.since ?? now)) / 60_000)} min: ${verdict.reason}` } };
  }
  return { next: prev, email: null };
}
