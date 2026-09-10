// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI

/// The menu bar's short form of the app: what the library holds, what a
/// one-off check said, anything the core needs to say, and the way into the
/// window.
///
/// ⚠️ ONLY FAILURES SPEAK. Nothing here congratulates anybody: "if you see
/// it, it's a BitGraph". A verified file is part of a number, never a row.
///
/// ⚠️ NO SYNCED FOLDERS. Mike, 2026-09-09: "i dont think 'syncing folders' is
/// a good idea. it could get MESSY fast." The core still knows how to watch a
/// folder (the CLI's `watch`), the app no longer offers it.
struct MenuView: View {
    @ObservedObject var state: AppState

    init(state: AppState) {
        self.state = state
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Rule()

            /* ⚠️ THE LIBRARY IS THE PRODUCT. Every recording is a folder in it. */
            if let status = state.status {
                VStack(alignment: .leading, spacing: 4) {
                    Text(libraryLine(status))
                        .font(Style.panel.weight(.semibold))
                        .foregroundStyle(Style.ink)
                    Text((status.library as NSString).abbreviatingWithTildeInPath)
                        .font(Style.small)
                        .foregroundStyle(Style.quiet)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                Rule()
            }

            if let oneOff = state.oneOff {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text((oneOff.path as NSString).lastPathComponent)
                            .font(Style.panel.weight(.semibold))
                            .foregroundStyle(Style.ink)
                        Spacer()
                        Pill(title: "Close", style: .text) { state.dismissOneOff() }
                    }
                    Text("checked once, not watched")
                        .font(Style.small)
                        .foregroundStyle(Style.quiet)
                    CheckSummary(report: oneOff.report)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                Rule()
            }

            /* Anything the core said: it could not start, it stopped, the
             * ledger could not be reached, a drop could not be made. */
            if !state.loose.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(state.loose) { trouble in
                        Text(trouble.reason)
                            .font(Style.small)
                            .foregroundStyle(trouble.severity == .fault ? Style.fine : Style.quiet)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                Rule()
            }

            footer
        }
        .frame(width: 380)
        .background(Style.ground)
    }

    /// Recordings are counted where they are; files only when the index has counted them.
    private func libraryLine(_ status: Status) -> String {
        if status.recordings == 0 { return "No recordings yet" }
        var line = "\(Style.count(status.recordings)) recording\(status.recordings == 1 ? "" : "s")"
        if status.recorded > 0 { line += " · \(Style.count(status.recorded)) file\(status.recorded == 1 ? "" : "s")" }
        return line
    }

    private var header: some View {
        (Text("BitGraph").fontWeight(.bold) + Text(" Recorder").fontWeight(.regular))
            .font(Style.title)
            .foregroundStyle(Style.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 0) {
            /* Says what is happening, and says nothing when nothing is. */
            if let activity = state.activity {
                Text(activity)
                    .font(Style.small)
                    .foregroundStyle(Style.quiet)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }
            /* ⚠️ ONE WAY IN. "this is crowded and perhaps too much going on"
             * (Mike, 2026-09-09): the window has the actions. */
            Pill(title: "Open BitGraph Recorder", style: .filled, icon: "macwindow") { state.openBox() }
            HStack {
                Toggle(isOn: Binding(get: { state.openAtLogin }, set: { state.setOpenAtLogin($0) })) {
                    Text("Open at login").font(Style.small).foregroundStyle(Style.quiet)
                }
                .toggleStyle(.checkbox)
                .padding(.top, 6)
                Spacer()
                Pill(title: "Quit", style: .text) {
                    state.stop()
                    NSApplication.shared.terminate(nil)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 10)
    }
}

struct CheckSummary: View {
    let report: FolderReport

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if report.partial {
                /* ⚠️ Nothing claims a count it did not count. */
                Text("This check stopped early, so these are numbers of what it reached, not of the folder.")
                    .font(Style.small)
                    .foregroundStyle(Style.fine)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(line)
                .font(Style.small)
                .foregroundStyle(report.counts.failed > 0 ? Style.fine : Style.quiet)
            ForEach(report.speaking.prefix(6)) { file in
                Text("\(file.rel): \(file.reason ?? file.status)")
                    .font(Style.small)
                    .foregroundStyle(file.status == "failed" ? Style.fine : Style.quiet)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if report.speaking.count > 6 {
                Text("and \(report.speaking.count - 6) more")
                    .font(Style.small)
                    .foregroundStyle(Style.quiet)
            }
        }
    }

    private var line: String {
        var parts = ["\(Style.count(report.counts.verified)) verified"]
        if report.counts.failed > 0 { parts.append("\(Style.count(report.counts.failed)) failed") }
        if report.counts.undetermined > 0 { parts.append("\(Style.count(report.counts.undetermined)) could not be checked") }
        if report.counts.unrecorded > 0 { parts.append("\(Style.count(report.counts.unrecorded)) not recorded") }
        return parts.joined(separator: " · ")
    }
}
