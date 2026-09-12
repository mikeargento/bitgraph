// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import Foundation
import SwiftUI
import AppKit

/// The one window: what it is showing.
///
/// ⚠️ ONE GESTURE, THE RESULTS SAY THE OUTCOME. Dropping is the shutter. A lone
/// file with no BitGraph gets one; a lone file that has one opens it; a batch
/// is listed and waits, because two or more files becoming one permanent
/// position deserves a second of somebody's attention; a folder of BitGraphs
/// is checked and nothing is recorded. The window itself is the target: there
/// is no box (Mike, 2026-09-11: "kill the box").
enum Surface: Equatable {
    case calendar
    /// The page "+ New" opens: the frame, the site's home, with the browse
    /// link in it. A drop lands anywhere, this page included; the page is
    /// for the person who came in by the pill (Mike, 2026-09-11: "+new sits
    /// next to bitgraph and always opens the dropbox page").
    case new
    case results(LookResult)
    case proof(ProofSubject)
}

struct ProofSubject: Equatable {
    var root: String
    /// Empty when the set was too big to fan out and there is no file beside this one.
    var evidencePath: String
    var filePath: String
    var name: String
    /// ⚠️ The handle that always works. Above a few thousand members nothing is
    /// written beside each file, so the digest and the position are how a
    /// member's evidence is found and built.
    var originDigestB64: String?
    var position: Position?
    /// True only in the moment after minting, which is the only moment the ring plays.
    var justMade: Bool
    /// False when the page is about a recording of several files and nobody
    /// has picked one yet: then nothing is previewed. Mike, 2026-09-09:
    /// "files in this recording shouldnt preview anything unless a file is
    /// selected".
    var chosenFile: Bool = true
}

/// A BitGraph, assembled for the page: what the folder holds, and what a check
/// of the bytes said about it.
struct ProofPage: Equatable {
    var subject: ProofSubject
    var described: Described
    var checked: CheckedFile?
}

@MainActor
extension AppState {
    // ── the gesture ─────────────────────────────────────────────────────────

    func drop(_ urls: [URL]) {
        let paths = urls.map(\.path)
        guard !paths.isEmpty else { return }
        Task { await performDrop(paths) }
    }

    private func performDrop(_ paths: [String]) async {
        dropping = true
        dropProgress = nil
        defer { dropping = false; dropProgress = nil }
        do {
            let answer = try await client.send("drop", ["paths": paths], as: DropAnswer.self)
            switch answer.action {
            case "open":
                guard let opened = answer.opened else { return }
                await openProof(root: answer.root, evidencePath: opened.evidencePath ?? "", filePath: opened.path,
                                name: opened.name, origin: opened.originDigestB64, position: opened.position, justMade: false)
            case "checked":
                /* A folder of BitGraphs: the report, over the calendar, where
                 * the drop was made. */
                if let report = answer.report { showCheck(path: answer.root, report: report) }
            case "made":
                if let made = answer.made, let first = made.files.first {
                    await openProof(root: answer.root, evidencePath: first.evidencePath, filePath: first.path, name: first.name,
                                    origin: first.originDigestB64, position: made.position, justMade: true)
                } else if let only = answer.look.files.first {
                    await openProof(root: answer.root, evidencePath: only.evidencePath ?? "", filePath: only.path, name: only.name,
                                    origin: only.originDigestB64, position: only.position, justMade: false)
                }
            default:
                /* A batch is a dialog over the dashboard, not a page of its
                 * own: the Calendar way, where you name the thing and press
                 * Save with everything else still visible behind it. */
                pendingToken = answer.token
                pendingBatch = answer.look
                surface = .calendar
            }
            await refresh()
        } catch {
            note(root: "", reason: error.localizedDescription, severity: .gap)
        }
    }

    /// Make what a listed drop found, under the name it was given. The files
    /// are not read again.
    func commitPendingDrop(name: String = "", again: Bool = false) {
        guard let token = pendingToken, let batch = pendingBatch else { return }
        Task {
            dropping = true
            defer { dropping = false; dropProgress = nil }
            do {
                let result = try await client.send("commitDrop", ["token": token, "again": again, "name": name], as: MakeResultAnswer.self)
                pendingToken = nil
                pendingBatch = nil
                if let made = result.made, let first = made.files.first {
                    /* A batch just made opens as the recording, previewing
                     * nothing until a file is picked; a lone file is the file. */
                    let several = made.files.count > 1
                    await openProof(root: batch.root, evidencePath: first.evidencePath, filePath: first.path,
                                    name: several ? ((first.evidencePath as NSString).deletingLastPathComponent as NSString).lastPathComponent : first.name,
                                    origin: first.originDigestB64, position: made.position, justMade: true, chosenFile: !several)
                }
                await refresh()
            } catch {
                pendingToken = nil
                pendingBatch = nil
                note(root: "", reason: error.localizedDescription, severity: .gap)
            }
        }
    }

    func cancelPendingDrop() {
        pendingToken = nil
        pendingBatch = nil
    }

