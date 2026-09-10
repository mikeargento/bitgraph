// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit
import ImageIO
import QuickLookThumbnailing

/// Small pictures of files, made lazily and kept.
///
/// ⚠️ DOWNSAMPLED AT THE SOURCE, NEVER THE WHOLE FILE. A 470-photograph
/// recording is 470 × 8 MB; decoding each in full to draw a 120pt tile would
/// take the app down. `CGImageSource` reads only what a thumbnail needs.
/// Anything that is not a picture goes to QuickLook, which draws a PDF's
/// first page, a text file's first lines, a frame of a video: the pictures
/// Finder shows ("distinguishes pdfs from text files etc", Mike, 2026-09-09).
/// Only when nothing can be drawn does a file get its icon.
actor Thumbnails {
    static let shared = Thumbnails()

    private let cache = NSCache<NSString, NSImage>()
    private var inFlight: [String: Task<NSImage?, Never>] = [:]

    init() {
        cache.countLimit = 2_000
    }

    func image(for path: String, side: CGFloat) -> Task<NSImage?, Never> {
        let key = "\(path)@\(Int(side))" as NSString
        if let hit = cache.object(forKey: key) { return Task { hit } }
        if let running = inFlight[path] { return running }
        let task = Task<NSImage?, Never> {
            let made = await Task.detached(priority: .utility) { await Thumbnails.make(path: path, side: side) }.value
            if let made { self.cache.setObject(made, forKey: key) }
            self.inFlight[path] = nil
            return made
        }
        inFlight[path] = task
        return task
    }

    nonisolated static func make(path: String, side: CGFloat) async -> NSImage? {
        if let picture = downsampled(path: path, side: side) { return picture }
        return await quickLook(path: path, side: side)
    }

    /// A picture, read at thumbnail size.
    nonisolated static func downsampled(path: String, side: CGFloat) -> NSImage? {
        let url = URL(fileURLWithPath: path)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(source) > 0 else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(side * 2),
            kCGImageSourceShouldCache: false,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }

    /// Anything else, drawn the way Finder would draw it.
    nonisolated static func quickLook(path: String, side: CGFloat) async -> NSImage? {
        let request = QLThumbnailGenerator.Request(fileAt: URL(fileURLWithPath: path), size: CGSize(width: side, height: side), scale: 2, representationTypes: .thumbnail)
        return await withCheckedContinuation { continuation in
            QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { representation, _ in
                continuation.resume(returning: representation?.nsImage)
            }
        }
    }
}

/// One file as a tile: its picture or its icon, its name under it.
struct FileTile: View {
    let path: String
    let name: String
    let bytes: Int
    var current: Bool = false
    let action: () -> Void

    @State private var image: NSImage?
    @State private var hovering = false

    /// "JPG", "PDF", "TXT": the kind, at a glance.
    private var kind: String { (name as NSString).pathExtension.uppercased() }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6).fill(G.zone)
                    if let image {
                        Image(nsImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 120, height: 120)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    } else {
                        Image(nsImage: NSWorkspace.shared.icon(forFile: path))
                            .resizable()
                            .frame(width: 44, height: 44)
                    }
                }
                .frame(width: 120, height: 120)
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(current ? G.blue : (hovering ? G.border : .clear), lineWidth: current ? 2 : 1))
                Text(name)
                    .font(G.small)
                    .foregroundStyle(current ? G.blue : G.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(width: 120)
                Text(kind.isEmpty ? Style.bytes(bytes) : "\(Style.bytes(bytes)) · \(kind)")
                    .font(G.tiny)
                    .foregroundStyle(G.secondary)
            }
            .padding(6)
            .background(RoundedRectangle(cornerRadius: 8).fill(hovering ? G.hover : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(current ? "" : "Open this file's page")
        .task(id: path) {
            image = await Thumbnails.shared.image(for: path, side: 120).value
        }
    }
}
