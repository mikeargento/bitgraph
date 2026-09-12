// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// The main surface, laid out like Google Calendar: a sidebar with the create
/// pill, the mini month and the search, and beside it the month's days.
///
/// ⚠️ NO SYNCED FOLDERS. Mike, 2026-09-09: "i dont think 'syncing folders' is
/// a good idea. it could get MESSY fast." Pointed at a folder holding a whole
/// software package it would have recorded thousands of files as one set, and
/// every mistake consumes a real position. The box is deliberate. The core
/// still knows how to watch a folder (the CLI's `watch`); the app does not
/// offer it.
///
/// ⚠️ THE CONTROLS ARE ON THE SURFACE. Nothing is hidden in a menu bar
/// popover: the way in, the calendar and the recordings are all in the
/// window, which is what a dashboard is.
///
/// ⚠️ ONE SECTION. The calendar is the app: the days of a month, each a row
/// that opens to what it holds (Mike, 2026-09-09: "lists of days should be
/// expandable ... like drill out from day"). There was a second section, the
/// box, a permanent dropbox; the window itself takes a drop anywhere, so the
/// box went (Mike, 2026-09-11: "kill the box").
struct Dashboard: View {
    @ObservedObject var state: AppState

    var body: some View {
        /* No divider the height of the window: the little month carries a
         * short line at its right instead (Mike, 2026-09-09: "instead of a
         * sidebar line the calendar just has a right line"). */
        HStack(spacing: 0) {
            Sidebar(state: state)
                .frame(width: 256)
            CalendarPane(state: state)
        }
        .background(G.ground)
    }
}

// ── the sidebar ────────────────────────────────────────────────────────────

struct Sidebar: View {
    @ObservedObject var state: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            /* One way in that is not a drag: the picker. It was a menu of two
             * ("Record a BitGraph…", "Check a folder…") until the drop learned
             * to tell a folder of BitGraphs from a folder of files. */
            CreatePill(title: "New") { state.chooseFilesToMake() }
            .padding(.leading, 12)
            .padding(.top, 16)
            .padding(.bottom, 22)

            do {
                MiniMonth(
                    month: $state.month,
                    selected: Binding(get: { state.selectedDay }, set: { state.selectDay($0) }),
                    marked: state.markedDays
                )
                .padding(.leading, 8)
                .padding(.trailing, 16)
                .overlay(alignment: .trailing) { Rectangle().fill(G.border).frame(width: 1) }
                Spacer().frame(height: 26)

                /* Under the month, where the sidebar was empty: the search,
                 * and at the foot what the two marks mean (Mike, 2026-09-11:
                 * "do them all"). */
                SearchField(placeholder: "Search recordings", text: $state.query, focus: $state.focusSearch)
                    .padding(.leading, 16)
                    .padding(.trailing, 16)
            }

            Spacer()

            AnchorLegend()
                .padding(.leading, 16)
                .padding(.bottom, 18)
        }
        .padding(.horizontal, 8)
        .background(G.ground)
    }

    /// Recordings are counted where they are. Files are the index's number,
    /// so they are only said when it has one.
    static func summary(_ status: Status) -> String {
        /* ⚠️ A blocked folder is never "Nothing recorded yet": the count is 0
         * because macOS would not let the core look. */
        if status.folderBlocked == true { return "macOS is blocking access to your BitGraph folder" }
        if status.recordings == 0 { return "Nothing recorded yet" }
        var line = "\(G.count(status.recordings)) recording\(status.recordings == 1 ? "" : "s")"
        if status.recorded > 0 { line += " · \(G.count(status.recorded)) file\(status.recorded == 1 ? "" : "s")" }
        return line
    }
}

extension AppState {
    /// A recording's colour. One source now, so one colour; a synced folder
    /// used to wear its own, and the hook stays for a narrower watch someday.
    func color(for recording: Recording) -> Color {
        G.blue
    }
}

