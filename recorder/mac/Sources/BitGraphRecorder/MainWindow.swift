// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import UniformTypeIdentifiers

/// The window: a header the width of the window, then the dashboard, or the
/// page a recording opens to. Dialogs float over whichever is showing.
struct MainWindow: View {
    @ObservedObject var state: AppState

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                header
                /* ⚠️ TIME PASSING IS SHOWN WHERE THE EYE IS. Mike, 2026-09-09:
                 * "on a multiple file drop there isnt a clear indication of
                 * time passing like a bar or something". Calendar's linear
                 * progress: the width of the window, under the header,
                 * whichever section is up; it fills when the phase counts
                 * and slides when it cannot. */
                /* ⚠️ THE BAND THAT SWEEPS ACROSS IS THE WHOLE INDICATOR. Never a
                 * fill: "the bar that swipes across during waiting is all
                 * that's sufficient" (Mike, 2026-09-09). The numbers live in
                 * the box. */
                if state.dropping || !state.checking.isEmpty {
                    ProgressLine(fraction: nil).frame(height: 4)
                } else {
                    Rectangle().fill(G.border).frame(height: 1)
                }
                content
                    /* A drop lands anywhere on the window, whichever section
                     * is up. The box's own zone lights up; this one only takes. */
                    .onDrop(of: [.fileURL], isTargeted: nil) { providers in
                        FileDrop.urls(providers) { state.drop($0) }
                        return true
                    }
                FooterBar(state: state)
            }
            .background(G.ground)

            /* The Make pill's menu: under the pill, over the page, and a click
             * anywhere else puts it away. */
            if state.createMenu, !isPage {
                Color.clear.contentShape(Rectangle()).onTapGesture { state.createMenu = false }
                CreateMenu(entries: [
                    .init(icon: "doc.badge.plus", title: "Record a BitGraph…") { state.createMenu = false; state.chooseFilesToMake() },
                    .init(icon: "folder.badge.questionmark", title: "Check a folder…") { state.createMenu = false; state.checkOneOff() },
                ])
                .padding(.leading, 20)
                .padding(.top, 64 + 1 + 16 + 56 + 6)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
        }
        .frame(minWidth: 1040, minHeight: 680)
    }

    private var scrim: some View {
        Color.black.opacity(0.25).ignoresSafeArea()
    }

    /// Calendar's header: the name, then Today, the two chevrons and the
    /// month. The two chips are the sections.
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
            if !isPage && state.section == .calendar {
                /* The arrows, the month, then Today: the month leads and
                 * Today is the action after it ("the today button should be
                 * to the right of that stuff" — Mike, 2026-09-09). */
                HStack(spacing: 0) {
                    IconButton("chevron.left") { state.stepMonth(-1) }
                    IconButton("chevron.right") { state.stepMonth(1) }
                }
                .padding(.leading, 12)
                Text(monthTitle)
                    .font(Font.system(size: 22, weight: .regular))
                    .foregroundStyle(G.ink)
                Pill(title: "Today", style: .outlined) { state.goToday() }
                    .padding(.leading, 8)
            }
            Spacer()
            /* The section switch sits at the right, where Calendar keeps its
             * view switch: "it feels like these should be upper right" (Mike,
             * 2026-09-09). ⚠️ ONE VERB, and in the app it is RECORD: the
             * things it makes are recordings, and Mike ruled "make should be
             * replaced by record" (2026-09-09, for the app; the site keeps
             * make). The pill that starts something is "+ New", Drive's word,
             * so nothing doubles. */
            HStack(spacing: 4) {
                Chip(title: "Record", selected: state.section == .box) { state.showSection(.box) }
                Chip(title: "Calendar", selected: state.section == .calendar) { state.showSection(.calendar) }
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 64)
    }

    private var monthTitle: String {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"; return f.string(from: state.month)
    }

    @ViewBuilder
    private var content: some View {
        switch state.surface {
        case .box, .results:
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
