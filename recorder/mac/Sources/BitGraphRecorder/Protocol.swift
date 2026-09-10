// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import Foundation

/// What the core says about a folder.
///
/// ⚠️ `recorded` and `positions` come from the folder's index, which is a
/// convenience and not the authority. They are counts of what was last written
/// down. A check is what says whether it is all still true, and the app never
/// dresses one up as the other.
struct FolderStatus: Decodable, Identifiable, Equatable {
    var path: String
    /// ⚠️ Not there any more: deleted, renamed or unplugged. Not a fault, and
    /// every recording made from it is untouched in the library.
    var missing: Bool = false
    var paused: Bool
    var watching: Bool
    var busy: Bool
    var recorded: Int?
    var positions: Int?
    var indexDamagedLines: Int?

    var id: String { path }
    var name: String { (path as NSString).lastPathComponent }
}

struct Status: Decodable, Equatable {
    var baseUrl: String
    var supportDir: String
    /// The BitGraph folder. EMPTY until somebody has set the app up.
    var folder: String
    /// What setup offers when nobody has chosen.
    var suggested: String
    /// `<folder>/Recordings`. Where recordings live.
    var library: String
    /// How many recordings it holds, and how many files across them.
    var recordings: Int
    var recorded: Int
    /// True when the chosen folder is not on disk any more: it moved, or a drive is unplugged.
    var folderMissing: Bool?
    /// True when macOS refuses this app the folder: a privacy grant is missing.
    /// The window says so and opens the settings pane; the counts are not trusted.
    var folderBlocked: Bool?
    /// Folders that feed the box. Each says what came out of IT, never the library's totals.
    var folders: [FolderStatus]
}

struct Position: Decodable, Equatable, Hashable {
    var epochId: String
    var counter: String
}

/// ⚠️ Only what the app actually uses is required.
///
/// A required field the app never reads turns one added or renamed value in
/// the core into a whole event this side silently drops, and a dropped `made`
/// event is a BitGraph the person is never told about.
struct MadeFile: Decodable, Equatable {
    var path: String
    var name: String
    var evidencePath: String
    var bytes: Int?
    var placement: String?
    var originDigestB64: String?
    var artifactDigestB64: String?
    var manifestIndex: Int?
}

struct MakeResult: Decodable, Equatable {
    var kind: String
    var files: [MadeFile]
    var position: Position
}

struct SkippedFile: Decodable, Equatable {
    var name: String
    var attached: Bool
    /// `already-recorded`, or `same-bytes` as another file in the drop.
    var reason: String?
}

struct CheckProgress: Decodable, Equatable {
    var done: Int
    var total: Int
}

struct MakeProgress: Decodable, Equatable {
    var phase: String
    var done: Int
    var total: Int
}

struct CheckCounts: Decodable, Equatable {
    var verified: Int
    var failed: Int
    var undetermined: Int
    var unrecorded: Int
}

/// ⚠️ Only files with something to say are in `speaking`. A verified file is
/// not a row in a list here; it is part of a count.
struct CheckedFile: Decodable, Equatable, Identifiable {
    var rel: String
    var name: String?
    var status: String
    var reason: String?
    var failedOn: String?
    var category: String?
    var enclave: String?
    var method: String?
    var position: Position?
    var bounds: [CheckedBound]?
    var attestation: AttestationReport?
    var id: String { rel }
}

/// What the hardware itself said, opened and checked offline against the AWS
/// Nitro root.
///
/// ⚠️ `pcr0` is what the ATTESTATION says. The proof's own
/// `environment.measurement` is a claim in a document. `matchesDeclared` is
/// whether they agree, and it is the only one of the three that means anything
/// on its own.
struct AttestationReport: Decodable, Equatable {
    struct Step: Decodable, Equatable, Identifiable {
        var name: String
        var pass: Bool
        var detail: String
        var id: String { name }
    }
    var valid: Bool
    var pcr0: String?
    var matchesDeclared: Bool
    var moduleId: String?
    var certChainLength: Int?
    var failure: String?
    var checks: [Step]
}

