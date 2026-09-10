// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// The thing the page is about, before its paperwork.
///
/// ⚠️ THE SUBJECT LEADS. The site puts the photograph at the top of the record
/// card for a reason: the page certifies the picture, so you should see the
/// picture. The app has an advantage the browser never had, which is that the
/// file is right there on disk and always will be.
///
/// A file that is not a picture is drawn the way Finder draws it (a movie's
/// frame, a PDF's first page, a text file's first lines) and, when nothing
/// can be drawn, says what it is instead. It never says nothing.
///
/// ⚠️ THE FILE OPENS. Mike, 2026-09-10, on a movie shown as an icon: "you
/// should be able to 'open' and preview the actual file youre looking at".
/// A click opens it in its own app, the hard link inside the recording, so
/// the folder it came from is never touched. Finder's pattern: a frame to
/// look at, a click to play.
struct SubjectView: View {
    let path: String
    let name: String
    let bytes: Int

    @State private var image: NSImage?
    @State private var missing = false
    @State private var hovering = false

    var body: some View {
        Group {
            if let image {
                /* A margin inside the card and soft corners: flush to the edge
                 * read as a mistake (Mike, 2026-09-09). */
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: 380)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay { if isMovie { playBadge } }
                    .overlay(alignment: .bottomTrailing) { if hovering && !isMovie { openLabel.padding(12) } }
                    .padding(16)
                    .frame(maxWidth: .infinity)
                    .background(hovering ? G.hover : Color(white: 0.98))
            } else {
                fileCard
            }
        }
        .contentShape(Rectangle())
        /* The hand, the tint and a label: a card that opens has to say so
         * before the click (Mike, 2026-09-10: "not obvious enough"). The
         * Open pill in the page bar says it without hovering at all. */
        .onHover { inside in
            hovering = inside && !missing
            if hovering { NSCursor.pointingHand.push() } else { NSCursor.pop() }
        }
        .onTapGesture { open() }
        .help(missing ? "" : "Open")
        .task(id: path) { await load() }
    }

    /// A movie's frame is a picture until something says it plays.
    private var playBadge: some View {
        Image(systemName: "play.fill")
            .font(.system(size: 22, weight: .bold))
            .foregroundStyle(.white)
            .padding(18)
            .background(Circle().fill(Color.black.opacity(0.55)))
            .allowsHitTesting(false)
    }

    /// "Open", with the outward arrow, at the corner of a picture under the
    /// pointer. A movie has its play badge instead.
    private var openLabel: some View {
        HStack(spacing: 5) {
            Image(systemName: "arrow.up.forward.square").font(.system(size: 12, weight: .semibold))
            Text("Open").font(Style.small.weight(.semibold))
        }
        .foregroundStyle(G.blue)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 6).fill(.white))
        .allowsHitTesting(false)
    }

    /// What a file nothing can draw, or a file that has moved, gets instead.
    private var fileCard: some View {
        HStack(spacing: 12) {
            Image(nsImage: NSWorkspace.shared.icon(forFile: path))
                .resizable()
                .frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 3) {
                Text(name)
                    .font(Style.fieldLabel)
                    .foregroundStyle(Style.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(missing
                     ? "Not on this machine at this path any more. The BitGraph is still here."
                     : "\(Style.bytes(bytes))\(kind.map { " · \($0)" } ?? "")")
                    .font(Style.small)
                    .foregroundStyle(Style.quiet)
            }
            Spacer()
            if hovering { openLabel }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(hovering ? G.hover : Color.clear)
    }

    private var type: UTType? { UTType(filenameExtension: (name as NSString).pathExtension) }
    private var kind: String? { type?.localizedDescription }
    private var isMovie: Bool { type?.conforms(to: .movie) ?? false }

    /// The file, in the app the Mac would open it with. Never the origin: the
    /// path is the recording's own hard link.
    private func open() {
        guard !missing else { return }
        AppState.openFile(path)
    }

    /// ⚠️ Read off the main thread and downscaled. A 60 MP raw decoded at full
    /// size on the main thread stalls the window for as long as it takes.
    /// A picture is read by ImageIO; anything else goes to Quick Look, the same
    /// path the tiles take, at the card's size.
    private func load() async {
        image = nil
        missing = !FileManager.default.fileExists(atPath: path)
        guard !missing else { return }
        let url = URL(fileURLWithPath: path)
        let loaded: NSImage? = await Task.detached(priority: .userInitiated) {
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  CGImageSourceGetCount(source) > 0 else { return nil }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1400,
            ]
            guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
            return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        }.value
        if let loaded { image = loaded; return }
        image = await Thumbnails.quickLook(path: path, side: 700)
    }
}
