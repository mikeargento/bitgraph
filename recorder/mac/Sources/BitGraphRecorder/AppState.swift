// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import Foundation
import SwiftUI
import AppKit
import ServiceManagement

/// Everything the window shows, and the only place the app decides what to say.
///
/// ⚠️ ONLY FAILURES SPEAK. A folder that is recording says its name and its
/// counts. A folder with something wrong says what. Nothing here invents a
/// reassurance: "if you see it, it's a BitGraph".
///
/// ⚠️ THE LIGHT IS A DOOR. It is red when something has something to say, and
/// clicking it is how you get to what. It is not a decoration and it is not in
/// a title bar.
@MainActor
final class AppState: ObservableObject {
    @Published private(set) var status: Status?
    @Published private(set) var activity: String?
    @Published private(set) var reports: [String: FolderReport] = [:]
    @Published private(set) var troubles: [Trouble] = []
    @Published private(set) var coreState: DaemonClient.State = .starting
    @Published var checking: Set<String> = []
    /// A folder somebody checked once without watching it: the path somebody
    /// takes when a BitGraphed folder arrives from someone else.
    @Published private(set) var oneOff: (path: String, report: FolderReport)?
    @Published var openAtLogin: Bool = false

    // ── the calendar ────────────────────────────────────────────────────────
    /// The two sections of the window. Mike, 2026-09-09: "calendar should be
    /// a separate section".
    enum Section { case box, calendar }
    @Published var section: Section = .box
    /// Every day with recordings and how many: the spine of the ledger.
    @Published private(set) var spine: LedgerSpine?
    /// The days that have been drilled out, and what they hold.
    @Published private(set) var dayRecordings: [String: [Recording]] = [:]
    /// The days open in the list.
    @Published private(set) var expanded: Set<String> = []
    /// `yyyy-MM-dd`, the day the mini month picked.
    @Published private(set) var selectedDay: String?
    /// The month on show.
    @Published var month: Date = Date()
    /// A day the list should bring into view, cleared once it has.
    @Published var scrollTarget: String?
    /// The Make pill's menu, open or not.
    @Published var createMenu = false
    /// Setting up again, over a folder that is already set: from the moved-
    /// folder dialog's "Start a new one", or the sidebar's "Change folder…".
    @Published var settingUpAgain = false
    /// A batch that is listed and waiting to be named and made.
    @Published var pendingBatch: LookResult?

    // ── the window ──────────────────────────────────────────────────────────
    @Published var surface: Surface = .box
    @Published var proofPage: ProofPage? {
        didSet { armProofReload() }
    }
    /// The next look a waiting page has scheduled for itself.
    var proofReload: Task<Void, Never>?
    /// What the snackbar says, when it says anything.
    @Published var toast: String?
    /// A label and an act beside the snackbar's OK, when one applies.
    @Published var toastAction: (String, () -> Void)?
    var toastTask: Task<Void, Never>?
    /// The newest check of the update feed, once the core has answered.
    @Published var update: UpdateCheck?

    /// The app's own version, from the bundle build.sh stamped.
    static let version: String = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.0.0"
    @Published var dropping: Bool = false {
        didSet { dropStarted = dropping ? Date() : nil }
    }
    @Published var dropProgress: MakeProgress?
    /// When the work in hand began, so the surface can say how long it has been.
    @Published var dropStarted: Date?

    /// How far the work in hand is, when its phase can count; nil says "working".
    ///
    /// A check keeps the sliding band even though it counts: "when its
    /// checking a folder i liked that animation you had before" (Mike,
    /// 2026-09-09). The count still shows beside it.
    var dropFraction: Double? {
        guard let p = dropProgress, p.total > 1, p.phase != "check" else { return nil }
        return Double(p.done) / Double(p.total)
    }
    @Published var exporting: Bool = false
    @Published var exportNote: String?
    var pendingToken: String?
    var lastResults: LookResult? {
        if case .results(let look) = surface { return look }
        return storedResults
    }
    private var storedResults: LookResult?

    struct Trouble: Identifiable, Equatable {
        let id = UUID()
        var root: String
        var reason: String
        var at: Date
        var severity: TroubleSeverity = .fault
    }

