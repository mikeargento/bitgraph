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

    /// Pretty-printed, keys sorted, for the Raw card: two-space indent and
    /// `"key": value`, the way the core writes every file beside a recording,
    /// so the blocks on one page read alike. Foundation's printer put a
    /// space before the colon and the two styles sat one above the other
    /// (2026-09-12). "/" is never escaped: a proof full of base64 read as
    /// broken when it was (Mike, 2026-09-09: "shouldnt it be raw json?").
    var pretty: String {
        var out = ""
        write(into: &out, indent: 0)
        return out
    }

    private func write(into out: inout String, indent: Int) {
        let pad = String(repeating: "  ", count: indent)
        let inner = String(repeating: "  ", count: indent + 1)
        switch self {
        case .string(let s): out += JSONValue.quoted(s)
        case .number(let n): out += n == n.rounded() && abs(n) < 9_007_199_254_740_992 ? String(Int(n)) : String(n)
        case .bool(let b): out += b ? "true" : "false"
        case .null: out += "null"
        case .array(let a):
            if a.isEmpty { out += "[]"; return }
            out += "[\n"
            for (i, v) in a.enumerated() {
                out += inner
                v.write(into: &out, indent: indent + 1)
                out += i + 1 < a.count ? ",\n" : "\n"
            }
            out += pad + "]"
        case .object(let o):
            if o.isEmpty { out += "{}"; return }
            out += "{\n"
            let keys = o.keys.sorted()
            for (i, k) in keys.enumerated() {
                out += inner + JSONValue.quoted(k) + ": "
                o[k]!.write(into: &out, indent: indent + 1)
                out += i + 1 < keys.count ? ",\n" : "\n"
            }
            out += pad + "}"
        }
    }

    private static func quoted(_ s: String) -> String {
        var q = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": q += "\\\""
            case "\\": q += "\\\\"
            case "\n": q += "\\n"
            case "\r": q += "\\r"
            case "\t": q += "\\t"
            default:
                if u.value < 0x20 { q += String(format: "\\u%04x", u.value) } else { q.unicodeScalars.append(u) }
            }
        }
        return q + "\""
    }
}
