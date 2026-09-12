// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import XCTest
@testable import BitGraphRecorder

/// The keys, the search, and the header's arithmetic: what the window decides
/// before it draws anything.
@MainActor
final class KeysTests: XCTestCase {
    private func status() -> Status {
        Status(baseUrl: "https://bitgraph.ing", supportDir: "~", folder: "/Users/mike/BitGraph", suggested: "/Users/mike/BitGraph", library: "/Users/mike/BitGraph/Recordings", recordings: 3, recorded: 3, folders: [])
    }

    // ── escape ──────────────────────────────────────────────────────────────

    func testEscapePutsAwayTheTopmostThingAndOnlyThat() {
        let state = AppState(preview: status())
        state.say("something to say")
        state.query = "img"
        XCTAssertTrue(state.escape())
        XCTAssertNil(state.toast, "the snackbar goes first")
        XCTAssertEqual(state.query, "img", "the search stays until the next Escape")
        XCTAssertTrue(state.escape())
        XCTAssertEqual(state.query, "")
        XCTAssertFalse(state.escape(), "nothing left to put away")
    }

    func testEscapeDoesNotCancelABatchBeingMade() {
        let state = AppState(preview: status())
        state.pendingBatch = LookResult(root: "/x", files: [], total: 0, recorded: 0, truncated: false)
        state.setDroppingForTesting(true, progress: nil)
        XCTAssertTrue(state.escape(), "the key is taken so it goes nowhere else")
        XCTAssertNotNil(state.pendingBatch, "and the batch is untouched while it is being made")
        state.setDroppingForTesting(false, progress: nil)
        XCTAssertTrue(state.escape())
        XCTAssertNil(state.pendingBatch)
    }

    // ── search ──────────────────────────────────────────────────────────────

    func testABlankQueryIsNoSearch() {
        let state = AppState(preview: status())
        state.setSearchForTesting(query: "img", found: SearchResult(query: "img", recordings: [], truncated: false))
        XCTAssertTrue(state.searching)
        state.query = "   "
        XCTAssertFalse(state.searching)
        XCTAssertNil(state.found, "an answer to a question no longer asked is dropped")
    }

    func testADialogHoldsTheCalendarKeys() {
        let state = AppState(preview: status())
        XCTAssertFalse(state.dialogUp)
        state.pendingBatch = LookResult(root: "/x", files: [], total: 0, recorded: 0, truncated: false)
        XCTAssertTrue(state.dialogUp)
    }

    /// A folder of BitGraphs dropped on the window comes back "checked", and
    /// the report goes over the calendar, never a menu.
    func testACheckedDropShowsItsReport() {
        let state = AppState(preview: status())
        let report = FolderReport(root: "/sent/Export", counts: CheckCounts(verified: 3, failed: 0, undetermined: 0, unrecorded: 0), speaking: [], positions: 1, partial: false)
        state.showCheck(path: "/sent/Export", report: report)
        XCTAssertEqual(state.oneOff?.path, "/sent/Export")
        XCTAssertTrue(state.dialogUp)
        XCTAssertTrue(state.escape())
        XCTAssertNil(state.oneOff)
    }

    // ── the header's column ─────────────────────────────────────────────────

    /// ⚠️ The month cluster stands over the day list. The list is 256 of
    /// sidebar, 32 of inset, then a 760 column centred in what is left, and
    /// the header must land on the same edge at every width.
    func testTheMonthClusterStandsOverTheDayList() {
        XCTAssertEqual(MainWindow.listColumnLeading(in: 1040), 288, "at the minimum width the column is flush with the inset")
        XCTAssertEqual(MainWindow.listColumnLeading(in: 1180), 338, "at the default width it is centred: 256 + 32 + (924 - 64 - 760) / 2")
        XCTAssertEqual(MainWindow.listColumnLeading(in: 2000), 748)
    }
}
