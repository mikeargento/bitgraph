// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Strong Kleene three-valued connectives.
 *
 *   all: FALSE if any FALSE; else UNDETERMINED if any UNDETERMINED; else TRUE
 *   any: TRUE  if any TRUE;  else UNDETERMINED if any UNDETERMINED; else FALSE
 *   not: TRUE <-> FALSE; UNDETERMINED stays UNDETERMINED
 *
 * UNDETERMINED is not a nuisance value: it is the honest answer wherever
 * the evidence does not decide, and these tables are what keep it from
 * being laundered into FALSE by composition.
 */

import type { ThreeValued } from "./types.js";

export function kleeneNot(v: ThreeValued): ThreeValued {
  if (v === "TRUE") return "FALSE";
  if (v === "FALSE") return "TRUE";
  return "UNDETERMINED";
}

export function kleeneAll(values: readonly ThreeValued[]): ThreeValued {
  let sawUndetermined = false;
  for (const v of values) {
    if (v === "FALSE") return "FALSE";
    if (v === "UNDETERMINED") sawUndetermined = true;
  }
  return sawUndetermined ? "UNDETERMINED" : "TRUE";
}

export function kleeneAny(values: readonly ThreeValued[]): ThreeValued {
  let sawUndetermined = false;
  for (const v of values) {
    if (v === "TRUE") return "TRUE";
    if (v === "UNDETERMINED") sawUndetermined = true;
  }
  return sawUndetermined ? "UNDETERMINED" : "FALSE";
}
