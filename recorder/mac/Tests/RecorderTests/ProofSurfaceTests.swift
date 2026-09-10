// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

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

    func testTheWindowReadsAsOneDayWhenBothAnchorsLandedOnIt() {
        let page = makePage(bounds: [
            CheckedBound(side: "before", state: "anchored", note: "", blockNumber: 25735831, blockTime: "2026-09-08T14:00:00Z", contradiction: nil),
            CheckedBound(side: "after", state: "anchored", note: "", blockNumber: 25735833, blockTime: "2026-09-08T14:00:24Z", contradiction: nil),
        ])
        let view = ProofView(state: AppState(preview: nil), page: page)
        let when = view.whenLinesForTesting
        XCTAssertTrue(when?.window.hasPrefix("between") == true, String(describing: when))
    }

    /// ⚠️ A missing upper bound carries the ledger's own reason, so a reader can
    /// tell "not fetched yet" from "none will ever exist".
    func testAMissingUpperBoundCarriesItsReason() {
        let page = makePage(bounds: [
            CheckedBound(side: "before", state: "anchored", note: "", blockNumber: 1, blockTime: "2026-09-08T14:00:00Z", contradiction: nil),
            CheckedBound(side: "after", state: "closed", note: "This position's epoch closed with no anchor after it.", blockNumber: nil, blockTime: nil, contradiction: nil),
        ])
        let view = ProofView(state: AppState(preview: nil), page: page)
        let when = view.whenLinesForTesting
        /* The line goes quiet: an ellipsis where the side is missing. The
         * reason is still on the page, under Details, for whoever digs. */
        XCTAssertTrue(when?.window.hasSuffix("…") == true, String(describing: when))
        XCTAssertTrue(view.pendingWhyForTesting.contains("epoch closed"), view.pendingWhyForTesting)
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

        /* The dashboard: sidebar, the box, the ledger. */
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
        dash.section = .calendar
        try shoot(MainWindow(state: dash), name: "window-calendar", size: CGSize(width: 1180, height: 780), into: out)
        dash.createMenu = true
        try shoot(MainWindow(state: dash), name: "window-menu", size: CGSize(width: 1180, height: 780), into: out)
        dash.createMenu = false
        dash.section = .box

        let batched = AppState(preview: dash.status)
        batched.pendingBatch = LookResult(root: "/Users/mike/Pictures/Export 2026-09-09", files: [
            Looked(path: "/a/IMG_4021.CR3", name: "IMG_4021.CR3", rel: "IMG_4021.CR3", bytes: 28_400_000, originDigestB64: "AA", placement: "trailer/1", position: nil, evidencePath: nil),
            Looked(path: "/a/IMG_4022.CR3", name: "IMG_4022.CR3", rel: "IMG_4022.CR3", bytes: 27_900_000, originDigestB64: "BB", placement: "trailer/1", position: nil, evidencePath: nil),
        ], total: 2, recorded: 0, truncated: false)
        try shoot(MainWindow(state: batched), name: "window-batch", size: CGSize(width: 1180, height: 780), into: out)

        let busy = AppState(preview: nil)
        busy.setDroppingForTesting(true, progress: MakeProgress(phase: "fuse", done: 212, total: 400))
        try shoot(DropCard(state: busy).padding(30), name: "box-making", size: CGSize(width: 780, height: 460), into: out)

        let look = LookResult(root: "/Users/mike/Pictures/Export 2026-09-09", files: [
            Looked(path: "/a/IMG_4021.CR3", name: "IMG_4021.CR3", rel: "IMG_4021.CR3", bytes: 28_400_000, originDigestB64: "AA", placement: "trailer/1", position: nil, evidencePath: nil),
            Looked(path: "/a/IMG_4022.CR3", name: "IMG_4022.CR3", rel: "IMG_4022.CR3", bytes: 27_900_000, originDigestB64: "BB", placement: "trailer/1", position: nil, evidencePath: nil),
            Looked(path: "/a/jpg/IMG_4021.JPG", name: "IMG_4021.JPG", rel: "jpg/IMG_4021.JPG", bytes: 6_100_000, originDigestB64: "CC", placement: "trailer/1", position: nil, evidencePath: nil),
            Looked(path: "/a/notes.txt", name: "notes.txt", rel: "notes.txt", bytes: 812, originDigestB64: "DD", placement: "container/2", position: Position(epochId: "e", counter: "2404"), evidencePath: "/a/BitGraphs/notes.txt.bitgraph"),
        ], total: 4, recorded: 1, truncated: false)
        try shoot(BatchDialog(state: AppState(preview: nil), look: look).padding(40).background(G.ground), name: "batch", size: CGSize(width: 660, height: 720), into: out)

        try shoot(SetupDialog(state: AppState(preview: nil)).padding(40).background(G.ground), name: "setup", size: CGSize(width: 660, height: 620), into: out)

        let moved = AppState(preview: Status(baseUrl: "https://bitgraph.ing", supportDir: "", folder: "/Users/mike/BitGraph", suggested: "/Users/mike/BitGraph",
                                             library: "/Users/mike/BitGraph/Recordings", recordings: 2_566, recorded: 0, folderMissing: true, folders: []))
        try shoot(MovedFolderDialog(state: moved).padding(40).background(G.ground), name: "moved", size: CGSize(width: 660, height: 420), into: out)

        let page = makePage(member: Evidence.Member(index: 11, count: 40), bounds: [
            CheckedBound(side: "before", state: "anchored", note: "", blockNumber: 25_735_831, blockTime: "2026-09-08T14:00:00Z", contradiction: nil),
            CheckedBound(side: "after", state: "anchored", note: "", blockNumber: 25_735_833, blockTime: "2026-09-08T14:00:24Z", contradiction: nil),
        ], status: "verified")
        try shoot(ProofView(state: AppState(preview: nil), page: page), name: "proof", size: CGSize(width: 760, height: 700), into: out)
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
