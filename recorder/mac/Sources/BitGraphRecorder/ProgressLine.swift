// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI

/// A bar that always moves.
///
/// ⚠️ A PHASE WITH NOTHING TO COUNT STILL HAS TO LOOK ALIVE. Filling the slot
/// is one request; building the tree is one operation. Both take real seconds
/// on a large set, and a bar sitting at zero through them reads as a hang,
/// which is what it was reported as. Counted phases fill; uncounted ones slide
/// a band along, which says "working" without claiming any progress it cannot
/// measure.
struct ProgressLine: View {
    /// nil when this phase cannot count.
    let fraction: Double?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(Style.rule)
                if let fraction {
                    Rectangle()
                        .fill(Style.brand)
                        .frame(width: max(2, geo.size.width * min(max(fraction, 0), 1)))
                        .animation(.easeOut(duration: 0.12), value: fraction)
                } else {
                    TimelineView(.animation) { context in
                        let t = context.date.timeIntervalSinceReferenceDate
                        let band = geo.size.width * 0.32
                        /* A full cycle every 1.1s, out of one edge and in at
                         * the other, so it never pauses at a boundary. */
                        let x = (t.truncatingRemainder(dividingBy: 1.1) / 1.1) * (geo.size.width + band) - band
                        Rectangle()
                            .fill(Style.brand)
                            .frame(width: band)
                            .offset(x: x)
                    }
                }
            }
            .clipShape(Rectangle())
        }
        .frame(minHeight: 3)
    }
}