// ── files, dropped ─────────────────────────────────────────────────────────

enum FileDrop {
    /// Every URL in a drop, once they have all been read, on the main thread.
    static func urls(_ providers: [NSItemProvider], _ done: @escaping ([URL]) -> Void) {
        let group = DispatchGroup()
        var urls: [URL] = []
        let lock = NSLock()
        for provider in providers {
            group.enter()
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url { lock.lock(); urls.append(url); lock.unlock() }
                group.leave()
            }
        }
        group.notify(queue: .main) {
            guard !urls.isEmpty else { return }
            done(urls)
        }
    }
}

/// The bottom of the window, one bar on one baseline: the BitGraph folder,
/// what it holds, the two things to do with it, and the company at the far
/// end. The same bar under every section, so nothing at the bottom is placed
/// on its own ("the bottom is jacked now" — Mike, 2026-09-09).
struct FooterBar: View {
    @ObservedObject var state: AppState

    var body: some View {
        VStack(spacing: 0) {
            /* No hairline: with everything on one baseline the bar holds by
             * itself ("footer stroke can go now" — Mike, 2026-09-09). */
            /* Three places on one line: the library at the left, the company
             * at the right, and the two buttons dead centre whatever the
             * other two measure ("now if these are in middle it might be
             * fixed" — Mike, 2026-09-09). */
            ZStack {
                HStack(spacing: 16) {
                    if let status = state.status, !status.folder.isEmpty {
                        HStack(spacing: 6) {
                            Text(FileManager.default.displayName(atPath: status.folder)).font(G.label).foregroundStyle(G.ink)
                            Text("· \(Sidebar.summary(status))").font(G.small).foregroundStyle(G.secondary)
                        }
                        .lineLimit(1)
                    }
                    Spacer(minLength: 16)
                    /* String(year): an interpolated Int is formatted with a thousands
                     * separator, and "© 2,026" is not a year. */
                    Text("© \(String(Calendar.current.component(.year, from: Date()))) Argento Computing Inc.")
                        .font(G.small)
                        .foregroundStyle(G.secondary)
                        .lineLimit(1)
                        .fixedSize()
                }
                if let status = state.status, !status.folder.isEmpty {
                    /* ⚠️ Pinned to their natural size: squeezed, "Show in Finder"
                     * broke onto two lines, which was "the buttons are off". */
                    HStack(spacing: 8) {
                        /* The BitGraph folder itself, not Recordings inside it ("shouldnt show in finder point to the bitgraph" — Mike, 2026-09-09). */
                    Pill(title: "Show in Finder", style: .outlined, icon: "folder") { state.reveal(status.folder) }
                            .fixedSize()
                        Pill(title: "Change folder…", style: .outlined) { state.findFolder() }
                            .fixedSize()
                    }
                }
            }
            .padding(.horizontal, 20)
            .frame(height: 60)
        }
        .background(G.ground)
    }
}

// ── the calendar section ───────────────────────────────────────────────────

/// The month on show as a list of its days, newest first. A day is a row
/// (the weekday, the number, how many) and opens to its recordings.
///
/// ⚠️ Nothing is read for a closed day but its count. Mike's library holds
/// 2,570 recordings; the list that showed them all was the list he asked to
/// have folded.
struct CalendarPane: View {
    @ObservedObject var state: AppState

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    let days = state.days(in: state.month)
                    if state.searching {
                        /* The field has something in it: the month's days
                         * make way for what was found, until it is cleared. */
                        SearchResults(state: state)
                    } else if state.spine == nil {
                        Text("Reading the library…").font(G.body).foregroundStyle(G.secondary)
                    } else if state.spine?.total == 0 {
                        /* The one written hint, for a library with nothing in
                         * it yet. Once anything is recorded it goes, and the
                         * frame that draws under a drag does the teaching. */
                        Text("Drop files anywhere in this window to record them.").font(G.body).foregroundStyle(G.secondary)
                    } else if days.isEmpty {
                        Text("Nothing recorded in \(monthTitle).").font(G.body).foregroundStyle(G.secondary)
                    } else {
                        ForEach(days) { day in
                            DayRow(day: day, state: state).id(day.day)
                        }
                    }
                }
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 32)
                .padding(.vertical, 20)
            }
            .background(G.ground)
            .onChange(of: state.scrollTarget) { _, target in bring(target, proxy) }
            .onAppear { bring(state.scrollTarget, proxy) }
        }
    }

    private func bring(_ target: String?, _ proxy: ScrollViewProxy) {
        guard let target else { return }
        withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(target, anchor: .top) }
        state.scrollTarget = nil
    }

    private var monthTitle: String {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"; return f.string(from: state.month)
    }
}

