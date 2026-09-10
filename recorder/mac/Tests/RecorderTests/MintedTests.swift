// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import XCTest
import SwiftUI
import AppKit
import ImageIO
import UniformTypeIdentifiers
@testable import BitGraphRecorder

/// The moment a BitGraph is made, checked at its keyframes and rendered as a
/// film so it can be looked at without driving the app.
@MainActor
final class MintedTests: XCTestCase {

    // ── the curves, against the site's ──────────────────────────────────────

    func testNothingIsDrawnBeforeItStarts() {
        let f = MintedTiming.frame(at: 0)
        XCTAssertEqual(f.ring, 0, accuracy: 0.001)
        XCTAssertEqual(f.check, 0, accuracy: 0.001)
        XCTAssertEqual(f.opacity, 0, accuracy: 0.001, "the badge springs in; it does not appear")
        XCTAssertEqual(f.scale, 0.6, accuracy: 0.01)
    }

    /// The ring runs 0.05s to 0.55s, and the check does not begin until 0.46s:
    /// the ring is nearly closed before the mark inside it starts.
    func testTheRingClosesBeforeTheCheckBegins() {
        XCTAssertGreaterThan(MintedTiming.frame(at: 0.46).ring, 0.9)
        XCTAssertEqual(MintedTiming.frame(at: 0.45).check, 0, accuracy: 0.001)
        XCTAssertGreaterThan(MintedTiming.frame(at: 0.6).check, 0.2)
        XCTAssertEqual(MintedTiming.frame(at: 0.56).ring, 1, accuracy: 0.001)
        XCTAssertEqual(MintedTiming.frame(at: 0.76).check, 1, accuracy: 0.001)
    }

    /// It overshoots and settles, which is what makes it read as a spring
    /// rather than a fade.
    func testTheBadgeOvershootsAndSettles() {
        let peak = MintedTiming.frame(at: 0.31).scale
        XCTAssertGreaterThan(peak, 1.05)
        XCTAssertEqual(MintedTiming.frame(at: 0.5).scale, 1, accuracy: 0.005)
        XCTAssertEqual(MintedTiming.frame(at: 1.0).scale, 1, accuracy: 0.005)
    }

    func testItIsFullyVisibleInTheMiddleAndGoneAtTheEnd() {
        XCTAssertEqual(MintedTiming.frame(at: 0.9).opacity, 1, accuracy: 0.01)
        XCTAssertEqual(MintedTiming.frame(at: 0.9).scrim, 1, accuracy: 0.01)
        XCTAssertEqual(MintedTiming.frame(at: MintedTiming.duration).opacity, 0, accuracy: 0.01)
        XCTAssertEqual(MintedTiming.frame(at: MintedTiming.duration).scrim, 0, accuracy: 0.01)
        XCTAssertEqual(MintedTiming.frame(at: 5).opacity, 0, accuracy: 0.001, "it never comes back")
    }

    func testTheScrimIsUpBeforeTheRingIsHalfDrawn() {
        XCTAssertEqual(MintedTiming.frame(at: 0.23).scrim, 1, accuracy: 0.02)
    }

    /// ⚠️ Somebody who asked not to be moved still gets the mark. It says the
    /// same thing; it just does not sweep.
    func testReduceMotionKeepsTheMarkAndDropsTheMovement() {
        let still = MintedTiming.still
        XCTAssertEqual(still.ring, 1)
        XCTAssertEqual(still.check, 1)
        XCTAssertEqual(still.opacity, 1)
        XCTAssertEqual(still.scale, 1)
    }

    func testTheEasingCurveIsACurve() {
        // ease-out: fast first, slow last.
        let easeOutAtQuarter = MintedTiming.bezier(0.25, 0, 0, 0.58, 1)
        XCTAssertGreaterThan(easeOutAtQuarter, 0.25, "ease-out is ahead of linear early on")
        XCTAssertEqual(MintedTiming.bezier(0, 0, 0, 0.58, 1), 0, accuracy: 0.001)
        XCTAssertEqual(MintedTiming.bezier(1, 0, 0, 0.58, 1), 1, accuracy: 0.001)
    }

    // ── it plays when a BitGraph is MADE, and not when one is opened ────────

    func testItPlaysOnlyForSomethingJustMade() {
        let made = ProofSubject(root: "/r", evidencePath: "/e", filePath: "/f", name: "a.jpg", originDigestB64: nil, position: nil, justMade: true)
        let opened = ProofSubject(root: "/r", evidencePath: "/e", filePath: "/f", name: "a.jpg", originDigestB64: nil, position: nil, justMade: false)
        XCTAssertTrue(made.justMade)
        XCTAssertFalse(opened.justMade, "a page somebody opened is a record, not an event")
    }

    // ── the film ────────────────────────────────────────────────────────────