    var client: DaemonClient!
    private var statusTimer: Timer?
    private let live: Bool

    init() {
        live = true
        let runtime = Runtime.locate()
        client = DaemonClient(nodePath: runtime.node, corePath: runtime.core) { [weak self] event in
            self?.handle(event)
        }
        client.$state.assign(to: &$coreState)
    }

    /// A state with no core behind it, for looking at the surface without
    /// running anything. Used by the preview harness; never by the app.
    init(preview status: Status?, reports: [String: FolderReport] = [:], troubles: [Trouble] = [], activity: String? = nil) {
        live = false
        self.status = status
        self.reports = reports
        self.troubles = troubles
        self.activity = activity
        coreState = .running
    }

    func start() {
        guard live else { return }
        openAtLogin = SMAppService.mainApp.status == .enabled
        client.start()
        Task { await refresh() }
        /* ⚠️ THE CORE PUSHES; THE APP DOES NOT POLL HARD. Every made, skipped
         * and trouble already refreshes this, so the timer is only a backstop
         * for state that changed with no event. At five seconds it was also
         * five filesystem touches a second across the synced folders, which on
         * macOS means a Desktop permission prompt over and over. */
        statusTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    func stop() {
        statusTimer?.invalidate()
        guard live else { return }
        client.stop()
    }

    // ── what the light says ─────────────────────────────────────────────────

    /// Red when something has something to say. Never red for work in progress.
    var everythingIsFine: Bool {
        if case .stopped = coreState { return false }
        /* ⚠️ A gap does not turn the light. Not being able to reach the ledger
         * is not a fault of the folder or of the person holding it, and it is
         * shown, quietly, either way. */
        if troubles.contains(where: { $0.severity == .fault }) { return false }
        for report in reports.values where report.counts.failed > 0 { return false }
        return true
    }

    /// One line for the menu bar, when there is one worth having.
    var summary: String {
        if case .stopped(let reason) = coreState { return reason }
        if let first = troubles.last { return first.reason }
        if let activity { return activity }
        let folders = status?.folders.count ?? 0
        if folders == 0 { return "No folders synced yet." }
        let recorded = status?.folders.compactMap(\.recorded).reduce(0, +) ?? 0
        return "\(Style.count(recorded)) recorded in \(folders) folder\(folders == 1 ? "" : "s")."
    }

    // ── doing things ────────────────────────────────────────────────────────

    /// ⚠️ Nothing is recorded before somebody has said where it goes.
    var isSetUp: Bool {
        guard let status else { return true }
        return !status.folder.isEmpty
    }

    var suggestedLocation: String {
        guard let status, !status.suggested.isEmpty else { return NSHomeDirectory() }
        return (status.suggested as NSString).deletingLastPathComponent
    }

    func setUp(at: String, name: String) async throws {
        _ = try await client.send("setup", ["at": at, "name": name], as: SetupResult.self)
        settingUpAgain = false
        await refresh()
        showBox()
    }

    /// The folder is not where it was: pick it where it is now. A folder
    /// that already has Recordings in it is continued, never replaced.
    func findFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Use this folder"
        panel.message = "Choose your BitGraph folder. One that already has Recordings in it is continued, never replaced."
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let at = url.deletingLastPathComponent().path
        let name = url.lastPathComponent
        Task {
            do { try await setUp(at: at, name: name) } catch { report(error.localizedDescription) }
        }
    }

    /// Something to say that belongs to no folder.
    private func report(_ reason: String) {
        troubles.append(Trouble(root: "", reason: reason, at: Date(), severity: .gap))
    }

    func rememberResults(_ look: LookResult) {
        storedResults = look
    }

    /// The spine, re-read from the folders: one readdir per day. The days
    /// already open are re-read with it, so a recording that just landed shows.
    func loadLedger() async {
        guard case .running = coreState else { return }
        if let spine = try? await client.send("ledger", as: LedgerSpine.self) {
            self.spine = spine
            for day in expanded { await loadDay(day) }
        }
    }

