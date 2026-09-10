// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import Foundation

/// The product's own surface, not the system's.
///
/// Light only. `#f5f5f5` ground, `#0065A4` for anything you can act on, square
/// corners everywhere. Brand colour lives in TEXT, never in a filled
/// background, and a secondary action is never quieted with a lighter weight:
/// actions are one weight and they read as links.
enum Style {
    static let ground = Color(red: 0.961, green: 0.961, blue: 0.961)   // #f5f5f5
    static let ink = Color(red: 0.09, green: 0.09, blue: 0.09)
    static let quiet = Color(red: 0.42, green: 0.42, blue: 0.42)
    /// #9ca3af, the site's disabled action.
    static let disabled = Color(red: 0.612, green: 0.639, blue: 0.686)
    static let brand = Color(red: 0.0, green: 0.396, blue: 0.643)      // #0065A4
    static let brandDeep = Color(red: 0.0, green: 0.294, blue: 0.478)  // #004b7a, the site's hover
    static let brandWash = Color(red: 0.933, green: 0.961, blue: 0.980)
    static let rule = Color(red: 0.886, green: 0.898, blue: 0.914)        // #e2e5e9
    static let cardBorder = Color(red: 0.816, green: 0.835, blue: 0.867)  // #d0d5dd
    static let fine = Color(red: 0.72, green: 0.15, blue: 0.11)        // the light, when it is red
    static let fineGreen = Color(red: 0.16, green: 0.49, blue: 0.24)

    /// The dashed frame's own line: `#c4c9d0` at rest, brand blue under a drag.
    static let dash = Color(red: 0.769, green: 0.788, blue: 0.816)         // #c4c9d0

    /// One type ladder, the site's: h1 32 / h2 22 / h3 18 / body 16.
    static let h1 = Font.system(size: 32, weight: .bold)
    static let h2 = Font.system(size: 22, weight: .semibold)
    static let h3 = Font.system(size: 18, weight: .semibold)
    /// Hashes, counters and times: the data font, never the prose one.
    static let data = Font.system(size: 12.5, design: .monospaced)
    /// A card's own name: the site sets these in brand blue, bold and letter-spaced.
    static let cardTitle = Font.system(size: 14, weight: .bold)
    /// A field's label, and the value under it.
    static let fieldLabel = Font.system(size: 14, weight: .bold)
    static let fieldValue = Font.system(size: 13)
    /// #374151, the site's field label.
    static let fieldInk = Color(red: 0.216, green: 0.255, blue: 0.318)
    /// The 7% brand wash a card header carries when it is open or hovered.
    static let brandTint = Color(red: 0.0, green: 0.396, blue: 0.643).opacity(0.07)
    /// What an action is set in. One weight, whatever the action is.
    static let action = Font.system(size: 14, weight: .semibold)
    static let actionSmall = Font.system(size: 12.5, weight: .semibold)

    static let title = Font.system(size: 15, weight: .semibold)
    static let body = Font.system(size: 16)
    static let panel = Font.system(size: 12)
    static let small = Font.system(size: 11)
    static let mono = Font.system(size: 11, design: .monospaced)

    /// A size a person reads.
    static func bytes(_ n: Int) -> String {
        let f = ByteCountFormatter()
        f.countStyle = .file
        return f.string(fromByteCount: Int64(n))
    }

    /// A count a person reads. 4,812 is a number; 4812 is a serial.
    static func count(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }
}

/// A plain horizontal rule. Not a card, not a box, not a shadow.
struct Rule: View {
    var body: some View {
        Rectangle().fill(Style.rule).frame(height: 1)
    }
}
