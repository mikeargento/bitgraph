// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import XCTest
import SwiftUI
import AppKit
@testable import BitGraphRecorder

/// The box, the list and the page: what they decide, and what they look like.
@MainActor
final class ProofSurfaceTests: XCTestCase {

    // ── the proof is carried whole, never reshaped ──────────────────────────

    func testAProofKeepsFieldsThisBuildHasNeverHeardOf() throws {
        let json = #"{"version":"bitgraph/1","somethingNew":{"deep":[1,2,3]},"commit":{"counter":"2406"}}"#
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(value["commit"]?["counter"]?.string, "2406")
        XCTAssertNotNil(value["somethingNew"], "a field this build does not know must survive to the Raw card")
        XCTAssertTrue(value.pretty.contains("somethingNew"))
    }

    func testANumberReadsBackAsACounterNotAFloat() throws {
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"blockNumber":25735831}"#.utf8))
        XCTAssertEqual(value["blockNumber"]?.string, "25735831")
        XCTAssertFalse(value.pretty.contains("25735831.0"))
    }

    // ── what the page says ──────────────────────────────────────────────────

    /// ⚠️ A block time is shown ONLY when keccak256(header) matched the hash the
    /// anchor signed. The core withholds `blockTime` otherwise, and the page
    /// must not invent one from the note.
    func testNoWindowIsShownWhenNoBlockTimeWasEstablished() {
        let page = makePage(bounds: [
            CheckedBound(side: "before", state: "anchored", note: "An anchor is present but its header was not fetched.", blockNumber: 25735831, blockTime: nil, contradiction: nil),
            CheckedBound(side: "after", state: "pending", note: "No anchor follows this position yet.", blockNumber: nil, blockTime: nil, contradiction: nil),
        ])
        let view = ProofView(state: AppState(preview: nil), page: page)
        XCTAssertNil(view.whenLinesForTesting, "a time with no verified header is not a time")
    }

    /// ⚠️ THE CLAIM IS ONE-SIDED, BECAUSE THE EVIDENCE IS.
    ///
    /// A block hash travels inward: an anchor carries one into the chain, which
    /// dates the ANCHOR from below and says nothing about anything above it.
    /// A recording before that anchor may be later than the block the anchor
    /// carries, and the page must never imply otherwise.
    func testTheLineClaimsAFloorAndNeverAWindow() {
        let page = makePage(bounds: [
            CheckedBound(side: "before", state: "anchored", note: "", blockNumber: 25735831, blockTime: "2026-09-08T14:00:00Z", contradiction: nil),
            CheckedBound(side: "after", state: "anchored", note: "", blockNumber: 25735833, blockTime: "2026-09-08T14:00:24Z", contradiction: nil),
        ])
        let window = ProofView(state: AppState(preview: nil), page: page).whenLinesForTesting?.window
        XCTAssertEqual(window?.hasPrefix("after "), true, String(describing: window))
        XCTAssertEqual(window?.contains("between"), false, "a window promises an upper edge nothing can supply")
    }

    /// The 2026-09-13 drop, in the numbers it actually failed on. The page read
    /// "between 11:34:47 and 11:34:59"; the enclave's own attestation put the
    /// commit at 11:35:11, twelve seconds past the edge the page drew. The
    /// upper block's time must appear nowhere in the claim.
    func testTheUpperBlocksTimeIsNotInTheClaim() {
        let page = makePage(bounds: [
            CheckedBound(side: "before", state: "anchored", note: "", blockNumber: 25_983_792, blockTime: "2026-09-15T15:34:47Z", contradiction: nil),
            CheckedBound(side: "after", state: "anchored", note: "", blockNumber: 25_983_793, blockTime: "2026-09-15T15:34:59Z", contradiction: nil),
        ])
        let window = try? XCTUnwrap(ProofView(state: AppState(preview: nil), page: page).whenLinesForTesting?.window)
        let clock = DateFormatter(); clock.dateStyle = .none; clock.timeStyle = .medium
        let upper = clock.string(from: ISO8601DateFormatter().date(from: "2026-09-15T15:34:59Z")!)
        let lower = clock.string(from: ISO8601DateFormatter().date(from: "2026-09-15T15:34:47Z")!)
        XCTAssertEqual(window, "after \(lower)")
        XCTAssertEqual(window?.contains(upper), false, "the upper anchor's block is not a ceiling and must not be quoted as one")
    }

    /// ⚠️ A missing upper bound carries the ledger's own reason, so a reader can
    /// tell "not fetched yet" from "none will ever exist". It does not change
    /// the claim, because the claim never rested on that side.
    func testAMissingUpperBoundCarriesItsReasonAndLeavesTheFloorAlone() {
        let page = makePage(bounds: [
            CheckedBound(side: "before", state: "anchored", note: "", blockNumber: 1, blockTime: "2026-09-08T14:00:00Z", contradiction: nil),
            CheckedBound(side: "after", state: "closed", note: "This position's epoch closed with no anchor after it.", blockNumber: nil, blockTime: nil, contradiction: nil),
        ])
        let view = ProofView(state: AppState(preview: nil), page: page)
        XCTAssertEqual(view.whenLinesForTesting?.window.hasPrefix("after "), true)
        XCTAssertTrue(view.pendingWhyForTesting.contains("epoch closed"), view.pendingWhyForTesting)
    }

    /// With no verified header on the lower side there is no floor, so there is
    /// no time on the page at all. An ellipsis stands where the floor will go.
    func testNoFloorMeansNoTimeAtAll() {
        let page = makePage(bounds: [
            CheckedBound(side: "before", state: "pending", note: "No anchor precedes this position yet.", blockNumber: nil, blockTime: nil, contradiction: nil),
            CheckedBound(side: "after", state: "anchored", note: "", blockNumber: 25_983_793, blockTime: "2026-09-15T15:34:59Z", contradiction: nil),
        ])
        let view = ProofView(state: AppState(preview: nil), page: page)
        XCTAssertNil(view.whenLinesForTesting, "an upper anchor alone establishes no time")
        XCTAssertEqual(view.verdictLineForTesting.contains("between"), false, view.verdictLineForTesting)
        XCTAssertEqual(view.verdictLineForTesting.hasSuffix("after …"), true, view.verdictLineForTesting)
    }

    func testTheCommitmentRowSaysHowItIsCarried() {
        XCTAssertEqual(ProofView(state: AppState(preview: nil), page: makePage(placement: "trailer/1")).carriedByForTesting, "in the bytes appended to the file")
        XCTAssertEqual(ProofView(state: AppState(preview: nil), page: makePage(placement: "container/2")).carriedByForTesting, "in a wrapper around the file")
        XCTAssertEqual(ProofView(state: AppState(preview: nil), page: makePage(placement: "trailer/1", member: Evidence.Member(index: 0, count: 40))).carriedByForTesting, "in each member's bytes")
    }

    /// ⚠️ The page says nothing about validity until a check has run over the
    /// bytes. Reading a proof off a folder is not verifying it.
    func testTheVerdictIsUnknownUntilTheCheckAnswers() {
        let page = ProofPage(subject: subject, described: described(), checked: nil)
        let view = ProofView(state: AppState(preview: nil), page: page)
        XCTAssertTrue(view.verdictHeadlineForTesting.contains("Checking"), view.verdictHeadlineForTesting)
    }

    // ── the pictures ────────────────────────────────────────────────────────

    func testRenderTheWindow() throws {
        let out = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("preview")
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

        /* The window: sidebar, the month's days. */
        let dash = AppState(preview: Status(
            baseUrl: "https://bitgraph.ing", supportDir: "", folder: "/Users/mike/BitGraph", suggested: "/Users/mike/BitGraph",
            library: "/Users/mike/BitGraph/Recordings", recordings: 37, recorded: 4_930,
            folders: [
                FolderStatus(path: "/Users/mike/Pictures/Photos 2026", missing: false, paused: false, watching: true, busy: true, recorded: 4_812, positions: 36, indexDamagedLines: 0),
                FolderStatus(path: "/Users/mike/Desktop/Exports", missing: false, paused: false, watching: true, busy: false, recorded: 118, positions: 4, indexDamagedLines: 0),
            ]
        ))
        let photos = "/Users/mike/Pictures/Photos 2026"
        dash.setLedgerForTesting(
            spine: LedgerSpine(days: [
                DayCount(day: "2026-09-09", count: 3), DayCount(day: "2026-09-08", count: 1), DayCount(day: "2026-09-03", count: 6),
                DayCount(day: "2026-09-01", count: 14), DayCount(day: "2026-08-31", count: 12), DayCount(day: "2026-08-28", count: 1),
            ], total: 37),
            days: ["2026-09-09": [
                Recording(path: "/l/2026-09-09/BitGraph (IMG_4021.png)", name: "BitGraph (IMG_4021.png)", day: "2026-09-09", files: 1, writtenAt: "2026-09-09T13:04:11.000Z", waitingOnAnchors: false, from: "/Users/mike/Desktop/Export"),
                Recording(path: "/l/2026-09-09/BitGraph (Photos 2026, 412 files)", name: "BitGraph (Photos 2026, 412 files)", day: "2026-09-09", files: 412, writtenAt: "2026-09-09T15:48:02.000Z", waitingOnAnchors: true, from: photos),
                Recording(path: "/l/2026-09-09/BitGraph (Exports, 118 files)", name: "BitGraph (Exports, 118 files)", day: "2026-09-09", files: 118, writtenAt: "2026-09-09T21:15:40.000Z", waitingOnAnchors: false, from: "/Users/mike/Desktop/Exports"),
            ]],
            expanded: ["2026-09-09"]
        )
        dash.month = try XCTUnwrap(AppState.date(of: "2026-09-15"))
        try shoot(MainWindow(state: dash), name: "window", size: CGSize(width: 1180, height: 780), into: out)
        /* The New page: the frame. */
        dash.showNew()
        try shoot(MainWindow(state: dash), name: "window-new", size: CGSize(width: 1180, height: 780), into: out)
        dash.showCalendar()
        /* The little month, open under its button. */
        dash.calendarOpen = true
        try shoot(MainWindow(state: dash), name: "window-calendar", size: CGSize(width: 1180, height: 780), into: out)
        dash.calendarOpen = false
        /* A drag over the window: the whole of it becomes the frame. */
        dash.dragOver = true
        try shoot(MainWindow(state: dash), name: "window-drag", size: CGSize(width: 1180, height: 780), into: out)
        dash.dragOver = false
        /* Work in hand: the band under the header, the numbers at its right. */
        dash.setDroppingForTesting(true, progress: MakeProgress(phase: "fuse", done: 212, total: 400))
        try shoot(MainWindow(state: dash), name: "window-working", size: CGSize(width: 1180, height: 780), into: out)
        dash.setDroppingForTesting(false, progress: nil)
        /* A search, answered: the month's days make way for what was found. */
        dash.setSearchForTesting(query: "photos", found: SearchResult(query: "photos", recordings: [
            Recording(path: "/l/2026-09-09/BitGraph (Photos 2026, 412 files)", name: "BitGraph (Photos 2026, 412 files)", day: "2026-09-09", files: 412, writtenAt: "2026-09-09T15:48:02.000Z", waitingOnAnchors: true, from: photos),
            Recording(path: "/l/2026-09-03/BitGraph (Photos, Preston wedding)", name: "BitGraph (Photos, Preston wedding)", day: "2026-09-03", files: 1_206, writtenAt: "2026-09-03T22:10:40.000Z", waitingOnAnchors: false, from: photos),
            Recording(path: "/l/2026-08-28/BitGraph (photos-proofs.pdf)", name: "BitGraph (photos-proofs.pdf)", day: "2026-08-28", files: 1, writtenAt: "2026-08-28T09:02:00.000Z", waitingOnAnchors: false, from: nil),
        ], truncated: false))
        try shoot(MainWindow(state: dash), name: "window-search", size: CGSize(width: 1180, height: 780), into: out)
        dash.setSearchForTesting(query: "", found: nil)
        /* A library with nothing in it yet: the one written hint. */
        let empty = AppState(preview: dash.status)
        empty.setLedgerForTesting(spine: LedgerSpine(days: [], total: 0), days: [:], expanded: [])
        try shoot(MainWindow(state: empty), name: "window-empty", size: CGSize(width: 1180, height: 780), into: out)

        let batched = AppState(preview: dash.status)
        batched.pendingBatch = LookResult(root: "/Users/mike/Pictures/Export 2026-09-09", files: [
            Looked(path: "/a/IMG_4021.CR3", name: "IMG_4021.CR3", rel: "IMG_4021.CR3", bytes: 28_400_000, originDigestB64: "AA", placement: "trailer/1", position: nil, evidencePath: nil),
            Looked(path: "/a/IMG_4022.CR3", name: "IMG_4022.CR3", rel: "IMG_4022.CR3", bytes: 27_900_000, originDigestB64: "BB", placement: "trailer/1", position: nil, evidencePath: nil),
        ], total: 2, recorded: 0, truncated: false)
        try shoot(MainWindow(state: batched), name: "window-batch", size: CGSize(width: 1180, height: 780), into: out)

        let look = LookResult(root: "/Users/mike/Pictures/Export 2026-09-09", files: [
            Looked(path: "/a/IMG_4021.CR3", name: "IMG_4021.CR3", rel: "IMG_4021.CR3", bytes: 28_400_000, originDigestB64: "AA", placement: "trailer/1", position: nil, evidencePath: nil),
            Looked(path: "/a/IMG_4022.CR3", name: "IMG_4022.CR3", rel: "IMG_4022.CR3", bytes: 27_900_000, originDigestB64: "BB", placement: "trailer/1", position: nil, evidencePath: nil),
            Looked(path: "/a/jpg/IMG_4021.JPG", name: "IMG_4021.JPG", rel: "jpg/IMG_4021.JPG", bytes: 6_100_000, originDigestB64: "CC", placement: "trailer/1", position: nil, evidencePath: nil),
            Looked(path: "/a/notes.txt", name: "notes.txt", rel: "notes.txt", bytes: 812, originDigestB64: "DD", placement: "container/2", position: Position(epochId: "e", counter: "2404"), evidencePath: "/a/BitGraphs/notes.txt.bitgraph"),
        ], total: 4, recorded: 1, truncated: false)
        try shoot(BatchDialog(state: AppState(preview: nil), look: look).padding(40).background(G.ground), name: "batch", size: CGSize(width: 660, height: 720), into: out)

        /* A folder holding a recording beside new files: the same dialog,
         * every row saying what it is. */
        let mixed = LookResult(root: "/Users/mike/Desktop/CLEAN/reality-circles", files: [
            Looked(path: "/a/circles-drop/circles.svg", name: "circles.svg", rel: "circles-drop/circles.svg", bytes: 1_714, originDigestB64: "AA", placement: "container/2", position: Position(epochId: "e", counter: "2406"), evidencePath: "/a/circles-drop/proof.json", check: LookCheck(status: "verified", category: "CARRIED_INLINE")),
            Looked(path: "/a/circles.svg", name: "circles.svg", rel: "circles.svg", bytes: 1_714, originDigestB64: "AA", placement: "container/2", position: Position(epochId: "e", counter: "2406"), evidencePath: "/a/circles-drop/proof.json", check: LookCheck(status: "verified", category: "CARRIED_INLINE")),
            Looked(path: "/a/circles.png", name: "circles.png", rel: "circles.png", bytes: 41_200, originDigestB64: "BB", placement: "trailer/1", position: nil, evidencePath: nil),
            Looked(path: "/a/circles.proof.json", name: "circles.proof.json", rel: "circles.proof.json", bytes: 7_675, originDigestB64: "CC", placement: "container/2", position: nil, evidencePath: nil),
        ], total: 4, recorded: 0, truncated: false, duplicates: 0, recordings: 1, verified: 2, failed: 0, undetermined: 0, fresh: 2)
        try shoot(BatchDialog(state: AppState(preview: nil), look: mixed).padding(40).background(G.ground), name: "batch-mixed", size: CGSize(width: 660, height: 720), into: out)

        /* A recording alone, changed underneath: a check, with Done. */
        let checkedOnly = LookResult(root: "/Users/mike/Desktop/sent/lighthouse-drop", files: [
            Looked(path: "/a/lighthouse.svg", name: "lighthouse.svg", rel: "lighthouse.svg", bytes: 4_012, originDigestB64: "DD", placement: "container/2", position: nil, evidencePath: nil, check: LookCheck(status: "unrecorded", reason: "no BitGraph for these bytes. The BitGraph in this folder is about different bytes.")),
        ], total: 1, recorded: 0, truncated: false, duplicates: 0, recordings: 1, verified: 0, failed: 0, undetermined: 0, fresh: 1)
        try shoot(BatchDialog(state: AppState(preview: nil), look: checkedOnly).padding(40).background(G.ground), name: "batch-changed", size: CGSize(width: 660, height: 720), into: out)

        try shoot(SetupDialog(state: AppState(preview: nil)).padding(40).background(G.ground), name: "setup", size: CGSize(width: 660, height: 620), into: out)

        let moved = AppState(preview: Status(baseUrl: "https://bitgraph.ing", supportDir: "", folder: "/Users/mike/BitGraph", suggested: "/Users/mike/BitGraph",
                                             library: "/Users/mike/BitGraph/Recordings", recordings: 2_566, recorded: 0, folderMissing: true, folders: []))
        try shoot(MovedFolderDialog(state: moved).padding(40).background(G.ground), name: "moved", size: CGSize(width: 660, height: 420), into: out)

        let page = makePage(member: Evidence.Member(index: 11, count: 40), bounds: [
            CheckedBound(side: "before", state: "anchored", note: "", blockNumber: 25_735_831, blockTime: "2026-09-08T14:00:00Z", contradiction: nil),
            CheckedBound(side: "after", state: "anchored", note: "", blockNumber: 25_735_833, blockTime: "2026-09-08T14:00:24Z", contradiction: nil),
        ], status: "verified")
        try shoot(ProofView(state: AppState(preview: nil), page: page), name: "proof", size: CGSize(width: 928, height: 700), into: out)

        /* The strip, on the shape that makes it worth drawing: a set that held
         * its position while an anchor committed inside the hold, so the floor
         * is NOT the anchor before the commit. */
        try shoot(
            VStack(alignment: .leading, spacing: 2) { ForEach(Self.heldSet) { NeighbourLine(row: $0, noun: "your set") } }
                .padding(12).background(Color.white).frame(width: 513).padding(40).background(G.ground),
            name: "neighbourhood", size: CGSize(width: 593, height: 350), into: out)
    }

    // ── where this recording sits ───────────────────────────────────────────

    /// The 2026-09-13 set, as the core reports it: floor 8991, an anchor at
    /// 8993/8994 inside the hold, the set's own two positions at 8992 and 8995.
    private static let heldSet: [NeighbourRow] = [
        NeighbourRow(counter: "8991", kind: "anchor", blockNumber: 25_983_787,
                     timeNote: "no header beside this anchor, so its block time was not checked here.",
                     etherscanUrl: "https://etherscan.io/block/25983787",
                     proofUrl: "https://bitgraph.ing/proof/LlgU-Q8CMaIkUWv7sgsXZUxNHUKbZAvA7g19w3UsqMI", floor: true),
        NeighbourRow(counter: "8992", kind: "mine-slot"),
        NeighbourRow(counter: "8993", kind: "anchor-slot"),
        NeighbourRow(counter: "8994", kind: "anchor", blockNumber: 25_983_788, blockTime: "2026-09-15T15:33:59.000Z",
                     etherscanUrl: "https://etherscan.io/block/25983788",
                     proofUrl: "https://bitgraph.ing/proof/VYf-mf6w3Egwa6gUJFqV0lZQjdlNWWcP7tnbD_fqvIs"),
        NeighbourRow(counter: "8995", kind: "mine-commit"),
        NeighbourRow(counter: "8996", kind: "anchor-slot"),
        NeighbourRow(counter: "8997", kind: "anchor", blockNumber: 25_983_789, blockTime: "2026-09-15T15:34:11.000Z",
                     etherscanUrl: "https://etherscan.io/block/25983789",
                     proofUrl: "https://bitgraph.ing/proof/jlwe7NCwpKyu7pGZrbk9JTuVusslqqJNLxkvtNAtoIQ"),
    ]

    /// ⚠️ THE FLOOR IS NOT THE ANCHOR BEFORE THE COMMIT, AND ONLY ONE ROW MAY
    /// WEAR THE MARK. 8994 sits between the slot and the commit and is a true
    /// statement about the commit; 8991 is the anchor the SLOT saw and is the
    /// only floor. Marking both would show them as if they disagreed.
    func testOnlyTheAnchorTheSlotSawIsMarkedAsTheFloor() {
        XCTAssertEqual(Self.heldSet.filter { $0.floor == true }.map(\.counter), ["8991"])
        XCTAssertNotEqual(Self.heldSet.first { $0.counter == "8994" }?.floor, true)
    }

    /// ⚠️ A BLOCK NUMBER WITH A BLANK BESIDE IT READS AS "THIS BLOCK HAS NO
    /// TIME". Whenever an anchor is named without a verified header, the row
    /// carries the reason instead of a gap.
    func testAnAnchorWithNoVerifiedHeaderCarriesTheReasonNotABlank() {
        for row in Self.heldSet where row.kind == "anchor" && row.blockTime == nil {
            XCTAssertNotNil(row.timeNote, "position \(row.counter) has no time and does not say why")
        }
    }

    /// The recording's own rows are the ones the eye should land on.
    func testTheRecordingsOwnPositionsAreTheOnesMarkedAsMine() {
        XCTAssertEqual(Self.heldSet.filter(\.isMine).map(\.counter), ["8992", "8995"])
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private var subject: ProofSubject {
        ProofSubject(root: "/Users/mike/Pictures/Export", evidencePath: "/x.bitgraph", filePath: "/Users/mike/Pictures/Export/IMG_4021.CR3", name: "IMG_4021.CR3", originDigestB64: nil, position: nil, justMade: false)
    }

    private func described(placement: String = "trailer/1", member: Evidence.Member? = nil) -> Described {
        let proofJSON = """
        {"version":"bitgraph/1",
         "artifact":{"digestB64":"Wm9tYmllc0FyZU5vdFJlYWxCdXRIYXNoZXNBcmU9PQ==","hashAlg":"sha256"},
         "commit":{"counter":"2406","slotCounter":"2405","epochId":"eccfc1c7Zm9vYmFyYmF6cXV1eA==","chainId":"bitgraph:main","slotHashB64":"c2xvdEhhc2hleGFtcGxl","prevB64":"cHJldmlvdXNoYXNoZXhhbXBsZQ=="},
         "signer":{"publicKeyB64":"cHVibGljS2V5Rm9yVGhlUHJldmlldw==","signatureB64":"c2lnbmF0dXJlRm9yVGhlUHJldmlld0V4YW1wbGVWYWx1ZQ=="},
         "environment":{"measurement":"eccfc1c78a5f1b2d4e6a8c0b2d4f6a8c0b2d4f6a8c0b2d4f6a8c0b2d4f6a8c0b2d4f6a8c0b2d4f6a05c72b","attestation":{"format":"aws-nitro"}},
         "slotAllocation":{"counter":"2405","nonceB64":"bm9uY2VGb3JUaGVQcmV2aWV3RXhhbXBsZQ==","signatureB64":"c2xvdFNpZ25hdHVyZUZvclRoZVByZXZpZXc=","epochId":"eccfc1c7Zm9vYmFyYmF6cXV1eA=="},
         "proofHash":"cHJvb2ZIYXNoRm9yVGhlUHJldmlldw=="}
        """
        let proof = try? JSONDecoder().decode(JSONValue.self, from: Data(proofJSON.utf8))
        let evidence = Evidence(
            file: Evidence.FileInfo(name: "IMG_4021.CR3", bytes: 28_400_000),
            placement: placement,
            originDigestB64: "b3JpZ2luRGlnZXN0Rm9yVGhlUHJldmlldw==",
            artifactDigestB64: "YXJ0aWZhY3REaWdlc3RGb3JUaGVQcmV2aWV3",
            position: Position(epochId: "eccfc1c7Zm9vYmFyYmF6cXV1eA==", counter: "2406"),
            set: member == nil ? nil : "set/1",
            member: member,
            writtenAt: "2026-09-09T02:14:08Z"
        )
        return Described(evidence: evidence, evidenceRaw: nil, proof: proof, committedB64: nil, positions: [evidence.position])
    }

    private func makePage(placement: String = "trailer/1", member: Evidence.Member? = nil, bounds: [CheckedBound] = [], status: String = "verified") -> ProofPage {
        ProofPage(
            subject: subject,
            described: described(placement: placement, member: member),
            checked: CheckedFile(rel: "IMG_4021.CR3", name: "IMG_4021.CR3", status: status, reason: nil, failedOn: nil, category: "SET_MEMBER_FROM_ORIGIN", enclave: "enclave v8 (reproducible, authenticated anchors and the floor gate)", method: "streamed", position: Position(epochId: "e", counter: "2406"), bounds: bounds)
        )
    }

    private func shoot<V: View>(_ view: V, name: String, size: CGSize, into out: URL) throws {
        let hosting = NSHostingView(rootView: view.environment(\.colorScheme, .light))
        hosting.frame = NSRect(origin: .zero, size: size)
        hosting.layoutSubtreeIfNeeded()
        let rep = try XCTUnwrap(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
        hosting.cacheDisplay(in: hosting.bounds, to: rep)
        let png = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
        try png.write(to: out.appendingPathComponent("\(name).png"))
    }
}
