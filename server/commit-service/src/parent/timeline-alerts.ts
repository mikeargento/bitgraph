// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Alerts for the block timeline, checked inside the parent every 30 s and sent by email through an SNS topic.
 *
 * Conditions (each has a key; an email goes out when a condition starts, again every hour while it lasts, and once
 * when it clears):
 *
 *   reads-stopped:<chain>     no block bound for 20 s on Base, 60 s on Ethereum (settable)
 *   lag-streak:<chain>        more than 3 Base reads in a row, or 2 Ethereum reads, outside the lag limits
 *   lag-median:base           the median Base lag over 5 minutes above 3 s
 *   disagree:<chain>          the two providers answered differently in the last 5 minutes
 *   upload                    the journal's last S3 upload failed
 *   genesis-stuck             the epoch's genesis write requested more than 10 minutes ago and not yet bound
 *   enclave                   the enclave refused or failed binds (not initialized, unreachable): it restarted or
 *                             is down. A new epoch at parent start is also sent once, as a notice.
 *
 * This only sees what the parent sees: a parent that is down sends nothing, so the site's cron checks /health from
 * outside as well. At most 30 emails an hour leave this process, whatever happens.
 */

import type { TimelineStatus } from "./timeline.js";

export interface AlertSettings {
  readsStoppedS: { base: number; ethereum: number };
  streak: { base: number; ethereum: number };
  baseMedianMaxS: number;
  genesisStuckMs: number;
  repeatMs: number;
  maxPerHour: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  readsStoppedS: { base: 20, ethereum: 60 },
  streak: { base: 3, ethereum: 2 },
  baseMedianMaxS: 3,
  genesisStuckMs: 10 * 60_000,
  repeatMs: 60 * 60_000,
  maxPerHour: 30,
};

export interface AlertInputs {
  timeline: TimelineStatus;
  /** When the genesis write was requested, while it is not yet bound; null when bound or not asked. */
  genesisPendingSinceMs: number | null;
  /** When this parent started reading (reads-stopped waits this long before the first read). */
  startedAtMs: number;
}

export interface Condition { key: string; message: string }

/** Sends one email: a subject and a body. */
export type AlertSend = (subject: string, body: string) => Promise<void>;

const ENCLAVE_DOWN = /not initialized|Enclave error|ECONNREFUSED|ECONNRESET|socket hang up|timed out/i;

export function evaluate(inputs: AlertInputs, now: number, s: AlertSettings, disagreedRecently: (chain: string, count: number) => boolean): Condition[] {
  const out: Condition[] = [];
  for (const c of inputs.timeline.chains) {
    const ch = c.chain;
    const name = ch === "base" ? "Base" : "Ethereum";
    const since = c.lastReadAtMs ?? inputs.startedAtMs;
    const idleS = (now - since) / 1000;
    if (idleS > s.readsStoppedS[ch]) out.push({ key: `reads-stopped:${ch}`, message: `${name} reads stopped: none bound for ${Math.round(idleS)} s (last block ${c.last?.number ?? "none"}; ${c.lastError ?? "no error reported"})` });
    if (c.outOfRangeStreak > s.streak[ch]) out.push({ key: `lag-streak:${ch}`, message: `${name}: ${c.outOfRangeStreak} reads in a row outside the lag limits (last lag ${c.lagS?.toFixed(1)} s)` });
    if (ch === "base" && c.medianLag5mS !== null && c.medianLag5mS > s.baseMedianMaxS) out.push({ key: "lag-median:base", message: `Base median lag over 5 minutes is ${c.medianLag5mS.toFixed(1)} s (limit ${s.baseMedianMaxS} s)` });
    if (disagreedRecently(ch, c.disagreements)) out.push({ key: `disagree:${ch}`, message: `${name}: the two providers answered differently (${c.disagreements} times since start; last: ${c.lastError ?? "?"})` });
    if (c.lastError && ENCLAVE_DOWN.test(c.lastError)) out.push({ key: "enclave", message: `the enclave refused or failed a bind: ${c.lastError}` });
  }
  if (inputs.timeline.journal.uploading && inputs.timeline.journal.lastError) out.push({ key: "upload", message: `S3 upload of the timeline journal failed: ${inputs.timeline.journal.lastError}` });
  if (inputs.genesisPendingSinceMs !== null && now - inputs.genesisPendingSinceMs > s.genesisStuckMs) {
    out.push({ key: "genesis-stuck", message: `the epoch's genesis write to Base was requested ${Math.round((now - inputs.genesisPendingSinceMs) / 60_000)} min ago and is not bound yet` });
  }
  // One enclave condition is enough, however many chains saw it.
  return out.filter((c, i) => out.findIndex((d) => d.key === c.key) === i);
}

