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
/// A file that is not an image says what it is instead. It never says nothing.
struct SubjectView: View {
    let path: String
    let name: String
    let bytes: Int

    @State private var image: NSImage?
    @State private var missing = false

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
                    .padding(16)
                    .frame(maxWidth: .infinity)
                    .background(Color(white: 0.98))
            } else {
                fileCard
            }
        }
        .task(id: path) { await load() }
    }

    /// What a non-image, or a file that has moved, gets instead.
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
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private var kind: String? {
        UTType(filenameExtension: (name as NSString).pathExtension)?.localizedDescription
    }

    /// ⚠️ Read off the main thread and downscaled. A 60 MP raw decoded at full
    /// size on the main thread stalls the window for as long as it takes.
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
        image = loaded
    }
}
