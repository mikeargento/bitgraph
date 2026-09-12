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

    /// The header's ways to a proof are on a proof page too, and using one
    /// brings the list back to hold the answer.
    func testSearchingOrJumpingFromAProofPageBringsTheListBack() {
        let state = AppState(preview: status())
        let subject = ProofSubject(root: "/x", evidencePath: "/x/proof.json", filePath: "/x/a.jpg", name: "a.jpg", originDigestB64: nil, position: nil, justMade: false)
        state.surface = .proof(subject)
        state.query = "img"
        XCTAssertEqual(state.surface, .calendar, "typing a search leaves the page")
        state.surface = .proof(subject)
        state.goToday()
        XCTAssertEqual(state.surface, .calendar, "Today leaves the page")
        state.surface = .proof(subject)
        state.selectDay("2026-09-09")
        XCTAssertEqual(state.surface, .calendar, "a day picked in the little month leaves the page")
    }

    /// "+ New" opens the frame every time; Escape or Back is the calendar.
    func testNewOpensTheFrameAndEscapeLeavesIt() {
        let state = AppState(preview: status())
        state.showNew()
        XCTAssertEqual(state.surface, .new)
        XCTAssertTrue(state.escape())
        XCTAssertEqual(state.surface, .calendar)
    }

    // ── the list, by month ──────────────────────────────────────────────────

    /// The spine grouped under month names, newest first, and ← → jumping
    /// between the months that hold anything.
    func testTheListIsEveryMonthNewestFirstAndArrowsJumpBetweenThem() throws {
        let state = AppState(preview: status())
        state.setLedgerForTesting(spine: LedgerSpine(days: [
            DayCount(day: "2026-09-09", count: 3), DayCount(day: "2026-09-01", count: 1),
            DayCount(day: "2026-07-20", count: 2),
        ], total: 6), days: [:], expanded: [])
        XCTAssertEqual(state.months.map(\.title), ["September 2026", "July 2026"])
        XCTAssertEqual(state.months.map { $0.days.count }, [2, 1])

        state.month = try XCTUnwrap(AppState.date(of: "2026-09-15"))
        state.jumpMonth(-1)
        XCTAssertEqual(state.scrollTarget, "2026-07-20", "back a month lands on the newest day of the month before that holds anything")
        state.jumpMonth(-1)
        XCTAssertEqual(state.scrollTarget, "2026-07-20", "and stops at the oldest")
        state.jumpMonth(1)
        XCTAssertEqual(state.scrollTarget, "2026-09-09")
        state.goToday()
        XCTAssertEqual(state.scrollTarget, "2026-09-09", "today is the top of the list")
        XCTAssertFalse(state.calendarOpen)
    }
}
