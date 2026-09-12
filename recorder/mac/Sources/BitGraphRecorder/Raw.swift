// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit

/// The Raw section of Recording details: every byte this BitGraph rests on.
///
/// ⚠️ NOT A SWIFTUI TEXT, AND NOT ON THE MAIN THREAD. Mike, 2026-09-10, on a
/// 1,130-file recording: "i clicked recording details and got beach ball.
/// then first raw json data is blank". The signed proof was 435 KB and the
/// committed manifest 278 KB. Pretty-printing both ran on the main thread on
/// every pass over the page (the Card built its content eagerly, even
/// folded), and on opening, SwiftUI's Text laid out seven hundred kilobytes
/// of monospace in one go. The blank box was that layout, still running.
///
/// Now the strings are made once, off the main thread, when the section
/// first appears, and NSTextView draws them: TextKit lays out only what is
/// on screen, however long the document. Full disclosure stays: nothing is
/// cut, folded or summarised.
struct RawSection: View {
    let proof: JSONValue?
    let committedB64: String?
    let evidenceRaw: String?

    @State private var blocks: [RawBlock]? = nil

    var body: some View {
        Section("Raw") {
            if let blocks {
                ForEach(blocks) { RawTextBlock(block: $0) }
            } else {
                Text("Reading…")
                    .font(G.small).foregroundStyle(G.secondary)
                    .padding(.horizontal, 16).padding(.vertical, 12)
            }
        }
        .task(id: committedB64?.count ?? 0) {
            let proof = proof, committedB64 = committedB64, evidenceRaw = evidenceRaw
            blocks = await Task.detached(priority: .userInitiated) {
                RawBlock.make(proof: proof, committedB64: committedB64, evidenceRaw: evidenceRaw)
            }.value
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

    static func make(proof: JSONValue?, committedB64: String?, evidenceRaw: String?) -> [RawBlock] {
        /* ⚠️ ONE COPY OF THE PROOF, AND NEVER NONE. Evidence written beside a
         * file comes in two kinds. INLINE carries the signed proof inside it,
         * so that one block is the proof too. BESIDE points at the recording's
         * proof.json instead ("proof": "./proof.json"), which is how every
         * member of a set shares one proof; then the proof has to be its own
         * block or the page shows no proof at all (Mike, 2026-09-11: "i
         * honestly dont understand this", under an evidence block that only
         * pointed at it). Nothing is cut. */
        var out: [RawBlock] = []
        let evidence = evidenceRaw.flatMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) }
        let kind = evidence?["proof"]?["kind"]?.string
        if let raw = evidenceRaw, kind == "inline" {
            out.append(RawBlock(label: "Written beside this file: its digests, its position, and the signed proof", text: raw))
        } else {
            if let raw = evidenceRaw {
                out.append(RawBlock(label: "Written beside this file: its digests, its position, and where its proof is", text: raw))
            }
            let shared = evidence?["member"] != nil && evidence?["member"]?.isPresent == true
            out.append(RawBlock(label: shared ? "The signed proof, one for every file in this set" : "The signed proof", text: proof?.pretty ?? "{}"))
        }
        /* A set proof commits to a manifest or a Merkle root; the signed proof
         * alone leaves out the artifact it hashes to and this file's own
         * inclusion path. Pretty-printed for reading: the bytes the hash
         * covers are manifest.json in the recording, exactly as written. */
        if let b64 = committedB64, let data = Data(base64Encoded: b64), let text = String(data: data, encoding: .utf8) {
            let shown = (try? JSONDecoder().decode(JSONValue.self, from: data))?.pretty ?? text
            out.append(RawBlock(label: "The set's manifest, whose hash is the proof's. Laid out for reading; the hashed bytes are manifest.json in the recording", text: shown))
        }
        return out
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
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        if let view = scroll.documentView as? NSTextView, view.string != text { view.string = text }
    }
}