/// One side of a position's Ethereum window, and what is known about it.
///
/// ⚠️ `blockTime` is set ONLY when keccak256(header) matched the hash the
/// anchor signed. A time read off an unverified header would be a time
/// asserted from an untrusted source.
struct CheckedBound: Decodable, Equatable, Identifiable {
    var side: String
    var state: String
    var note: String
    var etherscanUrl: String?
    var blockNumber: Int?
    var blockTime: String?
    var contradiction: String?
    var id: String { side }
}

struct FolderReport: Decodable, Equatable {
    var root: String
    var counts: CheckCounts
    var speaking: [CheckedFile]
    var positions: Int
    /// ⚠️ True when the check stopped early. Nothing claims a count it did not count.
    var partial: Bool
}

/// One file a drop found, with what the folder already knows about it.
struct Looked: Decodable, Equatable, Identifiable {
    var path: String
    var name: String
    var rel: String
    var bytes: Int
    var originDigestB64: String
    var placement: String
    var position: Position?
    var evidencePath: String?
    /// The earlier file in this drop holding the same bytes, when there is one.
    var duplicateOf: String?

    var id: String { path }
    var isRecorded: Bool { position != nil }
}

struct LookResult: Decodable, Equatable {
    var root: String
    /// A SAMPLE of the files, at most a few hundred. `total` is the real count.
    var files: [Looked]
    /// How many files were looked at, whatever is in `files`.
    var total: Int
    /// How many of the total this folder already holds.
    var recorded: Int
    /// True when `files` is a sample rather than the lot.
    var truncated: Bool
    /// How many of the total are the same bytes as an earlier file in the drop.
    var duplicates: Int?
}

/// What a drop turned out to be.
///
///   open   these bytes already have a BitGraph here.
///   made   one new file, and the drop was the shutter.
///   ready  two or more files, listed and waiting. Only a batch gets asked.
struct DropAnswer: Decodable, Equatable {
    var action: String
    var root: String
    var look: LookResult
    var token: String?
    var made: MakeResult?
    var skipped: [SkippedFile]?
    var opened: Looked?
}

/// One recording in the library, as a day lists it.
struct Recording: Decodable, Equatable, Identifiable {
    var path: String
    var name: String
    var day: String
    var files: Int
    var writtenAt: String
    var waitingOnAnchors: Bool
    /// The folder it was dropped or synced from, when the index remembers.
    var from: String?
    var id: String { path }
}

/// A day in the ledger's spine: the date and how many recordings it holds.
struct DayCount: Decodable, Equatable, Identifiable {
    var day: String
    var count: Int
    var id: String { day }
}

/// The library's spine: every day that holds recordings, newest first. Read
/// from the folders themselves, never the index, and nothing opened.
struct LedgerSpine: Decodable, Equatable {
    var days: [DayCount]
    var total: Int
}

/// One day drilled out.
struct DayRecordings: Decodable, Equatable {
    var day: String
    var recordings: [Recording]
}

/// Everything the proof view shows, read off the disk. Nothing fetched.
struct Described: Decodable, Equatable {
    /// The file the page is about, on disk. For a recording, inside it.
    var filePath: String?
    var evidence: Evidence?
    /// The evidence file verbatim. For a set/2 member the inclusion path in
    /// here is the only thing putting this file in that set.
    var evidenceRaw: String?
    var proof: JSONValue?
    var committedB64: String?
    var positions: [Position]
    /// A recording's files, the first 500. The page lists them and opens any of them.
    var members: [MemberInfo]?
    var memberCount: Int?
}

struct MemberInfo: Decodable, Equatable, Identifiable {
    var name: String
    var rel: String
    var bytes: Int
    var originDigestB64: String
    var id: String { rel }
}

struct Evidence: Decodable, Equatable {
    struct FileInfo: Decodable, Equatable {
        var name: String
        var bytes: Int
    }
    struct Member: Decodable, Equatable {
        var index: Int
        var count: Int
    }
    var file: FileInfo
    var placement: String
    var originDigestB64: String
    var artifactDigestB64: String
    var position: Position
    var set: String?
    var member: Member?
    var writtenAt: String
}

