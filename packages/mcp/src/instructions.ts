// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/** The task-form guidance spoken to MCP callers; the mechanics live in the SDK. */
import { SLOT_TTL_SECONDS } from "@mikeargento/bitgraph-sdk";

export const TASK_INSTRUCTIONS =
  "You hold a position and its commitment, and no work exists yet. Put the commitment string INSIDE THE OUTPUT you are about to make whenever its format can hold text (SVG, HTML, code, JSON, Markdown, CSV, a document): as a comment, a field, a line that stays in the file. " +
  `When the output exists, call bitgraph_commit with this fuse_token and the output file's path, within ${SLOT_TTL_SECONDS} seconds of opening: the output itself is sealed under the position, and the proof is written beside it. ` +
  "If the output cannot hold text (a PNG, audio, video) or will take longer than that to make, put the commitment into a task file instead (the exact prompt or request you send), seal that file the same way, and when the output exists record it with bitgraph_record: the task is sealed before the output existed, and the output is recorded after. " +
  "Keep the exact bytes that were sealed unchanged: a verifier recomputes the commitment from the proof and looks for the string inside them. " +
  "Leave the proof file as written, whole, every field, environment.attestation.reportB64 included: a proof missing slotAllocation, environment, or the attestation cannot be verified.";
