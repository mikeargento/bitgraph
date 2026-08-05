// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The current released version of BitGraph Folder.
 *
 * Served as a response header on /api/commit so an installed Folder can notice
 * it is behind. The version travels DOWNWARD ONLY: the site states its own, the
 * Folder compares locally, and nothing about the client is ever sent. That is
 * the whole reason this is acceptable in a tool whose claim is that nothing
 * leaves your machine. No timer, no beacon, no extra request; it rides on the
 * commit the user already asked for by dropping a file.
 *
 * ⚠️ REWRITTEN AUTOMATICALLY by packages/folder/build-pkg.sh from
 * packages/folder/VERSION. Do not edit by hand: cutting a release updates this,
 * which is what stops it drifting behind the thing it advertises.
 */
export const FOLDER_VERSION = "1.7.1";
