// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import XCTest
import SwiftUI
import AppKit
@testable import BitGraphRecorder

/// What the surface COSTS, measured, because a drop that the core answers in
/// 1.2s was taking fifteen seconds to appear.
@MainActor
final class RenderCostTests: XCTestCase {

    private func look(_ rows: Int, total: Int) -> LookResult {
        LookResult(
            root: "/Users/mike/Desktop/BitGraph speed 30k",
            files: (0..<rows).map { i in
                Looked(path: "/r/roll-00/frame-\(i).txt", name: "frame-\(i).txt", rel: "roll-\(i / 2500)/frame-\(String(format: "%05d", i)).txt",
                       bytes: 180, originDigestB64: "AA", placement: "container/2", position: nil, evidencePath: nil)
            },
            total: total, recorded: 0, truncated: rows < total
        )
    }

    func testDecodingTheAnswerIsCheap() throws {
        let answer = DropAnswer(action: "ready", root: "/r", look: look(500, total: 30_000), token: "t", made: nil, skipped: nil, opened: nil)
        let data = try JSONEncoder().encode(EncodableLook(look: answer.look))
        let t = Date()
        for _ in 0..<10 { _ = try JSONDecoder().decode(EncodableLook.self, from: data) }
        let ms = Date().timeIntervalSince(t) * 100
        XCTAssertLessThan(ms, 60, "decoding 500 rows took \(ms)ms each")
    }

    /// ⚠️ THE ONE THAT MATTERS. Laying the list out is what somebody waits for.
    func testLayingOutTheListIsFast() throws {
        for rows in [50, 200, 500] {
            let view = BatchDialog(state: AppState(preview: nil), look: look(rows, total: 30_000))
            let t = Date()
            let hosting = NSHostingView(rootView: view.environment(\.colorScheme, .light))
            hosting.frame = NSRect(x: 0, y: 0, width: 640, height: 720)
            hosting.layoutSubtreeIfNeeded()
            let rep = try XCTUnwrap(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
            hosting.cacheDisplay(in: hosting.bounds, to: rep)
            let seconds = Date().timeIntervalSince(t)
            print("  \(rows) rows: \(String(format: "%.2f", seconds))s")
            XCTAssertLessThan(seconds, 1.5, "\(rows) rows took \(seconds)s to lay out and draw")
        }
    }

    private struct EncodableLook: Codable {
        var look: LookResult
    }
}

extension LookResult: Encodable {
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(root, forKey: .root)
        try c.encode(files, forKey: .files)
        try c.encode(total, forKey: .total)
        try c.encode(recorded, forKey: .recorded)
        try c.encode(truncated, forKey: .truncated)
    }
    private enum CodingKeys: String, CodingKey { case root, files, total, recorded, truncated }
}

extension Looked: Encodable {
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(path, forKey: .path)
        try c.encode(name, forKey: .name)
        try c.encode(rel, forKey: .rel)
        try c.encode(bytes, forKey: .bytes)
        try c.encode(originDigestB64, forKey: .originDigestB64)
        try c.encode(placement, forKey: .placement)
        try c.encodeIfPresent(position, forKey: .position)
        try c.encodeIfPresent(evidencePath, forKey: .evidencePath)
    }
    private enum CodingKeys: String, CodingKey { case path, name, rel, bytes, originDigestB64, placement, position, evidencePath }
}

extension Position: Encodable {
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(epochId, forKey: .epochId)
        try c.encode(counter, forKey: .counter)
    }
    private enum CodingKeys: String, CodingKey { case epochId, counter }
}

/// The Raw section on a big recording (Mike, 2026-09-10: "i clicked recording
/// details and got beach ball. then first raw json data is blank"). A
/// 1,130-file recording's signed proof is ~435 KB; the box must lay out in
/// well under a second, and a folded card must not build its content.
@MainActor
final class RawCostTests: XCTestCase {

    private func bigJSON() -> String {
        var lines: [String] = ["{", "  \"members\": ["]
        for i in 0..<3_000 {
            lines.append("    {\"rel\": \"imran emails/\(i).eml\", \"digestB64\": \"AQNsYGOpMBya5pf2VyVv6wjcVOTcTapF0c_YG6Ko7zfmFWf8o4LCxvOGvgF9gUKtSQSNWUE0Tpi9hlRUVtI703QBMGXIDKxL8GdYc8\", \"bytes\": \(i * 7)},")
        }
        lines.append("  ]"); lines.append("}")
        return lines.joined(separator: "\n")
    }

    private func draw<V: View>(_ view: V) throws -> TimeInterval {
        let t = Date()
        let hosting = NSHostingView(rootView: view.environment(\.colorScheme, .light))
        hosting.frame = NSRect(x: 0, y: 0, width: 900, height: 600)
        hosting.layoutSubtreeIfNeeded()
        let rep = try XCTUnwrap(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
        hosting.cacheDisplay(in: hosting.bounds, to: rep)
        return Date().timeIntervalSince(t)
    }

    func testAHalfMegabyteRawBlockDrawsFast() throws {
        let text = bigJSON()
        print("  raw text: \(text.utf8.count / 1024) KB, \(text.split(separator: "\n").count) lines")
        /* For the record, measured once (2026-09-10) with the old box, a
         * SwiftUI Text in a ScrollView: 1 MB / 6,004 lines took 62.12 s to
         * lay out and draw; RawTextBlock took 0.61 s. Not kept in the suite
         * because a minute per run is the bug, not a test of it. */
        let block = RawBlock(label: "The signed proof", text: text)
        let new = try draw(RawTextBlock(block: block))
        print("  RawTextBlock: \(String(format: "%.2f", new))s")
        XCTAssertLessThan(new, 1.5, "the Raw box took \(new)s to lay out and draw")
        XCTAssertEqual(block.lines, 3_004)
    }

    func testAFoldedCardBuildsNothing() throws {
        var built = 0
        let card = Card(title: "Recording details") { () -> Text in built += 1; return Text("heavy") }
        _ = try draw(card)
        XCTAssertEqual(built, 0, "a folded card built its content")
    }
}
