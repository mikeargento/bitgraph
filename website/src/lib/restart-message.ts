// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.
/**
 * What a visitor reads when BitGraph's enclave cannot take a position (the retryable 503 "tee-restarting").
 * Since 2026-10-11 it says exactly what is happening and that it is back in a minute. The same 503 also covers
 * a moment when the enclave host does not answer or no floor block is ready yet, so the daily restart is named
 * only inside its window (23:57 to 00:05 UTC); outside it the message says the plainer thing.
 */
export function restartMessage(now: number = Date.now()): string {
  const d = new Date(now);
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  const inDailyRestart = minute >= 23 * 60 + 57 || minute < 5;
  return inDailyRestart
    ? "BitGraph is restarting. It does this once a day at 23:59 UTC to renew its signing key, and it will be back online in about a minute. Nothing was recorded; try again then."
    : "BitGraph's enclave is not answering for a moment. It will be back online in about a minute. Nothing was recorded; try again then.";
}
