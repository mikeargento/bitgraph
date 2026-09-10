// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit

/// A batch drop, the way Calendar creates an event: a dialog over the
/// surface with a big title field, a few icon-led rows, and Save.
///
/// ⚠️ NAME IT. The title field is the recording's name; it is filled in with
/// where the files came from and you can type over it. Only a batch gets
/// asked, because two or more files becoming one permanent position is worth
/// a second of somebody's attention.
struct BatchDialog: View {
    @ObservedObject var state: AppState
    let look: LookResult
    @State private var name: String

    init(state: AppState, look: LookResult) {
        self.state = state
        self.look = look
        /* The folder's name alone: the recording adds ", N files" itself, and
         * a count here made "new test files, 2,563 files, 2,030 files". */
        let folder = (look.root as NSString).lastPathComponent
        _name = State(initialValue: folder == NSHomeDirectory().split(separator: "/").last.map(String.init) ? "Drop" : folder)
    }

    private var duplicates: Int { look.duplicates ?? 0 }

    /// "From Desktop", "From Desktop and Downloads", "From 4 folders under Pictures".
    private var fromLine: String {
        let home = NSHomeDirectory()
        func name(_ dir: String) -> String {
            dir == home ? "your home folder" : FileManager.default.displayName(atPath: dir)
        }
        var seen: [String] = []
        for file in look.files {
            let dir = (file.path as NSString).deletingLastPathComponent
            if !seen.contains(dir) { seen.append(dir) }
        }
        if look.truncated || seen.count > 3 {
            return "From \(G.count(seen.count))\(look.truncated ? "+" : "") folders under \(name(look.root))"
        }
        switch seen.count {
        case 0: return "From \(name(look.root))"
        case 1: return "From \(name(seen[0]))"
        case 2: return "From \(name(seen[0])) and \(name(seen[1]))"
        default: return "From \(name(seen[0])), \(name(seen[1])) and \(name(seen[2]))"
        }
    }
    private var newCount: Int { look.total - look.recorded - duplicates }

    /// "Recording · 12,204 of 26,202 · 45 s": the phase, the count when the
    /// phase has one, and the seconds always.
    private func workLine(at now: Date) -> String {
        var parts: [String] = []
        switch state.dropProgress?.phase {
        case "hash": parts.append("Reading")
        case "fuse": parts.append("Recording")
        case "tree": parts.append("Building the set")
        case "commit": parts.append("Filling the slot")
        case "write": parts.append("Writing the recording")
        default: parts.append("Working")
        }
        if let p = state.dropProgress, p.total > 1 { parts.append("\(G.count(p.done)) of \(G.count(p.total))") }
        if let started = state.dropStarted {
            let s = Int(now.timeIntervalSince(started))
            parts.append(s < 60 ? "\(s) s" : "\(s / 60) min \(s % 60) s")
        }
        return parts.joined(separator: " · ")
    }

    /// One sentence for what the drop is: how many are new, how many are
    /// on record already, how many are the same bytes as another and count once.
    private var summary: String {
        if newCount == 0 && duplicates == 0 { return "All of them already have a BitGraph. Nothing to record." }
        var parts: [String] = []
        parts.append(look.recorded == 0 && duplicates == 0
                     ? "They become one BitGraph at one position, each file a member of it."
                     : "\(G.count(newCount)) become one BitGraph at one position.")
        if look.recorded > 0 { parts.append("\(G.count(look.recorded)) already have one and are left alone.") }
        if duplicates > 0 { parts.append(duplicates == 1 ? "1 is the same bytes as another and counts once." : "\(G.count(duplicates)) are the same bytes as another and count once.") }
        return parts.joined(separator: " ")
    }

