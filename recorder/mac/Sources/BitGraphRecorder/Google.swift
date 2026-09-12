// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit

/// The look, taken from two screens Mike handed over on 2026-09-09: Google
/// Calendar (the sidebar, the mini month, the create pill, the rounded dialog
/// with its underlined title field and its Save pill) and Google Images (the
/// card with a dashed drop zone, an OR rule, and a row of pills).
///
/// ⚠️ SHAPES AND SPACING ARE GOOGLE'S. THE BLUE IS OURS. Everything is
/// rounded the way theirs is: pills fully, dialogs 28pt, cards 24pt, the drop
/// zone 12pt, today a circle. The one thing that does not change hands is
/// #0065A4, which is what BitGraph is drawn in everywhere else.
enum G {
    // ── colour ──────────────────────────────────────────────────────────────
    static let blue = Color(red: 0.0, green: 0.396, blue: 0.643)            // #0065A4
    static let blueDeep = Color(red: 0.0, green: 0.294, blue: 0.478)        // #004b7a
    static let blueTonal = Color(red: 0.0, green: 0.396, blue: 0.643).opacity(0.13)
    static let ink = Color(red: 0.122, green: 0.122, blue: 0.122)           // #1f1f1f
    static let secondary = Color(red: 0.373, green: 0.400, blue: 0.408)     // #5f6368
    static let border = Color(red: 0.855, green: 0.863, blue: 0.878)        // #dadce0
    static let dash = Color(red: 0.769, green: 0.780, blue: 0.773)          // #c4c7c5
    static let hover = Color(red: 0.945, green: 0.953, blue: 0.957)         // #f1f3f4
    static let pressed = Color(red: 0.878, green: 0.886, blue: 0.898)       // #e0e2e5
    static let ground = Color.white
    static let dialog = Color(red: 0.941, green: 0.957, blue: 0.976)        // #f0f4f9
    static let zone = Color(red: 0.973, green: 0.976, blue: 0.980)          // #f8f9fa
    static let red = Color(red: 0.702, green: 0.153, blue: 0.106)

    // ── radii ───────────────────────────────────────────────────────────────
    static let dialogRadius: CGFloat = 28
    static let cardRadius: CGFloat = 24
    static let zoneRadius: CGFloat = 12
    static let fieldRadius: CGFloat = 8

    // ── type ────────────────────────────────────────────────────────────────
    static let display = Font.system(size: 28, weight: .regular)
    static let title = Font.system(size: 22, weight: .regular)
    static let cardTitle = Font.system(size: 18, weight: .regular)
    static let body = Font.system(size: 14)
    static let label = Font.system(size: 14, weight: .medium)
    static let small = Font.system(size: 12)
    static let tiny = Font.system(size: 10, weight: .medium)
    static let data = Font.system(size: 12.5, design: .monospaced)

    static func count(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }
}

// ── pills ──────────────────────────────────────────────────────────────────

/// The Save pill, the Search pill, the "Add time" pill: one shape, three fills.
struct Pill: View {
    enum Style { case filled, outlined, text, tonal }

    let title: String
    var style: Style = .outlined
    var icon: String? = nil
    var enabled: Bool = true
    var large: Bool = false
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Image(systemName: icon).font(.system(size: large ? 16 : 13, weight: .medium)) }
                Text(title)
            }
            .font(large ? Font.system(size: 15, weight: .medium) : G.label)
            .foregroundStyle(foreground)
            .padding(.horizontal, style == .text ? 12 : (large ? 24 : 20))
            .frame(height: large ? 48 : 40)
            .background(Capsule().fill(fill))
            .overlay(Capsule().strokeBorder(style == .outlined ? G.border : .clear, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .onHover { hovering = $0 && enabled }
    }

    private var foreground: Color {
        if !enabled { return G.secondary.opacity(0.6) }
        return style == .filled ? .white : G.blue
    }

    private var fill: Color {
        guard enabled else { return style == .filled ? G.border : .clear }
        switch style {
        case .filled: return hovering ? G.blueDeep : G.blue
        case .tonal: return hovering ? G.blue.opacity(0.2) : G.blueTonal
        case .outlined, .text: return hovering ? G.blue.opacity(0.08) : .clear
        }
    }
}

/// An icon in a circle that fills on hover and darkens on press, the way
/// every icon button in Calendar does. Mike, 2026-09-09: "the plus sign isnt
/// responsive. its hard to tell if youre over it or clicked it."
struct IconButton: View {
    let systemName: String
    var size: CGFloat = 36
    var pointSize: CGFloat = 14
    var weight: Font.Weight = .semibold
    var color: Color = G.secondary
    let action: () -> Void

    @State private var hovering = false

