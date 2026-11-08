// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Alerts for the timeline, checked inside the parent every 30 s and sent by email through an SNS topic.
 *
 * Conditions (each has a key; an email goes out when a condition starts, again every hour while it lasts, and once
 * when it clears):
 *
 *   upload                    the journal's last S3 upload failed
 *
 * notice() sends a one-off message, such as a new epoch at parent start.
 *
 * This only sees what the parent sees: a parent that is down sends nothing, so the site's cron checks /health from
 * outside as well. At most 30 emails an hour leave this process, whatever happens.
 */

import type { TimelineStatus } from "./timeline.js";

export interface AlertSettings {
  repeatMs: number;
  maxPerHour: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  repeatMs: 60 * 60_000,
  maxPerHour: 30,
};

export interface AlertInputs {
  timeline: TimelineStatus;
}

export interface Condition { key: string; message: string }

/** Sends one email: a subject and a body. */
export type AlertSend = (subject: string, body: string) => Promise<void>;

export function evaluate(inputs: AlertInputs): Condition[] {
  const out: Condition[] = [];
  if (inputs.timeline.journal.uploading && inputs.timeline.journal.lastError) out.push({ key: "upload", message: `S3 upload of the timeline journal failed: ${inputs.timeline.journal.lastError}` });
  return out;
}

export class TimelineAlerter {
  private readonly active = new Map<string, { since: number; lastSent: number; message: string }>();
  private readonly sentAt: number[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly send: AlertSend, private readonly inputs: () => AlertInputs, private readonly settings: AlertSettings = DEFAULT_ALERT_SETTINGS, private readonly now: () => number = Date.now, private readonly log: (m: string) => void = () => {}) {}

  /** A one-off message (a new epoch). */
  async notice(subject: string, body: string): Promise<void> {
    await this.deliver(`[BitGraph timeline] ${subject}`, body);
  }

  async check(): Promise<void> {
    const now = this.now();
    const conditions = evaluate(this.inputs());
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
