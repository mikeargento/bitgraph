// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A copy's holder chose to record it as a BitGraph of its own (the first file lost; a re-export is new bytes). The file
 * and the earliest BitGraph of its picture ride to Make in a module slot, as a held copy does (held-copy.ts); Make
 * records the file without looking for its original again and then notes the first beside the new position
 * (app/api/lineage). Read once; a reload of Make finds nothing and does nothing.
 */
export type FirstPosition = { digestB64: string; epochId: string; counter: string };
export type RecordAgain = { name: string; data: ArrayBuffer; first: FirstPosition };

let slot: RecordAgain | null = null;

export function setRecordAgain(r: RecordAgain) { slot = r; }
export function takeRecordAgain(): RecordAgain | null { const r = slot; slot = null; return r; }