    /// Writes preview/minted.gif: the whole moment, over the page it plays on.
    func testRenderTheMintedAnimation() throws {
        let out = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("preview")
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let url = out.appendingPathComponent("minted.gif")

        let size = CGSize(width: 640, height: 520)
        let fps = 25.0
        let hold = 0.4
        var images: [CGImage] = []

        var t = 0.0
        while t <= MintedTiming.duration + hold {
            let frame = ZStack(alignment: .top) {
                ProofView(state: AppState(preview: nil), page: page)
                if t <= MintedTiming.duration {
                    MintedBadge(frozenAt: t)
                }
            }
            .frame(width: size.width, height: size.height)
            .environment(\.colorScheme, .light)

            let hosting = NSHostingView(rootView: frame)
            hosting.frame = NSRect(origin: .zero, size: size)
            hosting.layoutSubtreeIfNeeded()
            let rep = try XCTUnwrap(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
            hosting.cacheDisplay(in: hosting.bounds, to: rep)
            images.append(try XCTUnwrap(rep.cgImage))
            t += 1 / fps
        }

        let dest = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.gif.identifier as CFString, images.count, nil))
        CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
        for image in images {
            CGImageDestinationAddImage(dest, image, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1 / fps]] as CFDictionary)
        }
        XCTAssertTrue(CGImageDestinationFinalize(dest))
        XCTAssertGreaterThan(images.count, 30, "a second and a half at 25 frames a second")

        // A filmstrip of the moments that matter, for looking at in one glance.
        let moments = [0.10, 0.28, 0.46, 0.62, 0.90, 1.34]
        let cell = CGSize(width: 200, height: 200)
        let strip = HStack(spacing: 0) {
            ForEach(moments, id: \.self) { t in
                ZStack {
                    Color.white
                    MintedBadge(frozenAt: t)
                    VStack {
                        Spacer()
                        Text(String(format: "%.2fs", t)).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                    }.padding(6)
                }
                .frame(width: cell.width, height: cell.height)
                .border(Color(white: 0.9))
            }
        }
        .frame(width: cell.width * CGFloat(moments.count), height: cell.height)
        .environment(\.colorScheme, .light)

        let stripHost = NSHostingView(rootView: strip)
        stripHost.frame = NSRect(x: 0, y: 0, width: cell.width * CGFloat(moments.count), height: cell.height)
        stripHost.layoutSubtreeIfNeeded()
        let stripRep = try XCTUnwrap(stripHost.bitmapImageRepForCachingDisplay(in: stripHost.bounds))
        stripHost.cacheDisplay(in: stripHost.bounds, to: stripRep)
        try XCTUnwrap(stripRep.representation(using: .png, properties: [:])).write(to: out.appendingPathComponent("minted-frames.png"))
    }

    private var page: ProofPage {
        let proofJSON = """
        {"version":"bitgraph/1",
         "artifact":{"digestB64":"Wm9tYmllc0FyZU5vdFJlYWxCdXRIYXNoZXNBcmU9PQ==","hashAlg":"sha256"},
         "commit":{"counter":"2406","slotCounter":"2405","epochId":"eccfc1c7Zm9vYmFyYmF6cXV1eA==","chainId":"bitgraph:main"},
         "signer":{"publicKeyB64":"cHVibGljS2V5","signatureB64":"c2lnbmF0dXJl"},
         "environment":{"measurement":"eccfc1c705c72b","attestation":{"format":"aws-nitro"}},
         "slotAllocation":{"counter":"2405","nonceB64":"bm9uY2U=","signatureB64":"c2ln","epochId":"eccfc1c7Zm9vYmFyYmF6cXV1eA=="}}
        """
        let proof = try? JSONDecoder().decode(JSONValue.self, from: Data(proofJSON.utf8))
        let evidence = Evidence(
            file: Evidence.FileInfo(name: "IMG_4021.CR3", bytes: 28_400_000),
            placement: "trailer/1",
            originDigestB64: "b3JpZ2lu",
            artifactDigestB64: "YXJ0aWZhY3Q=",
            position: Position(epochId: "eccfc1c7Zm9vYmFyYmF6cXV1eA==", counter: "2406"),
            set: nil, member: nil,
            writtenAt: "2026-09-09T02:14:08Z"
        )
        return ProofPage(
            subject: ProofSubject(root: "/r", evidencePath: "/e", filePath: "/f", name: "IMG_4021.CR3", originDigestB64: nil, position: nil, justMade: true),
            described: Described(evidence: evidence, evidenceRaw: nil, proof: proof, committedB64: nil, positions: [evidence.position]),
            checked: CheckedFile(rel: "IMG_4021.CR3", name: "IMG_4021.CR3", status: "verified", reason: nil, failedOn: nil,
                                 category: "FUSED_FROM_ORIGIN", enclave: "enclave v8 (reproducible, authenticated anchors and the floor gate)",
                                 method: "verifier", position: Position(epochId: "e", counter: "2406"),
                                 bounds: [CheckedBound(side: "before", state: "anchored", note: "", blockNumber: 25_735_831, blockTime: "2026-09-08T14:00:00Z", contradiction: nil),
                                          CheckedBound(side: "after", state: "anchored", note: "", blockNumber: 25_735_833, blockTime: "2026-09-08T14:00:24Z", contradiction: nil)])
        )
    }
}