export class TimelineAlerter {
  private readonly active = new Map<string, { since: number; lastSent: number; message: string }>();
  private readonly sentAt: number[] = [];
  private readonly lastDisagreement = new Map<string, { count: number; at: number }>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly send: AlertSend, private readonly inputs: () => AlertInputs, private readonly settings: AlertSettings = DEFAULT_ALERT_SETTINGS, private readonly now: () => number = Date.now, private readonly log: (m: string) => void = () => {}) {}

  /** A one-off message (a new epoch). */
  async notice(subject: string, body: string): Promise<void> {
    await this.deliver(`[BitGraph timeline] ${subject}`, body);
  }

  async check(): Promise<void> {
    const now = this.now();
    // A disagreement counts as recent for five minutes after the count last went up.
    const disagreed = (chain: string, count: number) => {
      const seen = this.lastDisagreement.get(chain) ?? { count: 0, at: 0 };
      if (count > seen.count) this.lastDisagreement.set(chain, { count, at: now });
      const at = this.lastDisagreement.get(chain)?.at ?? 0;
      return at > 0 && now - at < 5 * 60_000;
    };
    const conditions = evaluate(this.inputs(), now, this.settings, disagreed);
    const keys = new Set(conditions.map((c) => c.key));
    for (const c of conditions) {
      const a = this.active.get(c.key);
      if (!a) {
        this.active.set(c.key, { since: now, lastSent: now, message: c.message });
        await this.deliver(`[BitGraph timeline] ALERT ${c.key}`, c.message);
      } else if (now - a.lastSent >= this.settings.repeatMs) {
        a.lastSent = now;
        await this.deliver(`[BitGraph timeline] STILL ${c.key}`, `${c.message}\n(since ${new Date(a.since).toISOString()})`);
      }
    }
    for (const [key, a] of this.active) {
      if (keys.has(key)) continue;
      this.active.delete(key);
      await this.deliver(`[BitGraph timeline] RESOLVED ${key}`, `cleared after ${Math.round((now - a.since) / 1000)} s: ${a.message}`);
    }
  }

  /** The conditions active now, for /health. */
  activeKeys(): string[] {
    return [...this.active.keys()];
  }

  private async deliver(subject: string, body: string): Promise<void> {
    const now = this.now();
    while (this.sentAt.length && this.sentAt[0]! < now - 3_600_000) this.sentAt.shift();
    if (this.sentAt.length >= this.settings.maxPerHour) { this.log(`[timeline] alert not sent (hourly cap): ${subject}`); return; }
    this.sentAt.push(now);
    try { await this.send(subject, body); this.log(`[timeline] alert sent: ${subject}`); }
    catch (e) { this.log(`[timeline] alert could not be sent (${e instanceof Error ? e.message : String(e)}): ${subject}`); }
  }

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

/** The production sender: publish to an SNS topic whose email subscription delivers it. */
export function snsAlertSend(topicArn: string, region: string): AlertSend {
  type Sdk = { SNSClient: new (c: { region: string }) => { send: (cmd: unknown) => Promise<unknown> }; PublishCommand: new (p: Record<string, unknown>) => unknown };
  let sdk: Sdk | undefined;
  let client: { send: (cmd: unknown) => Promise<unknown> } | undefined;
  return async (subject, body) => {
    if (!sdk) { sdk = (await import("@aws-sdk/client-sns" as string)) as Sdk; client = new sdk.SNSClient({ region }); }
    await client!.send(new sdk.PublishCommand({ TopicArn: topicArn, Subject: subject.slice(0, 99), Message: body }));
  };
}
