// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import SwiftUI
import AppKit

/// A drop that waits, the way Calendar creates an event: a dialog over the
/// surface with a big title field, a few icon-led rows, and Save.
///
/// ⚠️ NAME IT. The title field is the recording's name; it is filled in with
/// where the files came from and you can type over it. Only a batch gets
/// asked, because two or more files becoming one permanent position is worth
/// a second of somebody's attention.
///
/// ⚠️ ONE LIST FOR EVERY DROP. A folder holding a BitGraph used to come back
/// as a report of its own, with no way to record what in it was new (Mike,
/// 2026-09-13). It lands here now: the recording's answer on the rows it
/// covers, "new" on the rest, and Record for the new ones alone. Nothing to
/// record makes it a check, titled by what was checked, with Done.
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
    /// How many recording folders the drop held, and what they said about
    /// the files they cover. Zero and zeros for a plain drop of files.
    private var recordings: Int { look.recordings ?? 0 }
    private var verified: Int { look.verified ?? 0 }
    private var failed: Int { look.failed ?? 0 }
    private var undetermined: Int { look.undetermined ?? 0 }
    private var answered: Int { verified + failed + undetermined }
    /// What Record would record. A core that does not say is worked out the old way.
    private var newCount: Int { look.fresh ?? (look.total - look.recorded - duplicates) }
    /// More than one kind of row, or a recording in the drop, so every row
    /// says which it is. A plain drop of new files says nothing on its rows:
    /// the list IS the answer there.
    private var mixed: Bool { answered > 0 || look.recorded > 0 || recordings > 0 }
    private var folderName: String { FileManager.default.displayName(atPath: look.root) }

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

    /// "Recording · 12,204 of 26,202 · 45 s": the phase, the count when the
    /// phase has one, and the seconds always.
    private func workLine(at now: Date) -> String {
        var parts: [String] = []
        switch state.dropProgress?.phase {
        case "hash": parts.append("Reading")
        case "check": parts.append("Checking")
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

    /// One sentence for what the drop is: what its recordings said, how many
    /// are on record already, how many are the same bytes as another and
    /// count once, and how many are new.
    ///
    /// ⚠️ A DROP THAT HOLDS A BITGRAPH IS A CHECK AS WELL AS A LOOK. What the
    /// recording said is said here, on the rows, and nothing in it was
    /// recorded on landing: a stray new file beside somebody's BitGraph waits
    /// like a batch does.
    private var summary: String {
        var parts: [String] = []
        if recordings > 0 {
            parts.append(recordings == 1 ? "This folder holds a BitGraph." : "This folder holds \(G.count(recordings)) BitGraphs.")
            if verified > 0 { parts.append("\(G.count(verified)) verified against \(recordings == 1 ? "it" : "them").") }
            if failed > 0 { parts.append("\(G.count(failed)) failed the check.") }
            if undetermined > 0 { parts.append("\(G.count(undetermined)) could not be checked.") }
        }
        if look.recorded > 0 { parts.append("\(G.count(look.recorded)) already have one and are left alone.") }
        if duplicates > 0 { parts.append(duplicates == 1 ? "1 is the same bytes as another and counts once." : "\(G.count(duplicates)) are the same bytes as another and count once.") }
        if newCount == 0 {
            parts.append(parts.isEmpty ? "All of them already have a BitGraph. Nothing to record." : "Nothing new to record.")
        } else if !mixed && duplicates == 0 {
            parts.append("They become one BitGraph at one position, each file a member of it.")
        } else if newCount == 1 {
            parts.append("1 is new and becomes a BitGraph at its own position.")
        } else {
            parts.append("\(G.count(newCount)) are new and become one BitGraph at one position.")
        }
        return parts.joined(separator: " ")
    }

    /// What a row says beside its name, when it has something to say. A
    /// verified file says so with its position; a failure says why, in red;
    /// a file the library holds is on record; and in a mixed list a new file
    /// says it is new, with what its recording is about when it sits in one.
    private func note(for file: Looked) -> (text: String, color: Color)? {
        if let check = file.check {
            switch check.status {
            case "verified":
                return ("verified · #\(file.position?.counter ?? "?")", G.secondary)
            case "failed":
                return (check.reason ?? "failed the check", G.red)
            case "unrecorded":
                let about = (check.reason ?? "").contains("different bytes") ? " · its BitGraph is about different bytes" : ""
                return ("new\(about)", G.secondary)
            default:
                return (check.reason ?? "could not be checked", G.secondary)
            }
        }
        if file.isRecorded { return ("on record", G.secondary) }
        if file.duplicateOf != nil { return nil }
        return mixed ? ("new", G.secondary) : nil
    }

    var body: some View {
        DialogCard(close: { state.cancelPendingDrop() }) {
            HStack {
                Image(systemName: "line.3.horizontal").foregroundStyle(G.secondary)
                Spacer()
            }
            .padding(.bottom, 18)

            /* Something to record is named. Nothing to record is a check, and
             * a check is titled by what was checked. */
            if newCount > 0 {
                TitleField(placeholder: "Name this recording", text: $name)
                    .padding(.trailing, 40)
                    .padding(.bottom, 22)
            } else {
                Text("Checked \(folderName)")
                    .font(G.display).foregroundStyle(G.ink)
                    .lineLimit(1).truncationMode(.middle)
                    .padding(.trailing, 40)
                    .padding(.bottom, 22)
            }

            DialogRow(icon: failed > 0 ? "exclamationmark.triangle" : "doc.on.doc") {
                Text("\(G.count(look.total)) file\(look.total == 1 ? "" : "s")").font(G.body).foregroundStyle(failed > 0 ? G.red : G.ink)
                Text(summary)
                    .font(G.small).foregroundStyle(G.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if recordings > 0 {
                    Text("Checking is not recording: nothing was changed, and nothing left this machine.")
                        .font(G.small).foregroundStyle(G.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            /* Where the files came from, in words. The common root of a drop
             * from several places is somebody's home folder, and "~" meant
             * nothing to Mike (2026-09-09: "what does this mean during a
             * multi-drop"). */
            DialogRow(icon: "folder") {
                Text(fromLine).font(G.body).foregroundStyle(G.ink).lineLimit(2).truncationMode(.middle)
                if newCount > 0 {
                    Text("Your files stay where they are. The recording is its own folder in BitGraph, and the files go in as hard links.")
                        .font(G.small).foregroundStyle(G.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }

            DialogRow(icon: "list.bullet") {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(look.files) { file in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text(file.rel).font(G.small).foregroundStyle(G.ink).lineLimit(1).truncationMode(.middle)
                                Spacer()
                                if let note = note(for: file) {
                                    Text(note.text).font(G.small).foregroundStyle(note.color)
                                        .lineLimit(1).truncationMode(.tail)
                                        .frame(maxWidth: 300, alignment: .trailing)
                                }
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
                if newCount > 0 {
                    Pill(title: "Cancel", style: .text, enabled: !state.dropping) { state.cancelPendingDrop() }
                    Pill(title: state.dropping ? "Recording…" : (mixed ? "Record \(G.count(newCount)) new" : "Record BitGraph"), style: .filled, enabled: !state.dropping) {
                        state.commitPendingDrop(name: name.trimmingCharacters(in: .whitespaces))
                    }
                } else {
                    Pill(title: "Done", style: .filled) { state.cancelPendingDrop() }
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
            Text("Set up BitGraph").font(G.display).foregroundStyle(G.ink).padding(.bottom, 6)
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