    init(_ systemName: String, size: CGFloat = 36, pointSize: CGFloat = 14, weight: Font.Weight = .semibold, color: Color = G.secondary, action: @escaping () -> Void) {
        self.systemName = systemName
        self.size = size
        self.pointSize = pointSize
        self.weight = weight
        self.color = color
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: pointSize, weight: weight))
                .foregroundStyle(hovering ? G.ink : color)
        }
        .buttonStyle(IconButtonStyle(hovering: hovering, size: size))
        .onHover { hovering = $0 }
    }
}

private struct IconButtonStyle: ButtonStyle {
    let hovering: Bool
    let size: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: size, height: size)
            .background(Circle().fill(configuration.isPressed ? G.pressed : (hovering ? G.hover : .clear)))
            .contentShape(Circle())
    }
}

/// Google Calendar's Create: a pill with a shadow, a plus, and a caret that
/// opens a menu. Blue, on Mike's word (2026-09-09: "make is white on white.
/// maybe needs a blue background").
///
/// ⚠️ NOTHING HERE IS APPKIT'S. A SwiftUI `Menu` draws its label in the
/// system appearance, and an `NSMenu` popped under it drew its items the same
/// way: on a Mac in dark mode both came out white on white. The pill is a
/// plain button. It used to open a menu of two; the drop decides now, so it
/// does the one thing.
struct CreatePill: View {
    let title: String
    /// Google's is 56 tall and as wide as its word. In the header it is 44,
    /// and wider than its word so it reads as a place ("new button needs to
    /// be wider", Mike, 2026-09-11).
    var height: CGFloat = 56
    var width: CGFloat? = nil
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        /* No caret: it opened a menu of two, and the drop now decides what
         * the second one asked. The pill does the one thing. */
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "plus").font(.system(size: 18, weight: .medium))
                Text(title).font(Font.system(size: 15, weight: .medium))
            }
            .foregroundStyle(.white)
            .padding(.leading, 18)
            .padding(.trailing, 20)
            .frame(width: width, height: height)
            /* ⚠️ THE SHADOW IS THE CAPSULE'S, NOT THE LABEL'S. A shadow after
             * the background falls on the text too and blurs it ("your
             * shadowing is doing something funny on the text", Mike,
             * 2026-09-09). */
            .background(
                Capsule().fill(hovering ? G.blueDeep : G.blue)
                    .shadow(color: .black.opacity(0.28), radius: 1.5, y: 1)
                    .shadow(color: .black.opacity(0.14), radius: 6, y: 4)
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// "My calendars": a coloured, rounded checkbox with a label.
struct CheckRow: View {
    let label: String
    let color: Color
    var checked: Bool
    var note: String? = nil
    let toggle: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 4).fill(checked ? color : .clear).frame(width: 18, height: 18)
                    RoundedRectangle(cornerRadius: 4).strokeBorder(checked ? color : G.secondary, lineWidth: 2).frame(width: 18, height: 18)
                    if checked { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white) }
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(G.body).foregroundStyle(G.ink).lineLimit(1).truncationMode(.middle)
                    if let note { Text(note).font(G.small).foregroundStyle(G.secondary).lineLimit(1) }
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 20).fill(hovering ? G.hover : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// Google Calendar's colour set for calendars, used for synced folders.
enum FolderColors {
    static let all: [Color] = [
        Color(red: 0.204, green: 0.659, blue: 0.325),   // green
        Color(red: 0.482, green: 0.412, blue: 0.867),   // lavender
        Color(red: 0.851, green: 0.188, blue: 0.145),   // tomato
        Color(red: 0.557, green: 0.141, blue: 0.667),   // grape
        Color(red: 0.259, green: 0.522, blue: 0.957),   // blueberry
        Color(red: 0.965, green: 0.596, blue: 0.0),     // tangerine
    ]
    static func color(_ i: Int) -> Color { all[i % all.count] }
}

// ── the dialog ─────────────────────────────────────────────────────────────

/// Calendar's create dialog: 28pt corners, the pale blue ground, a close
/// mark top right, and a grip at the top left.
struct DialogCard<Content: View>: View {
    var close: (() -> Void)? = nil
    @ViewBuilder var content: Content

    var body: some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 0) { content }
                .padding(.horizontal, 30)
                .padding(.top, 24)
                .padding(.bottom, 24)
            if let close {
                IconButton("xmark", size: 40, pointSize: 15, weight: .medium, color: G.ink, action: close)
                    .padding(10)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: G.dialogRadius).fill(G.dialog)
                .shadow(color: .black.opacity(0.18), radius: 22, y: 10)
                .shadow(color: .black.opacity(0.08), radius: 3, y: 1)
        )
    }
}

/// The dialog's title field: big, plain, with a blue rule under it.
struct TitleField: View {
    let placeholder: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(G.display)
                .foregroundStyle(G.ink)
                .padding(.bottom, 8)
            Rectangle().fill(G.blue).frame(height: 2)
        }
    }
}

