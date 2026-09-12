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

            /* The little month, under its button; a click anywhere else
             * puts it away. */
            if state.calendarOpen {
                Color.clear.contentShape(Rectangle()).onTapGesture { state.calendarOpen = false }
                calendarCard
                    .padding(.top, 64 + 1 + 6)
                    .padding(.trailing, 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
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

    /// The header: the name at the left; at the right the work in hand when
    /// there is any, then search, the Calendar button and the New pill.
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
            /* Beside the name, where Google keeps Create, and it opens the
             * frame every time rather than a picker (Mike, 2026-09-11: "+new
             * sits next to bitgraph and always opens the dropbox page"). */
            CreatePill(title: "New", height: 44, width: Self.newPillWidth) { state.showNew() }
                .padding(.leading, 12)
            Spacer()
            /* What is being worked on, when something is; then the ways to
             * a proof that are not a drop: search by name, the little month
             * to jump by day, and the picker. On every page, a proof's too
             * (Mike, 2026-09-11: "that menu should be on proof pages too");
             * using one from a page brings the list back. ⚠️ ONE VERB, and
             * in the app it is RECORD (Mike, 2026-09-09; the site keeps
             * make). The pill that starts something is "+ New". */
            if state.dropping || !state.checking.isEmpty {
                WorkLine(state: state)
            }
            SearchField(placeholder: "Search recordings", text: $state.query, focus: $state.focusSearch)
                .frame(width: 240)
            Pill(title: "Calendar", style: state.calendarOpen ? .tonal : .outlined, icon: "calendar") { state.calendarOpen.toggle() }
        }
        .padding(.horizontal, 20)
        .frame(height: 64)
    }

    static let newPillWidth: CGFloat = 180

    /// The little month, dropped under the header's Calendar button: a jump.
    /// Pick a day and the list goes there; Today is the top of it.
    private var calendarCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            MiniMonth(
                month: $state.month,
                selected: Binding(get: { state.selectedDay }, set: { state.selectDay($0) }),
                marked: state.markedDays
            )
            HStack {
                Spacer()
                Pill(title: "Today", style: .outlined) { state.goToday() }
            }
        }
        .padding(14)
        /* As wide as the month and no wider: its header's spacer would
         * otherwise take the whole window. */
        .fixedSize()
        .background(
            RoundedRectangle(cornerRadius: 8).fill(Color.white)
                .shadow(color: .black.opacity(0.30), radius: 1.5, y: 1)
                .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
        )
    }

    @ViewBuilder
    private var content: some View {
        switch state.surface {
        case .calendar, .results:
            Dashboard(state: state)
        case .new:
            NewPage(state: state)
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
            /* Deep blue, most of the way to opaque: the window goes dark and
             * blue under a drag (Mike, 2026-09-11: "maybe the whole screen
             * turns blueish? like darker?"), and what is behind it stays
             * faintly there so it reads as the same window. */
            G.blueDeep.opacity(0.86)
            RoundedRectangle(cornerRadius: G.zoneRadius)
                .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
                .foregroundStyle(Color.white.opacity(0.9))
                .padding(16)
            /* The one word, the verb (Mike, 2026-09-11: "on hover it just
             * says BitGraph in the middle"). The results say the outcome. */
            Text("BitGraph")
                .font(Font.system(size: 44, weight: .bold))
                .foregroundStyle(.white)
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }
}

/// The page "+ New" opens: one dashed frame the size of the page, the way
/// the site's home is one frame and nothing else, with the one line in it
/// for people who would rather pick than drag. A drop lands on it like
/// anywhere else; the frame is where you go when you came in by the pill.
struct NewPage: View {
    @ObservedObject var state: AppState

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: G.zoneRadius).fill(G.zone)
            RoundedRectangle(cornerRadius: G.zoneRadius)
                .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                .foregroundStyle(G.dash)
            /* ⚠️ A FILE, NOT A PHOTOGRAPH. BitGraph is for any bits, and the
             * icon says so. */
            HStack(spacing: 14) {
                Image(systemName: "doc.on.doc").font(.system(size: 32, weight: .light)).foregroundStyle(G.blue)
                HStack(spacing: 0) {
                    Text("Drag files or a folder here, or ").font(G.body).foregroundStyle(G.ink)
                    Button { state.chooseFilesToMake() } label: {
                        Text("browse files").font(G.body).foregroundStyle(G.blue).underline()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(G.ground)
    }
}