    var body: some View {
        DialogCard(close: { state.cancelPendingDrop() }) {
            HStack {
                Image(systemName: "line.3.horizontal").foregroundStyle(G.secondary)
                Spacer()
            }
            .padding(.bottom, 18)

            TitleField(placeholder: "Name this recording", text: $name)
                .padding(.trailing, 40)
                .padding(.bottom, 22)

            DialogRow(icon: "doc.on.doc") {
                Text("\(G.count(look.total)) file\(look.total == 1 ? "" : "s")").font(G.body).foregroundStyle(G.ink)
                Text(summary)
                    .font(G.small).foregroundStyle(G.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            /* Where the files came from, in words. The common root of a drop
             * from several places is somebody's home folder, and "~" meant
             * nothing to Mike (2026-09-09: "what does this mean during a
             * multi-drop"). */
            DialogRow(icon: "folder") {
                Text(fromLine).font(G.body).foregroundStyle(G.ink).lineLimit(2).truncationMode(.middle)
                Text("Your files stay where they are. The recording is its own folder in BitGraph, and the files go in as hard links.")
                    .font(G.small).foregroundStyle(G.secondary).fixedSize(horizontal: false, vertical: true)
            }

            DialogRow(icon: "list.bullet") {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(look.files) { file in
                            HStack {
                                Text(file.rel).font(G.small).foregroundStyle(G.ink).lineLimit(1).truncationMode(.middle)
                                Spacer()
                                if file.isRecorded { Text("on record").font(G.small).foregroundStyle(G.secondary) }
                            }
                        }
                        if look.truncated {
                            Text("and \(G.count(look.total - look.files.count)) more").font(G.small).foregroundStyle(G.secondary).padding(.top, 4)
                        }
                    }
                }
                .frame(maxHeight: 170)
            }

            HStack(spacing: 12) {
                /* The numbers, while it makes: the dialog is where the eye is
                 * ("can there be a number progress here?" — Mike, 2026-09-09,
                 * over a 26,202-file make). */
                if state.dropping {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(workLine(at: context.date))
                            .font(G.small).monospacedDigit().foregroundStyle(G.secondary)
                    }
                }
                Spacer()
                Pill(title: "Cancel", style: .text, enabled: !state.dropping) { state.cancelPendingDrop() }
                Pill(title: state.dropping ? "Recording…" : "Record BitGraph", style: .filled, enabled: newCount > 0 && !state.dropping) {
                    state.commitPendingDrop(name: name.trimmingCharacters(in: .whitespaces))
                }
            }
            .padding(.top, 14)
        }
        .frame(width: 560)
    }
}

/// First run, once: name the folder, say where it goes.
struct SetupDialog: View {
    @ObservedObject var state: AppState
    @State private var name = "BitGraph"
    @State private var location = ""
    @State private var working = false
    @State private var problem: String?