/// An icon-led row inside the dialog: "Add guests", "Add location".
struct DialogRow<Content: View>: View {
    let icon: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(G.secondary)
                .frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 3) { content }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
    }
}

// ── search ────────────────────────────────────────────────────────────────

/// Calendar's search: a rounded field with a glass in it, on the sidebar
/// under the mini month, where the space was empty. Typing into it turns the
/// month's days into what was found; clearing it turns them back.
struct SearchField: View {
    let placeholder: String
    @Binding var text: String
    /// Set by ⌘F to take the caret; cleared once it has.
    @Binding var focus: Bool
    @FocusState private var focused: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(G.secondary)
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(G.body)
                .foregroundStyle(G.ink)
                .focused($focused)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(G.secondary)
                }
                .buttonStyle(.plain)
                .help("Clear")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(RoundedRectangle(cornerRadius: G.fieldRadius).fill(focused || hovering ? Color.white : G.zone))
        .overlay(RoundedRectangle(cornerRadius: G.fieldRadius).strokeBorder(focused ? G.blue : G.border, lineWidth: 1))
        .onHover { hovering = $0 }
        .onChange(of: focus) { _, wanted in
            if wanted { focused = true; focus = false }
        }
    }
}

// ── the mini month ─────────────────────────────────────────────────────────

/// Google Calendar's little month: the name and two chevrons, S M T W T F S,
/// six rows of seven, today a filled square (Mike's word: days are squares),
/// the days with something in them marked with a dot.
struct MiniMonth: View {
    @Binding var month: Date
    @Binding var selected: String?
    /// `yyyy-MM-dd` for every day that holds a recording.
    let marked: Set<String>

    private let cal = Calendar.current
    private let key: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(monthTitle).font(G.label).foregroundStyle(G.ink)
                Spacer()
                IconButton("chevron.left", size: 28, pointSize: 12) { step(-1) }
                IconButton("chevron.right", size: 28, pointSize: 12) { step(1) }
            }
            .padding(.leading, 8)
            .padding(.bottom, 4)

            let columns = Array(repeating: GridItem(.fixed(30), spacing: 2), count: 7)
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(["S", "M", "T", "W", "T", "F", "S"].indices, id: \.self) { i in
                    Text(["S", "M", "T", "W", "T", "F", "S"][i]).font(G.tiny).foregroundStyle(G.secondary).frame(height: 22)
                }
                ForEach(cells, id: \.self) { day in
                    dayCell(day)
                }
            }
        }
    }

    private var monthTitle: String {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"; return f.string(from: month)
    }

    private func step(_ n: Int) {
        month = cal.date(byAdding: .month, value: n, to: month) ?? month
    }

    /// Forty-two days starting at the Sunday on or before the first.
    private var cells: [Date] {
        let comps = cal.dateComponents([.year, .month], from: month)
        guard let first = cal.date(from: comps) else { return [] }
        let weekday = cal.component(.weekday, from: first)
        guard let start = cal.date(byAdding: .day, value: -(weekday - 1), to: first) else { return [] }
        return (0..<42).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
    }

    private func dayCell(_ day: Date) -> some View {
        let k = key.string(from: day)
        let inMonth = cal.isDate(day, equalTo: month, toGranularity: .month)
        let isToday = cal.isDateInToday(day)
        let isSelected = selected == k
        let has = marked.contains(k)
        return Button {
            selected = isSelected ? nil : k
        } label: {
            VStack(spacing: 1) {
                Text("\(cal.component(.day, from: day))")
                    .font(Font.system(size: 12, weight: isToday ? .semibold : .regular))
                    .foregroundStyle(isToday ? .white : (inMonth ? G.ink : G.secondary.opacity(0.6)))
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 6).fill(isToday ? G.blue : (isSelected ? G.blueTonal : .clear)))
                Circle().fill(has ? G.blue : .clear).frame(width: 4, height: 4)
            }
            .frame(width: 30, height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Calendar's snackbar: a dark bar at the bottom-left that says one thing and
/// goes away. Clicking it puts it away sooner.
struct Snackbar: View {
    let text: String
    /// An action beside OK, Calendar-style ("Undo"): the label and what it does.
    var action: (String, () -> Void)? = nil
    let dismiss: () -> Void

    var body: some View {
        Button(action: dismiss) {
            HStack(spacing: 16) {
                Text(text)
                    .font(G.body)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                if let action {
                    Button(action: action.1) {
                        Text(action.0).font(G.label).foregroundStyle(Color(red: 0.66, green: 0.80, blue: 1.0))
                    }
                    .buttonStyle(.plain)
                }
                Text("OK").font(G.label).foregroundStyle(Color(red: 0.66, green: 0.80, blue: 1.0))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: 560, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8).fill(Color(red: 0.196, green: 0.196, blue: 0.196))
                    .shadow(color: .black.opacity(0.3), radius: 8, y: 3)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