struct AnchorPass: Decodable, Equatable {
    var positions: Int
    var landed: Int
    var open: [String: Int]
    var partial: Bool
}

/// ⚠️ A gap is not a fault.
///
/// `fault`  something is wrong and somebody has to act.
/// `gap`    something could not be done and nothing is wrong: the ledger could
///          not be reached, a make could not finish. Nothing was lost.
///
/// Painting a gap the same colour as a fault says a thing happened that did
/// not, which is the same overstatement as calling a failed read an absence.
enum TroubleSeverity: String, Decodable {
    case fault
    case gap
}

/// One line the core sent that was not an answer to anything.
enum DaemonEvent: Equatable {
    case ready(supportDir: String)
    case watching(root: String)
    case settling(root: String, files: Int)
    case making(root: String, files: Int, progress: MakeProgress?)
    case checking(root: String, done: Int, total: Int)
    case made(root: String, result: MakeResult)
    case skipped(root: String, files: [SkippedFile])
    case anchors(root: String, pass: AnchorPass)
    case idle(root: String)
    case trouble(root: String, reason: String, recoverable: Bool, severity: TroubleSeverity)
    case settingsChanged
    case unknown(kind: String)

    var root: String? {
        switch self {
        case .watching(let r), .settling(let r, _), .making(let r, _, _), .checking(let r, _, _), .made(let r, _),
             .skipped(let r, _), .anchors(let r, _), .idle(let r), .trouble(let r, _, _, _):
            return r
        case .ready, .settingsChanged, .unknown:
            return nil
        }
    }
}

extension DaemonEvent: Decodable {
    private enum Keys: String, CodingKey {
        case kind, root, files, progress, result, pass, reason, recoverable, supportDir, severity
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let kind = try c.decode(String.self, forKey: .kind)
        let root = try c.decodeIfPresent(String.self, forKey: .root) ?? ""
        switch kind {
        case "ready":
            self = .ready(supportDir: try c.decodeIfPresent(String.self, forKey: .supportDir) ?? "")
        case "watching":
            self = .watching(root: root)
        case "settling":
            self = .settling(root: root, files: try c.decodeIfPresent(Int.self, forKey: .files) ?? 0)
        case "making":
            self = .making(
                root: root,
                files: try c.decodeIfPresent(Int.self, forKey: .files) ?? 0,
                progress: try c.decodeIfPresent(MakeProgress.self, forKey: .progress)
            )
        case "checking":
            let p = try c.decodeIfPresent(CheckProgress.self, forKey: .progress)
            self = .checking(root: root, done: p?.done ?? 0, total: p?.total ?? 0)
        case "made":
            self = .made(root: root, result: try c.decode(MakeResult.self, forKey: .result))
        case "skipped":
            self = .skipped(root: root, files: try c.decodeIfPresent([SkippedFile].self, forKey: .files) ?? [])
        case "anchors":
            self = .anchors(root: root, pass: try c.decode(AnchorPass.self, forKey: .pass))
        case "idle":
            self = .idle(root: root)
        case "trouble":
            self = .trouble(
                root: root,
                reason: try c.decodeIfPresent(String.self, forKey: .reason) ?? "something went wrong and did not say what.",
                recoverable: try c.decodeIfPresent(Bool.self, forKey: .recoverable) ?? true,
                /* ⚠️ An unlabelled trouble is treated as a FAULT. Reading an
                 * unknown thing as the quieter of two possibilities is how a
                 * real problem gets shown in grey. */
                severity: (try? c.decodeIfPresent(TroubleSeverity.self, forKey: .severity)) as? TroubleSeverity ?? .fault
            )
        case "settings":
            self = .settingsChanged
        default:
            self = .unknown(kind: kind)
        }
    }
}


/// The core's sentence for a macOS privacy block, so the window can add the
/// way to the settings pane. The prefix is `BLOCKED_PREFIX` in core/src/blocked.ts.
enum Blocked {
    static let prefix = "macOS is blocking BitGraph Recorder from "
    static func isBlock(_ text: String) -> Bool { text.hasPrefix(prefix) }
}
