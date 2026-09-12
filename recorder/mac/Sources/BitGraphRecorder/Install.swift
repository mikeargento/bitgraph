// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import AppKit
import CryptoKit
import Foundation

/// An update, installed: fetched, checked, handed to macOS Installer.
///
/// ⚠️ THE APP RUNS NOTHING IT DOWNLOADS. The feed names a version, an https
/// URL and the package's SHA-256 (mac/release.sh writes all three from the
/// artifact it just notarized). The package is downloaded, hashed, and thrown
/// away unless the hash is the feed's; the one that matches is opened with
/// Installer, which is the thing that runs it, behind Gatekeeper's own check
/// of the signature and notarization. A feed with no checksum installs
/// nothing: the popover's row still says a version exists, and that is all.
extension AppState {
    func install(_ check: UpdateCheck) {
        guard !installing else { return }
        installing = true
        say("Downloading BitGraph Recorder \(check.latest)…")
        Task { [weak self] in
            defer { self?.installing = false }
            do {
                let pkg = try await Self.fetchVerified(check)
                self?.say("BitGraph Recorder \(check.latest) matches its checksum. The installer is open.")
                NSWorkspace.shared.open(pkg)
            } catch {
                self?.note(root: "", reason: "the update could not be installed: \(error.localizedDescription)", severity: .gap)
            }
        }
    }

    struct InstallFailure: LocalizedError {
        let errorDescription: String?
        init(_ why: String) { errorDescription = why }
    }

    /// The package, on disk, with the feed's checksum: or nothing.
    static func fetchVerified(_ check: UpdateCheck) async throws -> URL {
        guard let url = URL(string: check.url), url.scheme == "https" else {
            throw InstallFailure("the feed's download is not an https URL.")
        }
        guard check.sha256.count == 64 else {
            throw InstallFailure("the feed carries no checksum, so nothing is installed from it.")
        }
        let (tmp, response) = try await URLSession.shared.download(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            try? FileManager.default.removeItem(at: tmp)
            throw InstallFailure("the download answered \((response as? HTTPURLResponse)?.statusCode ?? 0).")
        }
        let digest = try sha256Hex(of: tmp)
        guard digest == check.sha256.lowercased() else {
            try? FileManager.default.removeItem(at: tmp)
            throw InstallFailure("the download does not match the feed's checksum; it was thrown away.")
        }
        /* The app's own cache folder: no prompt for Downloads, and the file
         * outlives the temp directory long enough for Installer to read it. */
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ing.bitgraph.recorder", isDirectory: true)
        try FileManager.default.createDirectory(at: caches, withIntermediateDirectories: true)
        let dest = caches.appendingPathComponent("BitGraph-Recorder-\(check.latest).pkg")
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    /// SHA-256 of a file, streamed: the package is a hundred megabytes.
    static func sha256Hex(of file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = try handle.read(upToCount: 1 << 20) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
