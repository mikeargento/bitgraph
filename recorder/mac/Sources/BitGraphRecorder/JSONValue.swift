// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import Foundation

/// A proof, as it is.
///
/// ⚠️ THE PROOF IS NEVER RESHAPED TO FIT THE VIEW. A typed model would decide
/// in advance which fields exist, and a proof carrying a field this build has
/// never heard of would lose it silently between the disk and the screen. The
/// page is full disclosure, so the whole object is carried and read by path,
/// and Raw shows exactly what came off the disk.
indirect enum JSONValue: Decodable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .null }
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    var string: String? {
        if case .string(let s) = self { return s }
        if case .number(let n) = self { return n == n.rounded() ? String(Int(n)) : String(n) }
        return nil
    }

    var int: Int? {
        if case .number(let n) = self { return Int(n) }
        if case .string(let s) = self { return Int(s) }
        return nil
    }

    var array: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    var isPresent: Bool {
        if case .null = self { return false }
        return true
    }

    /// Pretty-printed, keys sorted, for the Raw card.
    var pretty: String {
        /* ⚠️ `.withoutEscapingSlashes`: Foundation writes "/" as "\/" unless
         * told not to, and a proof full of base64 read as if it were broken
         * (Mike, 2026-09-09: "shouldnt it be raw json?"). */
        guard let data = try? JSONSerialization.data(withJSONObject: foundation, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes]),
              let text = String(data: data, encoding: .utf8) else { return "" }
        return text
    }

    private var foundation: Any {
        switch self {
        case .string(let s): return s
        case .number(let n): return n == n.rounded() && abs(n) < 9_007_199_254_740_992 ? Int(n) : n
        case .bool(let b): return b
        case .null: return NSNull()
        case .array(let a): return a.map(\.foundation)
        case .object(let o): return o.mapValues(\.foundation)
        }
    }
}
