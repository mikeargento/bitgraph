// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import XCTest
import SwiftUI
import AppKit
@testable import BitGraphRecorder

/// What the surface decides, and what it looks like deciding it.
@MainActor
final class SurfaceTests: XCTestCase {
    private func status(_ folders: [FolderStatus]) -> Status {
        Status(baseUrl: "https://bitgraph.ing", supportDir: "~/Library/Application Support/BitGraph Recorder", folder: "/Users/mike/BitGraph", suggested: "/Users/mike/BitGraph", library: "/Users/mike/BitGraph/Recordings", recordings: 37, recorded: 4_930, folders: folders)
    }

    private func folder(_ path: String, recorded: Int = 0, positions: Int = 0, paused: Bool = false, busy: Bool = false) -> FolderStatus {
        FolderStatus(path: path, paused: paused, watching: !paused, busy: busy, recorded: recorded, positions: positions, indexDamagedLines: 0)
    }

    // ── the light ───────────────────────────────────────────────────────────

    func testTheLightIsGreenWhenThereIsNothingToSay() {
        let state = AppState(preview: status([folder("/x/Photos", recorded: 10, positions: 1)]))
        XCTAssertTrue(state.everythingIsFine)
    }

    func testTheLightIsRedWhenAFileFailedItsCheck() {
        let report = FolderReport(
            root: "/x/Photos",
            counts: CheckCounts(verified: 4, failed: 1, undetermined: 0, unrecorded: 0),
            speaking: [CheckedFile(rel: "a.jpg", status: "failed", reason: "these bytes do not rebuild the artifact this proof committed.", failedOn: "bytes")],
            positions: 1,
            partial: false
        )
        let state = AppState(preview: status([folder("/x/Photos", recorded: 5, positions: 1)]), reports: ["/x/Photos": report])
        XCTAssertFalse(state.everythingIsFine)
    }

    /// ⚠️ "We could not check" and "this was never recorded" are not failures.
    /// A red light for either one would accuse the holder of something that did
    /// not happen.
    func testTheLightStaysGreenForWhatCouldNotBeCheckedAndForWhatIsNotRecorded() {
        let report = FolderReport(
            root: "/x/Photos",
            counts: CheckCounts(verified: 4, failed: 0, undetermined: 3, unrecorded: 9),
            speaking: [],
            positions: 1,
            partial: false
        )
        let state = AppState(preview: status([folder("/x/Photos", recorded: 5, positions: 1)]), reports: ["/x/Photos": report])
        XCTAssertTrue(state.everythingIsFine)
    }

    /// ⚠️ Not being able to reach the ledger is not a fault of the folder.
    func testAGapDoesNotTurnTheLight() {
        let state = AppState(
            preview: status([folder("/x/Photos", recorded: 5, positions: 1)]),
            troubles: [.init(root: "/x/Photos", reason: "anchors could not be fetched", at: Date(), severity: .gap)]
        )
        XCTAssertTrue(state.everythingIsFine)
    }

    func testAFaultDoesTurnTheLight() {
        let state = AppState(
            preview: status([folder("/x/Photos", recorded: 5, positions: 1)]),
            troubles: [.init(root: "/x/Photos", reason: "a BitGraph was made and its recording folder could not be written", at: Date(), severity: .fault)]
        )
        XCTAssertFalse(state.everythingIsFine)
    }

    func testTheLightIsRedWhenTheCoreIsNotRunning() {
        let state = AppState(preview: status([]))
        state.applyForTesting(coreState: .stopped(reason: "the core stopped"))
        XCTAssertFalse(state.everythingIsFine)
    }

    // ── what it says ────────────────────────────────────────────────────────

    /// macOS refusing the folder is said as that, never as an empty library.
    func testABlockedFolderIsNeverNothingRecordedYet() {
        var blocked = status([])
        blocked.recordings = 0
        blocked.folderBlocked = true
        XCTAssertEqual(FooterBar.summary(blocked), "macOS is blocking access to your BitGraph folder")
        var empty = status([])
        empty.recordings = 0
        XCTAssertEqual(FooterBar.summary(empty), "Nothing recorded yet")
        XCTAssertTrue(Blocked.isBlock("macOS is blocking BitGraph Recorder from /x. Allow it."))
        XCTAssertFalse(Blocked.isBlock("anchors could not be fetched: EPERM"))
    }

    func testTheSummaryNeverClaimsEverythingIsFine() {
        let state = AppState(preview: status([folder("/x/Photos", recorded: 12, positions: 2)]))
        XCTAssertEqual(state.summary, "12 recorded in 1 folder.")
        XCTAssertFalse(state.summary.lowercased().contains("all good"))
    }

    func testTroubleOutranksActivityInTheSummary() {
        let state = AppState(
            preview: status([folder("/x/Photos")]),
            troubles: [.init(root: "/x/Photos", reason: "a BitGraph was made and its recording folder could not be written.", at: Date(), severity: .fault)],
            activity: "Photos: fuse 3/9"
        )
        XCTAssertTrue(state.summary.contains("could not be written"))
    }

    // ── the event decoder ───────────────────────────────────────────────────

