// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The retirement notice for BitGraph Folder, served as a response header on
 * /api/commit.
 *
 * Folder was retired on 2026-09-01 and every release was delisted, so there is
 * no version left to advertise. What this header still is, is the ONLY channel
 * that reaches a copy someone already installed: an installed Folder reads
 * X-BitGraph-Folder-Version off every commit response and notifies once per
 * new value, with no timer, no beacon, and nothing about the client ever sent
 * upward. Deleting the header would have been tidier and would have said
 * nothing to the people still running the tool.
 *
 * So the value carries the message instead. An installed 1.15.1 renders it as:
 *
 *   BitGraph Folder RETIRED-uninstall-see-bitgraph.ing is out; this is 1.15.1
 *
 * which is graceless, because the sentence around it is hardcoded in a shipped
 * binary we no longer control. It is legible and it is actionable, which beats
 * silence. The value is header-safe: printable ASCII, no spaces, no newlines.
 *
 * ⚠️ TEMPORARY. Once the notice has had time to land, delete this file and the
 * VERSION_HEADER it feeds in app/api/commit/route.ts. Nothing else reads it.
 * There will be no Folder release to rewrite it: build-pkg.sh is gone with the
 * package.
 */
export const FOLDER_VERSION = "RETIRED-uninstall-see-bitgraph.ing";