/// What a search found, newest first, under the day each was made: a day's
/// name is a way back to it in the month.
private struct SearchResults: View {
    @ObservedObject var state: AppState

    var body: some View {
        let q = state.trimmedQuery
        if let found = state.found, found.query == q {
            Text(headline(found))
                .font(G.small).foregroundStyle(G.secondary)
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            ForEach(groups(found.recordings), id: \.day) { group in
                VStack(alignment: .leading, spacing: 2) {
                    DayLink(day: group.day, state: state)
                    ForEach(group.recordings) { r in
                        RecordingRow(recording: r, state: state)
                    }
                }
                .padding(.bottom, 10)
                .overlay(alignment: .bottom) { Rectangle().fill(G.border).frame(height: 1) }
            }
        } else {
            Text("Searching…").font(G.small).foregroundStyle(G.secondary).padding(.horizontal, 10)
        }
    }

    private func headline(_ found: SearchResult) -> String {
        let n = found.recordings.count
        if n == 0 { return "Nothing named “\(found.query)”." }
        var line = n == 1 ? "1 recording named “\(found.query)”" : "\(G.count(n)) recordings named “\(found.query)”"
        if found.truncated { line += ", the newest \(G.count(n)) of more" }
        return line
    }

    private struct Group {
        let day: String
        var recordings: [Recording]
    }

    /// In the order the core answered, which is newest day first.
    private func groups(_ rows: [Recording]) -> [Group] {
        var out: [Group] = []
        for r in rows {
            if out.last?.day == r.day { out[out.count - 1].recordings.append(r) } else { out.append(Group(day: r.day, recordings: [r])) }
        }
        return out
    }
}

/// A day's name over its found recordings. Clicking it leaves the search for
/// that day in the month, open.
private struct DayLink: View {
    let day: String
    @ObservedObject var state: AppState
    @State private var hovering = false

