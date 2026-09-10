// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI

/// The moment a BitGraph is made.
///
/// A ring sweeps closed, the checkmark draws itself, the badge springs in and
/// fades away. It plays ONCE, on a BitGraph that was made a second ago, and
/// never on one that was merely opened: this page is permanent and linkable,
/// and almost every visit to it is somebody opening a record, not watching an
/// event.
///
/// ⚠️ ONE TIMING FUNCTION, EVALUATED TWICE. The live view drives it from a
/// clock and the tests render frames from the same function at fixed instants,
/// so what is checked and what plays cannot drift. The curves are the site's,
/// to the millisecond.
enum MintedTiming {
    /// The whole thing, start to gone.
    static let duration: Double = 1.5

    struct Frame: Equatable {
        /// The wash over the page behind it.
        var scrim: Double
        /// How much of the ring has been drawn, 0 to 1.
        var ring: Double
        /// How much of the checkmark has been drawn, 0 to 1.
        var check: Double
        /// The badge's spring.
        var scale: Double
        var opacity: Double
    }

    /// The site's keyframes, at `t` seconds.
    ///
    ///   scrim   1.5s ease-out: up by 15%, held to 78%, out by 100%
    ///   pop     0.5s cubic-bezier(.2,.8,.3,1): .6 -> 1.07 at 62% -> 1
    ///   ring    0.5s ease-out, 0.05s in
    ///   check   0.3s ease-out, 0.46s in
    ///   fade    0.35s ease-out, 1.15s in
    static func frame(at t: Double) -> Frame {
        let scrim: Double = {
            let p = clamp(t / 1.5)
            if p < 0.15 { return easeOut(p / 0.15) }
            if p < 0.78 { return 1 }
            return 1 - easeOut((p - 0.78) / 0.22)
        }()

        let pop = clamp(t / 0.5)
        let scale: Double = {
            /* .6 to 1.07 by 62% of the pop, then settling to 1. */
            if pop < 0.62 { return 0.6 + (1.07 - 0.6) * bezier(pop / 0.62, 0.2, 0.8, 0.3, 1) }
            return 1.07 - 0.07 * bezier((pop - 0.62) / 0.38, 0.2, 0.8, 0.3, 1)
        }()
        let appearing = clamp(pop / 0.45)
        let fading = clamp((t - 1.15) / 0.35)

        return Frame(
            scrim: scrim,
            ring: easeOut(clamp((t - 0.05) / 0.5)),
            check: easeOut(clamp((t - 0.46) / 0.3)),
            scale: scale,
            opacity: appearing * (1 - easeOut(fading))
        )
    }

    /// Everything, at once, for anyone who asked not to be moved.
    static let still = Frame(scrim: 1, ring: 1, check: 1, scale: 1, opacity: 1)

    private static func clamp(_ v: Double) -> Double { min(max(v, 0), 1) }

    /// CSS `ease-out` is cubic-bezier(0, 0, 0.58, 1).
    private static func easeOut(_ t: Double) -> Double { bezier(t, 0, 0, 0.58, 1) }

    /// A cubic bezier easing curve, solved for y at x = t. Newton, then bisect.
    static func bezier(_ t: Double, _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) -> Double {
        let t = clamp(t)
        let cx = { (u: Double) in 3 * x1 * u * pow(1 - u, 2) + 3 * x2 * pow(u, 2) * (1 - u) + pow(u, 3) }
        let cy = { (u: Double) in 3 * y1 * u * pow(1 - u, 2) + 3 * y2 * pow(u, 2) * (1 - u) + pow(u, 3) }
        var lo = 0.0, hi = 1.0, u = t
        for _ in 0..<24 {
            let x = cx(u)
            if abs(x - t) < 1e-5 { break }
            if x < t { lo = u } else { hi = u }
            u = (lo + hi) / 2
        }
        return cy(u)
    }
}

/// The badge itself. Give it `frozenAt` to render one instant of it.
struct MintedBadge: View {
    var frozenAt: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()

    var body: some View {
        if let frozenAt {
            badge(MintedTiming.frame(at: frozenAt))
        } else if reduceMotion {
            /* ⚠️ Asked not to be moved. The mark still appears and still says
             * the same thing; it simply does not sweep. */
            badge(MintedTiming.still)
        } else {
            TimelineView(.animation) { context in
                badge(MintedTiming.frame(at: context.date.timeIntervalSince(start)))
            }
            .onAppear { start = Date() }
        }
    }

    private func badge(_ f: MintedTiming.Frame) -> some View {
        GeometryReader { geo in
            ZStack {
                Style.ground.opacity(0.72 * f.scrim)
                ZStack {
                    Circle()
                        .trim(from: 0, to: f.ring)
                        .stroke(Style.brand, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .padding(3)
                    Checkmark()
                        .trim(from: 0, to: f.check)
                        .stroke(Style.brand, style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
                }
                .frame(width: 104, height: 104)
                .scaleEffect(f.scale)
                .opacity(f.opacity)
                /* The site puts it at 44% of the height: a little above centre,
                 * where a face lands rather than where a dialog does. */
                .position(x: geo.size.width / 2, y: geo.size.height * 0.44)
            }
        }
        .ignoresSafeArea()
    }
}

struct Checkmark: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let s = min(rect.width, rect.height) / 104
        p.move(to: CGPoint(x: 32 * s, y: 54 * s))
        p.addLine(to: CGPoint(x: 46 * s, y: 68 * s))
        p.addLine(to: CGPoint(x: 73 * s, y: 39 * s))
        return p
    }
}