    /// Open a recording straight from the ledger.
    func openRecording(_ recording: Recording) {
        let proofPath = recording.path + "/proof.json"
        Task {
            let subject = ProofSubject(root: recording.path, evidencePath: proofPath, filePath: "", name: recording.name, originDigestB64: nil, position: nil, justMade: false)
            surface = .proof(subject)
            proofPage = nil
            do {
                let described = try await client.send("describe", ["root": recording.path, "evidence": proofPath], as: Described.self)
                var named = subject
                named.filePath = described.filePath ?? ""
                named.originDigestB64 = described.evidence?.originDigestB64
                named.position = described.evidence?.position
                named.chosenFile = (described.members?.count ?? 0) <= 1
                surface = .proof(named)
                /* ⚠️ The recording checks itself: root IS the recording folder. */
                let report = named.filePath.isEmpty ? nil : try? await client.send("verify", ["root": recording.path, "files": [named.filePath]], as: FolderReport.self)
                proofPage = ProofPage(subject: named, described: described, checked: report?.speaking.first)
            } catch {
                note(root: recording.path, reason: "that recording could not be read: \(error.localizedDescription)", severity: .gap)
                surface = .calendar
            }
        }
    }

    /// Another file of the recording the page is on. The recording is read
    /// again with that member named, and the member's own bytes are checked.
    func openMember(_ member: MemberInfo) {
        guard case .proof(let current) = surface, let page = proofPage else { return }
        let bundleDir = (current.evidencePath as NSString).deletingLastPathComponent
        let filePath = (bundleDir as NSString).appendingPathComponent(member.rel)
        let subject = ProofSubject(root: current.root, evidencePath: current.evidencePath, filePath: filePath, name: current.name,
                                   originDigestB64: member.originDigestB64, position: page.described.evidence?.position, justMade: false, chosenFile: true)
        surface = .proof(subject)
        Task {
            do {
                let described = try await client.send("describe", ["root": current.root, "evidence": current.evidencePath, "origin": member.originDigestB64], as: Described.self)
                let report = try? await client.send("verify", ["root": bundleDir, "files": [filePath]], as: FolderReport.self)
                proofPage = ProofPage(subject: subject, described: described, checked: report?.speaking.first)
            } catch {
                note(root: current.root, reason: "that file could not be read: \(error.localizedDescription)", severity: .gap)
            }
        }
    }

    func openProof(root: String, evidencePath: String, filePath: String, name: String, origin: String? = nil, position: Position? = nil, justMade: Bool, chosenFile: Bool = true) async {
        let subject = ProofSubject(root: root, evidencePath: evidencePath, filePath: filePath, name: name, originDigestB64: origin, position: position, justMade: justMade, chosenFile: chosenFile)
        surface = .proof(subject)
        proofPage = nil
        do {
            let described = try await client.send("describe", ["root": root] .merging(handle(subject)) { a, _ in a }, as: Described.self)
            /* ⚠️ The page says nothing about validity until the bytes have been
             * checked. Reading a proof off the disk is not verifying it. */
            let report = try? await client.send("verify", ["root": root, "files": [filePath]], as: FolderReport.self)
            proofPage = ProofPage(subject: subject, described: described, checked: report?.speaking.first)
        } catch {
            note(root: root, reason: "that BitGraph could not be read: \(error.localizedDescription)", severity: .gap)
            surface = .calendar
        }
    }

    /// Bring the window forward on the calendar, from the menu bar.
    func openWindow() {
        showCalendar()
        NSApp.activate(ignoringOtherApps: true)
        NSApp.windows.first(where: { $0.canBecomeMain })?.makeKeyAndOrderFront(nil)
    }

    /// How to name a BitGraph to the core.
    ///
    /// ⚠️ A RECORDING IS NAMED BY ITS PROOF. `proof.json` inside the recording
    /// folder is the whole BitGraph, and the member is named beside it by
    /// digest. Naming a member by digest AND position alone sends the core
    /// looking for evidence beside the original, where the one-shape world
    /// keeps nothing: the page after a drop came up empty that way (Mike,
    /// 2026-09-09). Digest and position are only for evidence that is not a
    /// recording's proof.
    func handle(_ subject: ProofSubject) -> [String: Any] {
        if subject.evidencePath.hasSuffix("/proof.json") {
            var named: [String: Any] = ["evidence": subject.evidencePath]
            if let origin = subject.originDigestB64 { named["origin"] = origin }
            return named
        }
        if let origin = subject.originDigestB64, let position = subject.position {
            return ["origin": origin, "epochId": position.epochId, "counter": position.counter]
        }
        return ["evidence": subject.evidencePath]
    }

    /// The open page, read and checked again: its anchors landed, or a while
    /// passed while it was still waiting on them. Mike, 2026-09-09: "so new
    /// anchors wont load?" They had; the page had not looked.
    func reloadProofPage() async {
        guard case .proof(let subject) = surface, proofPage != nil else { return }
        let bundleDir = (subject.evidencePath as NSString).deletingLastPathComponent
        let checkRoot = subject.filePath.hasPrefix(bundleDir + "/") ? bundleDir : subject.root
        guard let described = try? await client.send("describe", ["root": subject.root].merging(handle(subject)) { a, _ in a }, as: Described.self) else { return }
        let file = subject.filePath.isEmpty ? (described.filePath ?? "") : subject.filePath
        let report = file.isEmpty ? nil : try? await client.send("verify", ["root": checkRoot, "files": [file]], as: FolderReport.self)
        /* The page may have moved on while this was out. */
        guard case .proof(let still) = surface, still == subject else { return }
        var quiet = subject
        quiet.justMade = false
        surface = .proof(quiet)
        proofPage = ProofPage(subject: quiet, described: described, checked: report?.speaking.first)
    }