    var body: some View {
        DialogCard {
            Text("Set up BitGraph Recorder").font(G.display).foregroundStyle(G.ink).padding(.bottom, 6)
            /* Not a commitment: Change folder… and the moved-folder flow both
             * exist, and a first screen that sounds final makes people
             * hesitate (Mike, 2026-09-10: "should it say that? or confirm?"). */
            Text("Everything you record goes in one folder. Name it, and say where it lives. You can change this later.")
                .font(G.body).foregroundStyle(G.secondary).fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 22)

            DialogRow(icon: "textformat") {
                TextField("BitGraph", text: $name)
                    .textFieldStyle(.plain)
                    .font(Font.system(size: 16))
                    .foregroundStyle(G.ink)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: G.fieldRadius).fill(.white))
                    .overlay(RoundedRectangle(cornerRadius: G.fieldRadius).strokeBorder(G.border, lineWidth: 1))
                    .frame(maxWidth: 300)
                Text("What the folder is called").font(G.small).foregroundStyle(G.secondary)
            }

            DialogRow(icon: "folder") {
                Text(placeName).font(G.body).foregroundStyle(G.ink)
                if !location.isEmpty {
                    Text((location as NSString).abbreviatingWithTildeInPath).font(G.small).foregroundStyle(G.secondary).lineLimit(1).truncationMode(.head)
                }
                Pill(title: location.isEmpty ? "Choose a place" : "Choose a different place", style: .outlined) { choose() }
                    .padding(.top, 6)
            }

            DialogRow(icon: "eye") {
                Text("It will look like this").font(G.small).foregroundStyle(G.secondary)
                Text(preview).font(G.data).foregroundStyle(G.ink).fixedSize(horizontal: false, vertical: true)
            }

            if let problem {
                Text(problem).font(G.small).foregroundStyle(G.red).padding(.top, 6).fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Spacer()
                /* Setting up AGAIN can be walked away from; the first time cannot. */
                if state.isSetUp {
                    Pill(title: "Cancel", style: .text) { state.settingUpAgain = false }
                }
                Pill(title: working ? "Setting up…" : "Set up", style: .filled, enabled: ready && !working) { run() }
            }
            .padding(.top, 16)
        }
        .frame(width: 560)
        .task { if location.isEmpty { location = state.suggestedLocation } }
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespaces) }
    private var ready: Bool { !trimmed.isEmpty && !location.isEmpty }
    private var placeName: String {
        if location.isEmpty { return "Choose a place" }
        if location == NSHomeDirectory() { return "Home folder" }
        return FileManager.default.displayName(atPath: location)
    }
    private var preview: String {
        let place = location.isEmpty ? "…" : (location as NSString).abbreviatingWithTildeInPath
        return "\(place)/\(trimmed.isEmpty ? "BitGraph" : trimmed)/Recordings/\(AppState.today())/BitGraph (IMG_4021.png)/"
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        panel.message = "Your \(trimmed.isEmpty ? "BitGraph" : trimmed) folder will be created here. An existing one is continued, never replaced."
        if !location.isEmpty { panel.directoryURL = URL(fileURLWithPath: location) }
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        location = url.path
        problem = nil
    }

    private func run() {
        working = true
        problem = nil
        Task {
            defer { working = false }
            do { try await state.setUp(at: location, name: trimmed) } catch { problem = error.localizedDescription }
        }
    }
}

/// The BitGraph folder is not where it was. Mike, 2026-09-09: "if you should
/// move it, you may have to point the system at it again so that
/// functionality should be baked in."
struct MovedFolderDialog: View {
    @ObservedObject var state: AppState

    var body: some View {
        DialogCard {
            Text("Your BitGraph folder is not where it was").font(G.display).foregroundStyle(G.ink)
                .fixedSize(horizontal: false, vertical: true).padding(.bottom, 6)
            Text("It was at \(((state.status?.folder ?? "") as NSString).abbreviatingWithTildeInPath). If you moved or renamed it, point at where it is now and everything in it carries on. Or start a new one. Nothing is touched either way.")
                .font(G.body).foregroundStyle(G.secondary).fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 22)
            HStack {
                Spacer()
                Pill(title: "Start a new one", style: .text) { state.settingUpAgain = true }
                Pill(title: "Find it…", style: .filled, icon: "folder") { state.findFolder() }
            }
        }
        .frame(width: 560)
    }
}

/// macOS is refusing the app its own folder. Mike, 2026-09-09: the app was
/// renamed, the new bundle id had no Desktop grant, and the window showed a raw
/// "EPERM: operation not permitted" over "Nothing recorded yet" with six
/// recordings on disk. The grant is the person's to give, in one place, so the
/// dialog names the place and opens it. Nothing else works until it is given,
/// which is why this sits over everything like the moved-folder dialog.
struct BlockedFolderDialog: View {
    @ObservedObject var state: AppState

