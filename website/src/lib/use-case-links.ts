// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Where BitGraph applies: kinds of records whose order gets disputed, by name. The home page lists them right under
 * its headline as plain text. Each inner list is one line on a phone, so the breaks there are the same on every
 * phone; on wider screens the names run on and wrap where they fit.
 */
export const USE_CASE_ROWS: string[][] = [
  ["Medical records", "Clinical trials", "Scientific papers", "Patents"],
  ["AI evaluations", "AI agents", "Training data", "Synthetic media"],
  ["Software releases", "Security logs", "Court evidence"],
  ["Chain of custody", "Financial records", "Insurance claims"],
  ["Property deeds", "News photos", "Election records"],
];
