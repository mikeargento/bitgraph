/**
 * The folder names of a BitGraph download package, as the drop box reads them.
 * Packages are not built here; packages people already hold still check, so their
 * layout is kept:
 *
 *   README.md                     how to read the package, the claim and its limits
 *   proof.json                    the signed proof
 *   committed/<name>              the exact bytes the proof's digest names
 *   original/<name>               the file the committed one was made from, when there is one
 *   bitgraphed-file/<name>        one file carrying the whole proof inside it, when it could be built
 *   ethereum-anchors/             the floor and closing anchors with their block headers (an Ethereum floor)
 *   base-floor/                   the floor block's header (a Base floor, enclave v10): floor-header.json
 *   base-ceiling/                 the ceiling in time, and its settlement when attached
 *   base-ceiling/blobs/           the Ethereum blob bytes the settlement pointer names (<versioned hash>.bin)
 *
 * Readers (the drop box, bitgraph-audit) find files by what they are, not by
 * these names, and still read the earlier layout (`new-file/` beside a
 * top-level original).
 */

export const PKG_COMMITTED_DIR = "committed";
export const PKG_ORIGINAL_DIR = "original";
export const PKG_CARRIER_DIR = "bitgraphed-file";
/** The committed bytes' folder in packages made before 2026-10-01. */
export const PKG_LEGACY_NEW_FILE_DIR = "new-file";
export const PKG_README = "README.md";

/** A Base floor's folder (enclave v10), in place of ethereum-anchors/. */
export const PKG_BASE_FLOOR_DIR = "base-floor";
/** The floor header file inside it, as bitgraph-audit writes and reads it. */
export const PKG_BASE_FLOOR_FILE = `${PKG_BASE_FLOOR_DIR}/floor-header.json`;
/** The floor header file's format id (bitgraph-audit's FLOOR_HEADER_VERSION). */
export const FLOOR_HEADER_VERSION = "bitgraph-floor-header/1";

/** Folders a package may hold that are evidence or explanation, never a recording of their own. */
export const PKG_KNOWN_DIRS: ReadonlySet<string> = new Set([PKG_CARRIER_DIR, "base-ceiling", PKG_BASE_FLOOR_DIR]);