    /// One day drilled out. Read only when somebody opens it.
    func loadDay(_ day: String) async {
        guard case .running = coreState else { return }
        if let one = try? await client.send("recordings", ["day": day], as: DayRecordings.self) {
            dayRecordings[day] = one.recordings
        }
    }

    func toggleDay(_ day: String) {
        if expanded.contains(day) { expanded.remove(day) } else { expand(day) }
    }

    func expand(_ day: String) {
        expanded.insert(day)
        if dayRecordings[day] == nil { Task { await loadDay(day) } }
    }

    /// The mini month picks a day: the list goes to its month and brings it
    /// into view. Picking it again lets go of it.
    ///
    /// ⚠️ NOTHING OPENS A DAY BUT A CLICK ON IT. Mike, 2026-09-09: "all days
    /// should be retracted unless user clicks".
    func selectDay(_ day: String?) {
        selectedDay = day
        guard let day else { return }
        if let date = Self.date(of: day) { month = date }
        scrollTarget = day
    }

    func goToday() {
        selectDay(Self.today())
    }

    func stepMonth(_ n: Int) {
        month = Calendar.current.date(byAdding: .month, value: n, to: month) ?? month
    }

    /// The header's chips. Leaving a proof page for a section closes the page.
    func showSection(_ section: Section) {
        self.section = section
        createMenu = false
        if surface != .box { showBox() }
    }

    /// Every day that holds anything, for the mini month's dots.
    var markedDays: Set<String> {
        Set(spine?.days.map(\.day) ?? [])
    }

    /// The days of one month, newest first.
    func days(in month: Date) -> [DayCount] {
        let key = Self.monthKey(month)
        return spine?.days.filter { $0.day.hasPrefix(key) } ?? []
    }

    static func monthKey(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM"; return f.string(from: date)
    }

