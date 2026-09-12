// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import Foundation

/// The core, running as a child process, spoken to over a pipe.
///
/// ⚠️ A PIPE, NOT A PORT. Nothing else on this machine can reach it. The app
/// launches it, writes one line of JSON per request and reads one line per
/// answer; the connection has no listener, no address and no discovery.
///
/// ⚠️ IF IT DIES, IT COMES BACK, AND THE APP SAYS SO. A watcher that quietly
/// stopped is worse than one that never started, because the folder looks
/// watched.
@MainActor
final class DaemonClient: ObservableObject {
    enum State: Equatable {
        case starting
        case running
        case stopped(reason: String)
    }

    @Published private(set) var state: State = .starting

    private var process: Process?
    private var stdinPipe: Pipe?
    private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
    private var nextID = 1
    private var restarts = 0
    private let onEvent: (DaemonEvent) -> Void

    /// Where the core and its runtime live inside the app bundle, or in the
    /// tree when this is a development run.
    private let nodePath: String
    private let corePath: String

    init(nodePath: String, corePath: String, onEvent: @escaping (DaemonEvent) -> Void) {
        self.nodePath = nodePath
        self.corePath = corePath
        self.onEvent = onEvent
    }

    func start() {
        guard process == nil else { return }
        state = .starting

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodePath)
        /* ⚠️ A HEAP SIZED TO THE MACHINE. Node's default old-space limit is
         * about 2 GB whatever the Mac has, and a 100,000-file set holds a
         * row, a digest pair and an inclusion path per member on the way to
         * one proof: the core died of it (V8 out of memory, 2026-09-12,
         * Mike's 100k test drop). Half the machine's memory, never under 2
         * GB nor over 8. */
        proc.arguments = ["--max-old-space-size=\(Self.heapMB)", corePath, "daemon"]

        let inPipe = Pipe()
        let outPipe = Pipe()
        let errPipe = Pipe()
        proc.standardInput = inPipe
        proc.standardOutput = outPipe
        proc.standardError = errPipe

        let lines = LineReader { [weak self] line in
            Task { @MainActor in self?.receive(line) }
        }
        outPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty { return }
            lines.feed(data)
        }
        /* The core writes nothing to stderr in normal running. Anything that
         * appears there is a crash or a warning, and it reaches the app rather
         * than a log nobody opens. */
        errPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            Task { @MainActor in
                self.onEvent(.trouble(root: "", reason: trimmed, recoverable: true, severity: .fault))
            }
        }
        proc.terminationHandler = { [weak self] p in
            Task { @MainActor in self?.died(status: p.terminationStatus) }
        }

        do {
            try proc.run()
        } catch {
            state = .stopped(reason: "the recorder's core could not be started: \(error.localizedDescription)")
            return
        }
        process = proc
        stdinPipe = inPipe
        state = .running
    }

    /// Half of physical memory in MB, clamped to 2,048…8,192.
    static var heapMB: Int {
        let half = Int(ProcessInfo.processInfo.physicalMemory / (2 * 1_048_576))
        return min(max(half, 2_048), 8_192)
    }

    func stop() {
        process?.terminationHandler = nil
        _ = try? stdinPipe?.fileHandleForWriting.close()
        process?.terminate()
        process = nil
        stdinPipe = nil
        state = .stopped(reason: "stopped")
    }

    private func died(status: Int32) {
        for (_, cont) in pending { cont.resume(throwing: DaemonError.stopped) }
        pending.removeAll()
        process = nil
        stdinPipe = nil

        /* Backing off rather than spinning: a core that cannot start will not
         * start faster for being asked ten times a second, and the app has to
         * stay usable enough to say what happened. */
        restarts += 1
        let delay = min(pow(2.0, Double(min(restarts, 6))), 60.0)
        state = .stopped(reason: "the recorder's core stopped (exit \(status)). Starting it again in \(Int(delay))s.")
        onEvent(.trouble(root: "", reason: "The recorder's core stopped and is being started again. Nothing already recorded is affected.", recoverable: true, severity: .fault))
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            self.start()
        }
    }

    // ── requests ────────────────────────────────────────────────────────────

    @discardableResult
    func send<T: Decodable>(_ op: String, _ fields: [String: Any] = [:], as: T.Type) async throws -> T {
        let data = try await sendRaw(op, fields)
        return try JSONDecoder().decode(T.self, from: data)
    }

    func send(_ op: String, _ fields: [String: Any] = [:]) async throws {
        _ = try await sendRaw(op, fields)
    }

    private func sendRaw(_ op: String, _ fields: [String: Any]) async throws -> Data {
        guard let handle = stdinPipe?.fileHandleForWriting else { throw DaemonError.stopped }
        let id = nextID
        nextID += 1
        var body: [String: Any] = fields
        body["id"] = id
        body["op"] = op
        let line = try JSONSerialization.data(withJSONObject: body, options: [])

        return try await withCheckedThrowingContinuation { cont in
            pending[id] = cont
            do {
                try handle.write(contentsOf: line)
                try handle.write(contentsOf: Data("\n".utf8))
            } catch {
                pending[id] = nil
                cont.resume(throwing: error)
            }
        }
    }

    // ── replies and events ──────────────────────────────────────────────────

    private func receive(_ line: String) {
        guard let data = line.data(using: .utf8) else { return }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        if let event = object["event"] {
            guard let eventData = try? JSONSerialization.data(withJSONObject: event),
                  let decoded = try? JSONDecoder().decode(DaemonEvent.self, from: eventData) else { return }
            if case .ready = decoded { restarts = 0 }
            onEvent(decoded)
            return
        }

        guard let id = object["id"] as? Int, let cont = pending.removeValue(forKey: id) else { return }
        if object["ok"] as? Bool == true {
            let result = object["result"] ?? [:]
            if let resultData = try? JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed]) {
                cont.resume(returning: resultData)
            } else {
                cont.resume(throwing: DaemonError.unreadable)
            }
        } else {
            let why = object["error"] as? String ?? "the recorder refused that and did not say why."
            /* A block by macOS carries a flag: the window offers the settings pane. */
            if object["blocked"] as? Bool == true {
                cont.resume(throwing: DaemonError.blocked(why))
            } else {
                cont.resume(throwing: DaemonError.refused(why))
            }
        }
    }
}

enum DaemonError: LocalizedError {
    case stopped
    case unreadable
    case refused(String)
    /// macOS's privacy layer refused the core a folder. The text is the core's
    /// sentence, which names the folder and the settings pane.
    case blocked(String)

    var errorDescription: String? {
        switch self {
        case .stopped: return "The recorder's core is not running."
        case .unreadable: return "The recorder's answer could not be read."
        case .refused(let why): return why
        case .blocked(let why): return why
        }
    }
}

/// Splits a byte stream into lines. The core writes one JSON object per line
/// and a read can land anywhere, including mid-character.
private final class LineReader: @unchecked Sendable {
    private var buffer = Data()
    private let onLine: (String) -> Void
    private let lock = NSLock()

    init(onLine: @escaping (String) -> Void) {
        self.onLine = onLine
    }

    func feed(_ data: Data) {
        lock.lock()
        buffer.append(data)
        var out: [String] = []
        while let index = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer[buffer.startIndex..<index]
            buffer = buffer[buffer.index(after: index)...]
            if let line = String(data: lineData, encoding: .utf8), !line.isEmpty { out.append(line) }
        }
        lock.unlock()
        for line in out { onLine(line) }
    }
}
