// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit

/// The Raw section of Recording details: the signed proof, the thing that
/// travels, and nothing else.
///
/// ⚠️ JUST THE PROOF. It showed three things for a while on 2026-09-11: the
/// note the app writes beside a file (its filing card: name, digests,
/// position, a pointer to the proof) and the set's manifest, on top of the
/// proof. Mike: "explain to me what value there is in having this info. it
/// isnt a part of the portable proof" — and there was none for a reader. A
/// check runs from the proof, the manifest and the bytes and never reads the
/// note; the manifest is a file in the recording. Raw is the proof, as the
/// site's page is.
///
/// ⚠️ NOT A SWIFTUI TEXT, AND NOT ON THE MAIN THREAD. Mike, 2026-09-10, on a
/// 1,130-file recording: "i clicked recording details and got beach ball.
/// then first raw json data is blank". Pretty-printing ran on the main
/// thread on every pass over the page, and on opening, SwiftUI's Text laid
/// out hundreds of kilobytes of monospace in one go. Now the string is made
/// once, off the main thread, when the section first appears, and
/// NSTextView draws it: TextKit lays out only what is on screen.
struct RawSection: View {
    let proof: JSONValue?
    /// The file's own bytes, when the core had them: shown verbatim, its own
    /// key order, "version" first (Mike, 2026-09-12: "shouldnt it be this?").
    let raw: String?
    @State private var block: RawBlock? = nil

    var body: some View {
        Section("Raw") {
            if let block {
                RawTextBlock(block: block)
            } else {
                Text("Reading…")
                    .font(G.small).foregroundStyle(G.secondary)
                    .padding(.horizontal, 16).padding(.vertical, 12)
            }
        }
        .task {
            let proof = proof, raw = raw
            block = await Task.detached(priority: .userInitiated) { RawBlock.make(proof: proof, raw: raw) }.value
        }
    }
}

struct RawBlock: Identifiable {
    let id: String
    let label: String
    let text: String
    /// Counted once, here, not with `split` on every body pass.
    let lines: Int

    init(label: String, text: String) {
        id = label
        self.label = label
        self.text = text
        lines = text.utf8.reduce(0) { $0 + ($1 == 10 ? 1 : 0) } + 1
    }

    static func make(proof: JSONValue?, raw: String?) -> RawBlock {
        RawBlock(label: "The signed proof", text: raw?.trimmingCharacters(in: .newlines) ?? proof?.pretty ?? "{}")
    }
}

/// The text, verbatim, in a box that scrolls both ways: a proof is a few
/// hundred lines and a set manifest can be far more, and cutting either off
/// with no way down read as a broken document.
struct RawTextBlock: View {
    let block: RawBlock

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(block.label).font(G.small).foregroundStyle(G.secondary)
            RawTextView(text: block.text)
                .frame(height: min(CGFloat(block.lines) * 17 + 24, 440))
                .background(RoundedRectangle(cornerRadius: 8).fill(G.zone))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

/// An NSTextView, read-only and selectable, that lays out lazily.
struct RawTextView: NSViewRepresentable {
    let text: String

    func makeNSView(context: Context) -> NSScrollView {
        let view = NSTextView(usingTextLayoutManager: true)
        view.isEditable = false
        view.isSelectable = true
        view.drawsBackground = false
        view.font = NSFont.monospacedSystemFont(ofSize: 12.5, weight: .regular)
        view.textColor = NSColor(G.ink)
        view.textContainerInset = NSSize(width: 12, height: 12)
        /* No wrapping: the box scrolls sideways, as the SwiftUI one did. */
        view.isHorizontallyResizable = true
        view.isVerticallyResizable = true
        view.autoresizingMask = []
        view.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        view.textContainer?.widthTracksTextView = false
        view.textContainer?.size = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        view.string = text
        let scroll = NSScrollView()
        scroll.documentView = view
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        Self.rewind(scroll)
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        if let view = scroll.documentView as? NSTextView, view.string != text {
            view.string = text
            Self.rewind(scroll)
        }
    }

    /// The top, once the text has laid out. A box left where the layout put
    /// it opened part-way down a proof (Mike's screenshot, 2026-09-12).
    private static func rewind(_ scroll: NSScrollView) {
        DispatchQueue.main.async {
            scroll.contentView.scroll(to: .zero)
            scroll.reflectScrolledClipView(scroll.contentView)
        }
    }
}