    func testEventsDecodeIntoTheThingsTheAppActsOn() throws {
        let made = try decode(#"{"kind":"made","root":"/x","result":{"kind":"set","files":[{"path":"/x/a.jpg","name":"a.jpg","evidencePath":"/x/BitGraphs/a.jpg.bitgraph"}],"position":{"epochId":"e","counter":"7"}}}"#)
        guard case .made(let root, let result) = made else { return XCTFail("not a made event") }
        XCTAssertEqual(root, "/x")
        XCTAssertEqual(result.position.counter, "7")

        /* ⚠️ A made event carrying a field this build does not know must still
         * arrive: a dropped one is a BitGraph nobody is told about. */
        let richer = try decode(#"{"kind":"made","root":"/x","result":{"kind":"solo","somethingNew":true,"files":[{"path":"/x/b.jpg","name":"b.jpg","evidencePath":"/e","futureField":9}],"position":{"epochId":"e","counter":"8"}}}"#)
        guard case .made(_, let second) = richer else { return XCTFail("a made event with an unknown field was dropped") }
        XCTAssertEqual(second.files.first?.name, "b.jpg")

        let trouble = try decode(#"{"kind":"trouble","root":"/x","reason":"the ledger could not be reached","recoverable":true}"#)
        guard case .trouble(_, let reason, let recoverable, _) = trouble else { return XCTFail("not a trouble event") }
        XCTAssertEqual(reason, "the ledger could not be reached")
        XCTAssertTrue(recoverable)
    }

    /// An event this build has never heard of must not take the app down, and
    /// must not be silently read as something else.
    func testAnUnknownEventIsCarriedAsUnknown() throws {
        let e = try decode(#"{"kind":"something-new","root":"/x"}"#)
        guard case .unknown(let kind) = e else { return XCTFail("an unknown event should stay unknown") }
        XCTAssertEqual(kind, "something-new")
    }

    /// A trouble with no reason still says something a person can act on.
    func testATroubleWithNoReasonStillSaysSomething() throws {
        let e = try decode(#"{"kind":"trouble","root":"/x"}"#)
        guard case .trouble(_, let reason, _, let severity) = e else { return XCTFail("not a trouble event") }
        XCTAssertFalse(reason.isEmpty)
        XCTAssertEqual(severity, .fault, "an unlabelled trouble is read as the louder of the two, never the quieter")
    }

    private func decode(_ json: String) throws -> DaemonEvent {
        try JSONDecoder().decode(DaemonEvent.self, from: Data(json.utf8))
    }

    // ── the pictures ────────────────────────────────────────────────────────

    /// Renders every state of the one surface to PNGs under mac/preview/, so
    /// the design can be reviewed without running anything.
    func testRenderTheSurface() throws {
        let out = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("preview")
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

        let cases: [(String, AppState, Set<String>)] = [
            ("empty", AppState(preview: status([])), []),
            ("working", AppState(
                preview: status([
                    folder("/Users/mike/Pictures/Photos 2026", recorded: 4_812, positions: 37, busy: true),
                    folder("/Users/mike/Desktop/Exports", recorded: 118, positions: 4),
                ]),
                activity: "Photos 2026: fuse 212/400"
            ), []),
            ("checked", AppState(
                preview: status([folder("/Users/mike/Pictures/Photos 2026", recorded: 4_812, positions: 37)]),
                reports: ["/Users/mike/Pictures/Photos 2026": FolderReport(
                    root: "/Users/mike/Pictures/Photos 2026",
                    counts: CheckCounts(verified: 4_809, failed: 0, undetermined: 1, unrecorded: 2),
                    speaking: [
                        CheckedFile(rel: "raw/IMG_9921.CR3", status: "unrecorded", reason: "no BitGraph for these bytes. A BitGraph in this folder is about a file of this name and different bytes.", failedOn: nil),
                        CheckedFile(rel: "IMG_0042.JPG", status: "unrecorded", reason: "no BitGraph for these bytes in this folder.", failedOn: nil),
                        CheckedFile(rel: "old/IMG_0007.JPG", status: "undetermined", reason: "signed by an enclave measurement this build does not know. It is not invalid; it cannot be placed.", failedOn: nil),
                    ],
                    positions: 37,
                    partial: false
                )]
            ), ["/Users/mike/Pictures/Photos 2026"]),
            ("trouble", AppState(
                preview: status([
                    folder("/Users/mike/Pictures/Photos 2026", recorded: 4_812, positions: 37),
                    folder("/Users/mike/Desktop/Exports", paused: true),
                ]),
                troubles: [
                    .init(root: "/Users/mike/Pictures/Photos 2026", reason: "A BitGraph was made and its recording folder could not be written. The proof is kept at ~/Library/Application Support/BitGraph Recorder/rescue, and moving it into the Recordings folder is the whole repair.", at: Date(), severity: .fault),
                    .init(root: "", reason: "anchors could not be fetched: the ledger could not be reached. This is a gap on this machine's side, not a statement about the ledger: ask again.", at: Date(), severity: .gap),
                ]
            ), ["/Users/mike/Pictures/Photos 2026"]),
        ]

        for (name, state, _) in cases {
            let view = MenuView(state: state).environment(\.colorScheme, .light)
            let hosting = NSHostingView(rootView: view)
            /* ⚠️ Laid out the way the popover lays it out: width fixed, height
             * whatever the content wants. Rendering it into a tall fixed box
             * hid a collapse that showed up the moment it was in a real menu
             * bar. */
            hosting.frame = NSRect(x: 0, y: 0, width: 380, height: 1)
            hosting.layoutSubtreeIfNeeded()
            hosting.frame = NSRect(x: 0, y: 0, width: 380, height: max(hosting.fittingSize.height, 120))
            hosting.layoutSubtreeIfNeeded()
            let rep = try XCTUnwrap(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
            hosting.cacheDisplay(in: hosting.bounds, to: rep)
            let png = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
            try png.write(to: out.appendingPathComponent("\(name).png"))
        }
    }
}