    /// While a page is still waiting on an anchor, it looks again every so
    /// often on its own; the pass's event brings it sooner.
    func armProofReload() {
        proofReload?.cancel()
        proofReload = nil
        guard case .proof = surface, let page = proofPage else { return }
        let sides = page.checked?.bounds ?? []
        let waiting = page.checked != nil && (sides.count < 2 || sides.contains { $0.blockTime == nil })
        guard waiting else { return }
        proofReload = Task { [weak self] in
            try? await Task.sleep(for: .seconds(20))
            guard !Task.isCancelled else { return }
            await self?.reloadProofPage()
        }
    }

    /// The New page: the frame.
    func showNew() {
        surface = .new
        calendarOpen = false
        proofReload?.cancel()
        proofReload = nil
        proofPage = nil
    }

    /// The calendar, with every page and pending thing put away.
    func showCalendar() {
        surface = .calendar
        proofReload?.cancel()
        proofReload = nil
        proofPage = nil
        pendingToken = nil
        pendingBatch = nil
    }

    func back() {
        if case .proof = surface, case .some = lastResults {
            surface = .results(lastResults!)
            proofPage = nil
        } else {
            showCalendar()
        }
    }

    private func rootOf(_ surface: Surface) -> String? {
        if case .results(let look) = surface { return look.root }
        if case .proof(let subject) = surface { return subject.root }
        return nil
    }

    /// Open a .bitgraph somebody double-clicked in Finder.
    ///
    /// ⚠️ The folder is worked out from where the file SITS, not stored in it.
    /// A BitGraph names no path: it is reunited with its file by content, and
    /// the mirror under BitGraphs/ is the convenience that makes that cheap.
    func openBitGraphFile(_ url: URL) {
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard let at = parts.lastIndex(of: "BitGraphs"), at + 1 < parts.count else {
            note(root: "", reason: "that BitGraph is not inside a BitGraphs folder, so the folder it belongs to cannot be worked out.", severity: .gap)
            return
        }
        let root = "/" + parts[1..<at].joined(separator: "/")
        var rel = parts[(at + 1)...].joined(separator: "/")
        /* Either name: `.bitgraph` when the file carries a whole proof,
         * `.position.json` when it names a shared one. */
        for suffix in [".bitgraph", ".position.json"] where rel.hasSuffix(suffix) {
            rel.removeLast(suffix.count)
            break
        }
        let filePath = root + "/" + rel

        NSApp.activate(ignoringOtherApps: true)
        NSApp.windows.first(where: { $0.canBecomeMain })?.makeKeyAndOrderFront(nil)
        Task {
            await openProof(
                root: root,
                evidencePath: url.path,
                filePath: filePath,
                name: (rel as NSString).lastPathComponent,
                justMade: false
            )
        }
    }

    /// Write the package somewhere, with the new file rebuilt into it.
    ///
    /// ⚠️ This is the ONE place the fused bytes become a file. Everywhere else
    /// they are virtual and the proof rebuilds them.
    func exportBitGraph(_ subject: ProofSubject) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Export"
        panel.message = "Writes a folder holding the original, the proof, the anchors, and the new file rebuilt from them."
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let into = panel.url else { return }
        Task {
            exporting = true
            exportNote = nil
            defer { exporting = false }
            do {
                var request: [String: Any] = ["root": subject.root, "file": subject.filePath, "into": into.path]
                for (k, v) in handle(subject) { request[k] = v }
                let result = try await client.send("export", request, as: ExportResult.self)
                exportNote = result.note ?? "Written to \((result.path as NSString).lastPathComponent)"
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: result.path)])
            } catch {
                exportNote = nil
                note(root: subject.root, reason: "the package could not be written: \(error.localizedDescription)", severity: .gap)
            }
        }
    }

    /// The picker, for people who would rather not drag.
    func chooseFilesToMake() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = true
        panel.prompt = "Record"
        panel.message = "One file is fused on its own. Two or more become one BitGraph at one position."
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK else { return }
        drop(panel.urls)
    }
}

/// What an export wrote.
struct ExportResult: Decodable, Equatable {
    var path: String
    var files: [String]
    var fusedName: String?
    var bytes: Int
    /// Why the new file is not in there, when it is not.
    var note: String?
}

/// What setup made.
struct SetupResult: Decodable, Equatable {
    var folder: String
    var library: String
    /// True when a folder was already there and is being continued.
    var adopted: Bool
}

/// commitDrop's answer: the same two fields a make always returns.
struct MakeResultAnswer: Decodable, Equatable {
    var made: MakeResult?
    var skipped: [SkippedFile]?
}