    var body: some View {
        Button { state.leaveSearch(for: day) } label: {
            HStack(spacing: 8) {
                Text(title).font(G.label).foregroundStyle(hovering ? G.blue : G.ink)
                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(G.blue)
                    .opacity(hovering ? 1 : 0)
            }
            .padding(.horizontal, 10)
            .padding(.top, 14)
            .padding(.bottom, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help("Open this day in the month")
    }

    private var title: String {
        guard let d = AppState.date(of: day) else { return day }
        let f = DateFormatter(); f.dateFormat = "EEEE, MMMM d, yyyy"; return f.string(from: d)
    }
}

private struct DayRow: View {
    let day: DayCount
    @ObservedObject var state: AppState
    @State private var hovering = false

    private var open: Bool { state.expanded.contains(day.day) }
    private var isToday: Bool { day.day == AppState.today() }
    private var isSelected: Bool { state.selectedDay == day.day }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { state.toggleDay(day.day) }
            } label: {
                HStack(spacing: 16) {
                    VStack(spacing: 2) {
                        Text(weekday).font(G.tiny).foregroundStyle(isToday ? G.blue : G.secondary)
                        /* A square, not a circle: "people associate days with
                         * squares" (Mike, 2026-09-09). */
                        Text(number)
                            .font(Font.system(size: 22, weight: .regular))
                            .foregroundStyle(isToday ? .white : G.ink)
                            .frame(width: 40, height: 40)
                            .background(RoundedRectangle(cornerRadius: 8).fill(isToday ? G.blue : (isSelected ? G.blueTonal : .clear)))
                    }
                    .frame(width: 48)
                    /* The row lines up with the middle of the SQUARE, not of the
                     * column: with the weekday riding above it, the column's
                     * centre sat above the tile's and the text looked adrift
                     * ("because of the weight of the blue date, this looks
                     * misaligned" — Mike, 2026-09-09). The tile is the bottom
                     * 40pt of the column. */
                    .alignmentGuide(VerticalAlignment.center) { d in d.height - 20 }
                    Text(countLine).font(G.body).foregroundStyle(G.ink)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(G.secondary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .frame(width: 32, height: 32)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 8).fill(hovering ? G.hover : .clear))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .contextMenu {
                if let library = state.status?.library {
                    Button("Show in Finder") { state.reveal((library as NSString).appendingPathComponent(day.day)) }
                }
            }

            if open {
                VStack(alignment: .leading, spacing: 2) {
                    if let rows = state.dayRecordings[day.day] {
                        ForEach(rows) { r in
                            RecordingRow(recording: r, state: state)
                        }
                    } else {
                        Text("Reading…").font(G.small).foregroundStyle(G.secondary).padding(.horizontal, 10).padding(.vertical, 6)
                    }
                }
                .padding(.leading, 64)
                .padding(.bottom, 10)
            }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(G.border).frame(height: 1) }
    }

    private var countLine: String {
        day.count == 1 ? "1 recording" : "\(G.count(day.count)) recordings"
    }

    private var weekday: String {
        guard let d = AppState.date(of: day.day) else { return "" }
        let f = DateFormatter(); f.dateFormat = "EEE"; return f.string(from: d).uppercased()
    }

    private var number: String {
        String(day.day.split(separator: "-").last ?? "")
    }
}

private struct RecordingRow: View {
    let recording: Recording
    @ObservedObject var state: AppState
    @State private var hovering = false

    var body: some View {
        Button { state.openRecording(recording) } label: {
            HStack(spacing: 10) {
                /* Filled once its anchors are in; a ring while they are on the
                 * way, and that is all that says so: it happens by itself. */
                let color = state.color(for: recording)
                Circle().fill(recording.waitingOnAnchors ? .clear : color)
                    .overlay(Circle().strokeBorder(color, lineWidth: 1.5))
                    .frame(width: 9, height: 9)
                    .help(recording.waitingOnAnchors ? "Waiting on its Ethereum anchors. They arrive by themselves." : "Anchored to Ethereum.")
                /* When it was written, this machine's clock. Mike, 2026-09-09:
                 * "these should have times on them". */
                Text(Self.time(recording.writtenAt))
                    .font(G.small).monospacedDigit().foregroundStyle(G.secondary)
                    .frame(width: 66, alignment: .leading)
                Text(recording.name).font(G.body).foregroundStyle(G.ink).lineLimit(1).truncationMode(.middle)
                Spacer()
                Text(recording.files == 1 ? "1 file" : "\(G.count(recording.files)) files").font(G.small).foregroundStyle(G.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 8).fill(hovering ? G.hover : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .contextMenu {
            Button("Show in Finder") { state.reveal(recording.path) }
        }
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plainIso = ISO8601DateFormatter()
    private static let clock: DateFormatter = {
        let f = DateFormatter(); f.timeStyle = .short; f.dateStyle = .none; return f
    }()

    /// `2026-08-11T03:43:31.000Z` → `11:43 PM`, in this machine's zone.
    static func time(_ writtenAt: String) -> String {
        guard let d = iso.date(from: writtenAt) ?? plainIso.date(from: writtenAt) else { return "" }
        return clock.string(from: d)
    }
}
