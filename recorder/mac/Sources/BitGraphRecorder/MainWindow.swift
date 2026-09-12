// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import UniformTypeIdentifiers

/// The window: a header the width of the window, then the calendar, or the
/// page a recording opens to. Dialogs float over whichever is showing.
///
/// ⚠️ THE WINDOW IS THE BOX. A drop lands anywhere on it, at any time, and
/// the moment a drag crosses in the whole window says so: a dashed frame
/// around everything and one line, the site's home frame arriving in the app
/// (Mike, 2026-09-11: "dropping on any page at any time ... dead ass simple
/// and almost removes the need for a dropbox at all"; then "kill the box").
struct MainWindow: View {
    @ObservedObject var state: AppState

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                header
                /* ⚠️ TIME PASSING IS SHOWN WHERE THE EYE IS. Mike, 2026-09-09:
                 * "on a multiple file drop there isnt a clear indication of
                 * time passing like a bar or something". Calendar's linear
                 * progress: the width of the window, under the header; it
                 * slides while anything is being worked on. */
                /* ⚠️ THE BAND THAT SWEEPS ACROSS IS THE WHOLE INDICATOR. Never a
                 * fill: "the bar that swipes across during waiting is all
                 * that's sufficient" (Mike, 2026-09-09). The numbers sit at
                 * the right of the header (WorkLine). */
                if state.dropping || !state.checking.isEmpty {
                    ProgressLine(fraction: nil).frame(height: 4)
                } else {
                    Rectangle().fill(G.border).frame(height: 1)
                }
                content
                FooterBar(state: state)
            }
            .background(G.ground)
            /* A drop lands anywhere on the window, at any time, header and
             * footer included. */
            .onDrop(of: [.fileURL], isTargeted: $state.dragOver) { providers in
                FileDrop.urls(providers) { state.drop($0) }
                return true
            }

            if let toast = state.toast {
                Snackbar(text: toast, action: state.toastAction ?? (Blocked.isBlock(toast) ? ("Open Settings", { AppState.openPrivacySettings() }) : nil)) { state.dismissToast() }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .padding(24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            /* ⚠️ Setup first, over everything, and nothing behind it works
             * until it is done. Then a batch, when one is waiting. */
            if !state.isSetUp || state.settingUpAgain {
                scrim
                SetupDialog(state: state)
            } else if state.status?.folderMissing == true {
                scrim
                MovedFolderDialog(state: state)
            } else if state.status?.folderBlocked == true {
                scrim
                BlockedFolderDialog(state: state)
            } else if let batch = state.pendingBatch {
                scrim.onTapGesture { state.cancelPendingDrop() }
                BatchDialog(state: state, look: batch)
            } else if let checked = state.oneOff {
                scrim.onTapGesture { state.dismissOneOff() }
                CheckDialog(state: state, path: checked.path, report: checked.report)
            }

            if state.dragOver {
                DropReveal()
            }
        }
        .frame(minWidth: 1040, minHeight: 680)
    }

    private var scrim: some View {
        Color.black.opacity(0.25).ignoresSafeArea()
    }

    /// The header: the name at the left, the month cluster over the day
    /// list, and at the right what is being worked on, when something is.
    private var header: some View {
        /* ⚠️ THE WORDMARK NEVER MOVES. Mike, 2026-09-09: "'BitGraph Recorder'
         * logo is in weird spot". Back lives on the page, not up here. */
        HStack(spacing: 12) {
            /* The brand carries the weight and the product name sits beside it,
             * the way Google Calendar's header does, and the way the site's
             * wordmark is "BitGraph" alone in black. Ink, never a colour: red is
             * the app's failure colour and blue its action colour, so a coloured
             * word up here would read as a state or a button (Mike, 2026-09-09:
             * "recorder written in a less bold font? and red? or blue?"). */
            /* "BitGraph" alone (Mike, 2026-09-11: "app icon wraps that so we
             * can just call it BitGraph"): the Dock label, the window title
             * and this wordmark all say the one name now; Recorder stays the
             * product's name on the site and in the installer. */
            Text("BitGraph").fontWeight(.bold)
                .font(Font.system(size: 22))
                .foregroundStyle(G.ink)
            Spacer()
            /* ⚠️ ONE VERB, and in the app it is RECORD: the things it makes
             * are recordings, and Mike ruled "make should be replaced by
             * record" (2026-09-09, for the app; the site keeps make). The
             * pill that starts something is "+ New", Drive's word. */
            if state.dropping || !state.checking.isEmpty {
                WorkLine(state: state)
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 64)
        /* The month cluster stands over the day list it drives, not beside
         * the wordmark (Mike, 2026-09-11: "should this move over?"). Its left
         * edge is the list column's, computed the way CalendarPane lays the
         * column out: sidebar, the pane's inset, then the centred 760. */
        .overlay(alignment: .leading) {
            if !isPage {
                GeometryReader { geo in
                    monthCluster
                        .padding(.leading, Self.listColumnLeading(in: geo.size.width))
                        .frame(width: geo.size.width, height: geo.size.height, alignment: .leading)
                }
            }
        }
    }

    /// The arrows, the month, then Today: the month leads and Today is the
    /// action after it ("the today button should be to the right of that
    /// stuff" — Mike, 2026-09-09).
    private var monthCluster: some View {
        HStack(spacing: 12) {
            HStack(spacing: 0) {
                IconButton("chevron.left") { state.stepMonth(-1) }
                IconButton("chevron.right") { state.stepMonth(1) }
            }
            Text(monthTitle)
                .font(Font.system(size: 22, weight: .regular))
                .foregroundStyle(G.ink)
            Pill(title: "Today", style: .outlined) { state.goToday() }
                .padding(.leading, 8)
        }
    }

    /// Where the day list's column begins, for a window this wide. ⚠️ Mirrors
    /// CalendarPane: 256 sidebar, 32 inset, a 760 column centred in the rest.
    static func listColumnLeading(in width: CGFloat) -> CGFloat {
        let sidebar: CGFloat = 256, inset: CGFloat = 32, column: CGFloat = 760
        let room = width - sidebar - inset * 2
        return sidebar + inset + max(0, (room - column) / 2)
    }

    private var monthTitle: String {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"; return f.string(from: state.month)
    }

    @ViewBuilder
    private var content: some View {
        switch state.surface {
        case .calendar, .results:
            Dashboard(state: state)
        case .proof:
            if let page = state.proofPage {
                ProofView(state: state, page: page)
            } else {
                VStack { Spacer(); Text("Reading this BitGraph…").font(G.body).foregroundStyle(G.secondary); Spacer() }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var isPage: Bool {
        if case .proof = state.surface { return true }
        return false
    }
}

/// What is being worked on, at the right of the header: the phase, the
/// count when the phase has one, and the seconds always, since filling a
/// slot counts nothing and still takes time. The box used to hold these
/// ("the dropbox can remain reserved for stats", Mike, 2026-09-09); with the
/// box gone they sit beside the band, where the eye already is.
struct WorkLine: View {
    @ObservedObject var state: AppState

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            HStack(spacing: 10) {
                Text(phase).font(G.label).foregroundStyle(G.ink)
                if let p = state.dropProgress, p.total > 1 {
                    Text("·").font(G.small).foregroundStyle(G.secondary)
                    Text("\(G.count(p.done)) of \(G.count(p.total))").font(G.data).foregroundStyle(G.secondary)
                }
                Text("·").font(G.small).foregroundStyle(G.secondary)
                Text(elapsed(at: context.date)).font(G.data).foregroundStyle(G.secondary)
            }
        }
    }

    private func elapsed(at now: Date) -> String {
        guard let started = state.dropStarted else { return "" }
        let s = Int(now.timeIntervalSince(started))
        return s < 60 ? "\(s) s" : "\(s / 60) min \(s % 60) s"
    }

    private var phase: String {
        switch state.dropProgress?.phase {
        case "hash": return "Reading"
        case "fuse": return "Recording"
        case "tree": return "Building the set"
        case "commit": return "Filling the slot"
        case "write": return "Writing the recording"
        case "check": return "Checking"
        case nil: return state.checking.isEmpty ? "Looking" : "Checking"
        default: return "Working"
        }
    }
}

/// The window, the moment a drag crosses into it: everything behind fades,
/// one dashed frame draws around the whole of it, one line says what to do.
/// The site's home frame, in the app. It lives only as long as the drag does,
/// and it is how anyone learns that the window is the target.
struct DropReveal: View {
    var body: some View {
        ZStack {
            Color.white.opacity(0.84)
            RoundedRectangle(cornerRadius: G.zoneRadius)
                .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
                .foregroundStyle(G.blue)
                .padding(16)
            Text("Drop it.")
                .font(G.display)
                .foregroundStyle(G.ink)
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }
}