    static func date(of day: String) -> Date? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.date(from: day)
    }

    func refresh() async {
        guard case .running = coreState else { return }
        await loadLedger()
        do {
            status = try await client.send("status", as: Status.self)
        } catch {
            /* ⚠️ Not being able to ask is not the same as there being nothing
             * to report, and the previous answer is left standing rather than
             * being replaced by an empty one. */
        }
    }

    func addFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Sync"
        /* ⚠️ Said before the choice, not after it. Adding a folder records
         * what is ALREADY in it as well as what arrives later, and a recording
         * is permanent, so the moment to say so is here. */
        panel.message = "BitGraph Recorder will record what is already in this folder, and whatever arrives in it later. Nothing is uploaded, copied or moved: your files stay exactly where they are, on this machine."
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await watch(url.path) }
    }

    func watch(_ path: String) async {
        do {
            try await client.send("watch", ["root": path])
            await refresh()
        } catch {
            note(root: path, reason: error.localizedDescription)
        }
    }

    func unwatch(_ path: String) async {
        do {
            try await client.send("unwatch", ["root": path])
            reports[path] = nil
            await refresh()
        } catch {
            note(root: path, reason: error.localizedDescription)
        }
    }

    func pause(_ path: String, paused: Bool) async {
        do {
            try await client.send("pause", ["root": path, "paused": paused])
            await refresh()
        } catch {
            note(root: path, reason: error.localizedDescription)
        }
    }

    func check(_ path: String) async {
        checking.insert(path)
        defer { checking.remove(path) }
        do {
            reports[path] = try await client.send("check", ["root": path], as: FolderReport.self)
        } catch {
            note(root: path, reason: "the check could not be run: \(error.localizedDescription)")
        }
    }

    func fetchAnchors(_ path: String) async {
        do {
            _ = try await client.send("anchors", ["root": path], as: AnchorPass.self)
        } catch {
            note(root: path, reason: "anchors could not be fetched: \(error.localizedDescription)", severity: .gap)
        }
    }

    /// Only the surface tests use this: it moves the state the core would
    /// otherwise move, so the light's rules can be checked without a core.
    func applyForTesting(coreState: DaemonClient.State) {
        self.coreState = coreState
    }

    func setLedgerForTesting(spine: LedgerSpine, days: [String: [Recording]], expanded: Set<String>) {
        self.spine = spine
        self.dayRecordings = days
        self.expanded = expanded
    }

    func setDroppingForTesting(_ on: Bool, progress: MakeProgress?) {
        dropping = on
        dropProgress = progress
    }

    /// What this folder has to say. A trouble belongs to a folder or to
    /// nothing, and the two are shown in different places.
    func troubles(for path: String) -> [Trouble] {
        troubles.filter { $0.root == path }.suffix(3).reversed()
    }

    /// Troubles that belong to no folder: the core could not start, or nothing
    /// could be reached at all.
    var loose: [Trouble] {
        Array(troubles.filter { $0.root.isEmpty }.suffix(2).reversed())
    }

    func clearTroubles() {
        troubles.removeAll()
    }

    /// ⚠️ Checking is not watching. This runs one check over a folder and
    /// forgets it: nothing is added to the list, nothing is written into the
    /// folder, and no BitGraph is made. It is how a folder somebody SENT you
    /// gets read.
    func checkOneOff() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Check"
        panel.message = "Check the BitGraphs in this folder. Nothing is recorded, nothing is changed, and nothing leaves this machine."
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            checking.insert(url.path)
            dropStarted = Date()
            defer {
                checking.remove(url.path)
                if !dropping { dropProgress = nil; dropStarted = nil }
            }
            do {
                oneOff = (url.path, try await client.send("check", ["root": url.path], as: FolderReport.self))
            } catch {
                note(root: "", reason: "that folder could not be checked: \(error.localizedDescription)", severity: .gap)
            }
        }
    }

    func dismissOneOff() {
        oneOff = nil
    }

    /// ⚠️ A watcher that only runs while somebody remembers to start it is not
    /// a watcher. Opening at login is the difference between a service and a
    /// thing you have to think about, so it is offered plainly and left to the
    /// person.
    func setOpenAtLogin(_ on: Bool) {
        do {
            if on {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            openAtLogin = SMAppService.mainApp.status == .enabled
        } catch {
            note(root: "", reason: "opening at login could not be changed: \(error.localizedDescription)")
            openAtLogin = SMAppService.mainApp.status == .enabled
        }
    }

    func reveal(_ path: String) {
        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: path)
    }

    /// Show one file, selected, rather than opening the folder it is in.
    /// The file, in the app the Mac would open it with. Callers pass the
    /// recording's own hard link, never the origin.
    static func openFile(_ path: String) {
        guard !path.isEmpty else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    func revealFile(_ path: String) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }

    // ── what the core tells us ──────────────────────────────────────────────

    private func handle(_ event: DaemonEvent) {
        switch event {
        case .ready:
            Task { await refresh(); await checkForUpdate() }
        case .update(let check):
            /* The core's daily check found something newer. */
            offer(check)
        case .settling(let root, let files):
            activity = "\(name(root)): looking at \(files) file\(files == 1 ? "" : "s")…"
        case .making(let root, let files, let progress):
            if let p = progress {
                activity = "\(name(root)): \(p.phase) \(Style.count(p.done))/\(Style.count(p.total))"
                if dropping { dropProgress = p }
            } else {
                activity = "\(name(root)): recording \(Style.count(files)) file\(files == 1 ? "" : "s")…"
            }
        case .checking(let root, let done, let total):
            /* A check fills the same bar a make does. */
            activity = "\(name(root)): checking \(Style.count(done))/\(Style.count(total))"
            if !checking.isEmpty {
                dropProgress = MakeProgress(phase: "check", done: done, total: total)
                if dropStarted == nil { dropStarted = Date() }
            }
        case .made(let root, let result):
            activity = "\(name(root)): recorded \(result.files.count) file\(result.files.count == 1 ? "" : "s") at position \(result.position.counter)."
            /* A new recording lands on today, so the calendar opens there. */
            selectDay(Self.today())
            Task { await refresh() }
        case .skipped(let root, let files):
            let same = files.filter { $0.reason == "same-bytes" }.count
            let already = files.count - same
            var parts: [String] = []
            if already > 0 { parts.append("\(already) already recorded") }
            if same > 0 { parts.append("\(same) the same bytes as another, recorded once") }
            activity = "\(name(root)): \(parts.joined(separator: ", "))."
        case .idle:
            /* ⚠️ Deliberately not "all good". The app says what happened, not
             * that everything is fine. */
            activity = nil
        case .anchors(let root, let pass) where pass.landed > 0:
            /* No folder name when the folder is the library itself: "Recordings:
             * 2 anchors arrived" labelled the news with the name of the place
             * (Mike, 2026-09-10: "a bit crowded yes?"). */
            let place = (root == status?.library || root == status?.folder) ? "" : "\(name(root)): "
            activity = "\(place)\(pass.landed) anchor\(pass.landed == 1 ? "" : "s") arrived."
            /* The calendar's dots and an open page both show what just landed. */
            Task { await refresh(); await reloadProofPage() }
        case .anchors:
            break
        case .trouble(let root, let reason, _, let severity):
            note(root: root, reason: reason, severity: severity)
        case .watching, .settingsChanged, .unknown:
            break
        }
    }

    func note(root: String, reason: String, severity: TroubleSeverity = .fault) {
        troubles.append(Trouble(root: root, reason: reason, at: Date(), severity: severity))
        if troubles.count > 20 { troubles.removeFirst(troubles.count - 20) }
        say(reason)
    }

    /// ⚠️ A FAILURE IS SAID WHERE THE PERSON IS LOOKING. Mike, 2026-09-09: a
    /// ten-file drop's commit threw, the dialog closed, and "it didnt do a
    /// thing": the reason had gone to the menu bar popover alone. Calendar's
    /// snackbar, at the bottom of the window, for ten seconds or a click.
    /// Ask the core once, on launch, with the app's own version. A feed that
    /// cannot be reached is not news: the daily check will say.
    func checkForUpdate() async {
        do {
            let check = try await client.send("update", ["current": AppState.version], as: UpdateCheck.self)
            offer(check)
        } catch {
            /* Quiet. Nothing on screen depends on this answer. */
        }
    }

    /// Show what the check found. Only a NEWER version is said out loud, and
    /// only once per version, so the same news does not land every day.
    private func offer(_ check: UpdateCheck) {
        update = check
        guard check.available, check.latest != offeredVersion else { return }
        offeredVersion = check.latest
        say("BitGraph Recorder \(check.latest) is available.", action: ("Download", { AppState.open(check.url) }))
    }
    private var offeredVersion = ""

    static func open(_ url: String) {
        guard let u = URL(string: url), u.scheme == "https" else { return }
        NSWorkspace.shared.open(u)
    }

    func say(_ text: String, action: (String, () -> Void)? = nil) {
        toast = text
        toastAction = action
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    /// The pane where the person gives the app its folder back. The Ventura+
    /// form first; the older one still resolves on 14 as a fallback.
    static func openPrivacySettings() {
        let panes = [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
        ]
        for pane in panes {
            if let url = URL(string: pane), NSWorkspace.shared.open(url) { return }
        }
    }

    func dismissToast() {
        toastTask?.cancel()
        toast = nil
        toastAction = nil
    }

    static func today() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }

    private func name(_ path: String) -> String {
        path.isEmpty ? "BitGraph Recorder" : (path as NSString).lastPathComponent
    }
}

/// Where the core and the runtime it needs live.
enum Runtime {
    struct Paths {
        var node: String
        var core: String
    }

    /// Inside the bundle when shipped; in the tree when this is a development
    /// run, so the app can be driven without being packaged first.
    static func locate() -> Paths {
        let resources = Bundle.main.resourceURL
        if let resources {
            let node = resources.appendingPathComponent("node").path
            let core = resources.appendingPathComponent("core/dist/cli.js").path
            if FileManager.default.isExecutableFile(atPath: node), FileManager.default.fileExists(atPath: core) {
                return Paths(node: node, core: core)
            }
        }
        let env = ProcessInfo.processInfo.environment
        return Paths(
            node: env["BITGRAPH_FOLDER_NODE"] ?? "/usr/bin/env",
            core: env["BITGRAPH_FOLDER_CORE"] ?? "bitgraph-recorder"
        )
    }
}