    var body: some View {
        DialogCard {
            Text("macOS is blocking your BitGraph folder").font(G.display).foregroundStyle(G.ink)
                .fixedSize(horizontal: false, vertical: true).padding(.bottom, 6)
            Text("BitGraph Recorder is not allowed to read \(((state.status?.folder ?? "") as NSString).abbreviatingWithTildeInPath). Allow it under Privacy & Security › Files and Folders (or Full Disk Access), then come back. Your recordings are untouched.")
                .font(G.body).foregroundStyle(G.secondary).fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 22)
            HStack {
                Spacer()
                Pill(title: "Try again", style: .text) { Task { await state.refresh() } }
                Pill(title: "Open System Settings…", style: .filled, icon: "lock.shield") { AppState.openPrivacySettings() }
            }
        }
        .frame(width: 560)
    }
}

/// What a one-off check said, over the dashboard. Mike, 2026-09-09: "what
/// does 'check a folder' do?" — it did its work and said so only in the menu
/// bar. Now the answer lands where the question was asked.
///
/// ⚠️ ONLY WHAT HAS SOMETHING TO SAY IS LISTED. Verified files are a number;
/// a failed, unrecorded or undetermined one is a row, with its reason.
struct CheckDialog: View {
    @ObservedObject var state: AppState
    let path: String
    let report: FolderReport

    var body: some View {
        DialogCard(close: { state.dismissOneOff() }) {
            Text("Checked \(FileManager.default.displayName(atPath: path))")
                .font(G.display).foregroundStyle(G.ink)
                .lineLimit(1).truncationMode(.middle)
                .padding(.trailing, 40)
                .padding(.bottom, 4)
            Text((path as NSString).abbreviatingWithTildeInPath)
                .font(G.small).foregroundStyle(G.secondary)
                .lineLimit(1).truncationMode(.head)
                .padding(.bottom, 22)

            DialogRow(icon: report.counts.failed > 0 ? "exclamationmark.triangle" : "checkmark.circle") {
                Text(countsLine).font(G.body).foregroundStyle(report.counts.failed > 0 ? G.red : G.ink)
                if report.partial {
                    Text("This check stopped early, so these are numbers of what it reached, not of the folder.")
                        .font(G.small).foregroundStyle(G.red).fixedSize(horizontal: false, vertical: true)
                }
                Text("Nothing was recorded or changed, and nothing left this machine.")
                    .font(G.small).foregroundStyle(G.secondary).fixedSize(horizontal: false, vertical: true)
            }

            if !report.speaking.isEmpty {
                DialogRow(icon: "list.bullet") {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 6) {
                            ForEach(report.speaking) { file in
                                HStack(alignment: .firstTextBaseline, spacing: 10) {
                                    Text(file.rel).font(G.small).foregroundStyle(G.ink).lineLimit(1).truncationMode(.middle)
                                    Spacer()
                                    Text(file.reason ?? word(file.status))
                                        .font(G.small)
                                        .foregroundStyle(file.status == "failed" ? G.red : G.secondary)
                                        .lineLimit(2).multilineTextAlignment(.trailing)
                                        .frame(maxWidth: 300, alignment: .trailing)
                                }
                            }
                        }
                    }
                    .frame(maxHeight: 260)
                }
            }

            HStack {
                Spacer()
                Pill(title: "Show in Finder", style: .text, icon: "folder") { state.reveal(path) }
                Pill(title: "Done", style: .filled) { state.dismissOneOff() }
            }
            .padding(.top, 16)
        }
        .frame(width: 620)
    }

    private var countsLine: String {
        let c = report.counts
        var parts = ["\(G.count(c.verified)) verified"]
        if c.failed > 0 { parts.append("\(G.count(c.failed)) failed") }
        if c.undetermined > 0 { parts.append("\(G.count(c.undetermined)) could not be checked") }
        if c.unrecorded > 0 { parts.append("\(G.count(c.unrecorded)) not recorded") }
        return parts.joined(separator: " · ")
    }

    private func word(_ status: String) -> String {
        switch status {
        case "failed": return "failed"
        case "unrecorded": return "not recorded"
        case "verified": return "verified"
        default: return "could not be checked"
        }
    }
}
