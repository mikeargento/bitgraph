// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import SwiftUI
import AppKit

/// A BitGraph, in full, laid out for the person who made it.
///
/// Mike, 2026-09-09: "abandon any pre conceived ideas an optimize this for
/// user." So the page answers, in order, what somebody opening it asks:
///
///   1. Is it good, and when?      the status card
///   2. What is it?                the file, and the recording's other files
///   3. What was recorded?         position, epoch, enclave, the hashes
///   4. Show me everything.        one Details card holding the rest
///
/// ⚠️ FULL DISCLOSURE STILL HOLDS. Every value the proof carries is on this
/// page; the technical cards moved under one disclosure, they did not go.
/// ⚠️ THE VERDICT IS WHAT A CHECK SAID, never what the disk holds.
struct ProofView: View {
    @ObservedObject var state: AppState
    let page: ProofPage

    private var proof: JSONValue? { page.described.proof }
    private var evidence: Evidence? { page.described.evidence }

    /// Open from the start (Mike, 2026-09-11: "files in this recording can
    /// now default to open agree?"): the tiles are lazy and the grid is
    /// capped, so a thousand-file recording costs no more open than folded.
    /// Picking a file still folds it, and the row reopens it.
    @State private var filesOpen = true
    @State private var filesHover = false

    /// ⚠️ THE FILE INSIDE THE RECORDING, never the one it was dropped from.
    /// After a drop the page was handed the original's path, and Show in
    /// Finder went "right to where the file originally was" (Mike,
    /// 2026-09-09). The recording is what this page is about; the core says
    /// where the file sits in it. Empty until it is there, and the pill is
    /// grey until then.
    private var shownPath: String {
        if !hasChosenFile { return (page.subject.evidencePath as NSString).deletingLastPathComponent }
        if let inRecording = page.described.filePath, !inRecording.isEmpty { return inRecording }
        return page.subject.filePath
    }

    /// What Show in Finder selects: what the page is showing. A chosen file
    /// is revealed where it sits inside the recording; a recording with no
    /// file chosen opens on its proof, so the BitGraph itself is what appears.
    /// Mike, 2026-09-09: "view in finder THE bitgraph of THE file im looking
    /// at", then, when proof.json stood in for a nested file, "it doesnt
    /// actually connect".
    private var revealPath: String {
        guard page.subject.evidencePath.hasSuffix("/proof.json") else { return shownPath }
        return hasChosenFile ? shownPath : page.subject.evidencePath
    }

    /// "new test files, 2,030 files" for a recording folder called
    /// "BitGraph (new test files, 2,030 files)"; a file's name as it is.
    private var pageTitle: String {
        var name = page.subject.name
        if name.hasPrefix("BitGraph (") && name.hasSuffix(")") {
            name = String(name.dropFirst("BitGraph (".count).dropLast())
        }
        /* The count goes too: the fold under it says "Files in this
         * recording (16,000)" ("is this needed?" — Mike, 2026-09-09). */
        if let range = name.range(of: #", [\d,]+ files?$"#, options: .regularExpression) {
            name.removeSubrange(range)
        }
        return name
    }

    /// A recording of several files previews nothing until one is picked.
    private var hasChosenFile: Bool {
        page.subject.chosenFile || (page.described.members?.count ?? 0) <= 1
    }

    var body: some View {
        ZStack(alignment: .top) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    pageBar
                    status
                    /* The two detail rows ahead of the preview: what opens
                     * from them opens down, between the verdict and the
                     * image, not under a picture that has to be scrolled
                     * past (Mike, 2026-09-11: "what if these buttons were
                     * more intuitively on TOP of the content that loads,
                     * and it expands down from top"). */
                    record
                    details
                    subject
                }
                /* 880, not the list's 800: room for the verdict's date line
                 * beside two acts of one width ("if you need to bump entire
                 * content width to do so go ahead", Mike, 2026-09-11). */
                .frame(maxWidth: 880, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 60)
            }
            .background(G.ground)

            if page.subject.justMade {
                /* Plays once, on a BitGraph that was made a second ago. A page
                 * somebody opens is a record, not an event. */
                MintedBadge()
                    .allowsHitTesting(false)
            }
        }
    }

    // ── the page bar ────────────────────────────────────────────────────────

    /// The name, on its own line with the whole width. The bar that stood
    /// above it went (Mike, 2026-09-11: "export bitgraph can go in this
    /// pill. back can go up next to +new"): Back is in the header beside
    /// New, and the two acts sit in the verdict card.
    private var pageBar: some View {
        /* The card-title size, not the page-title size: a file name is a
         * label, and at 22pt it out-shouted the record it names (Mike,
         * 2026-09-09: "i think the file name should be smaller"). Smaller
         * also shows more of a long name before the cut. */
        Text(pageTitle)
            .font(G.cardTitle)
            .foregroundStyle(G.ink)
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.leading, 4)
            .padding(.top, 8)
            .padding(.bottom, 4)
    }

    // ── 1. is it good, and when ─────────────────────────────────────────────

    private var status: some View {
        let s = verdict
        /* No icon, no enclave line: "this could say bitgraph recorded and all
         * that other stuff is found in the details section so it can just be
         * date and time and lose the little icon" (Mike, 2026-09-09). */
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(s.headline).font(G.cardTitle).foregroundStyle(s.color)
                    Text(s.line).font(G.body).foregroundStyle(G.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 16)
                /* The two things to do with it, on the verdict: reveal the
                 * file, or write the package. ❌ No Open pill: "only the
                 * small hover open button is needed" (Mike, 2026-09-10); the
                 * card opens on click and says so under the pointer. */
                /* Two of a size: a filled pill narrower than the outlined one
                 * beside it read as the lesser act. */
                Pill(title: "Show in Finder", style: .outlined, icon: "folder", enabled: !shownPath.isEmpty, width: Self.actWidth) { state.revealFile(revealPath) }
                Pill(title: state.exporting ? "Writing…" : "Export", style: .filled, icon: "square.and.arrow.up", enabled: !state.exporting, width: Self.actWidth) {
                    state.exportBitGraph(page.subject)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            if let note = state.exportNote {
                Rectangle().fill(G.border).frame(height: 1)
                Text(note).font(G.small).foregroundStyle(G.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 20).padding(.vertical, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardChrome()
    }

    /// The width of each act on the verdict card.
    static let actWidth: CGFloat = 168

    private struct Verdict {
        let icon: String
        let color: Color
        let headline: String
        let line: String
    }

    /// The verdict comes from the check; the time comes from anchors whose
    /// headers were verified. Neither is read off the disk.
    private var verdict: Verdict {
        guard let checked = page.checked else {
            return Verdict(icon: "hourglass", color: G.ink, headline: "Checking…", line: "Reading the bytes and the proof.")
        }
        switch checked.status {
        case "verified":
            /* ⚠️ THE TIME FILLS ITSELF IN, QUIETLY. Mike, 2026-09-09: "anchors on
             * the way shouldnt be all in your face ... the way the site used to
             * put the recorded time between and ... then time just shows up."
             * A missing side is an ellipsis here; why it is missing, and who
             * signed, is under Recording details for whoever goes looking. */
            if let when = whenLines {
                return Verdict(icon: "checkmark.seal.fill", color: G.ink, headline: "BitGraph recorded",
                               line: "\(when.date), \(when.window)")
            }
            return Verdict(icon: "checkmark.seal.fill", color: G.ink, headline: "BitGraph recorded",
                           line: "Position #\(evidence?.position.counter ?? "?"), time between … and …")
        case "failed":
            return Verdict(icon: "exclamationmark.triangle.fill", color: G.red, headline: "Failed the check",
                           line: checked.reason ?? "Something contradicted the record.")
        case "unrecorded":
            return Verdict(icon: "questionmark.circle", color: G.ink, headline: "Not recorded",
                           line: checked.reason ?? "No BitGraph for these bytes.")
        default:
            return Verdict(icon: "questionmark.circle", color: G.ink, headline: "Could not be checked",
                           line: checked.reason ?? "A gap on this side, never a failure.")
        }
    }

    /// The reason, from the sides themselves, never a guess, and said once.
    private var pendingWhy: String {
        let sides = page.checked?.bounds ?? []
        if sides.isEmpty { return "This BitGraph's Ethereum anchors have not been read yet." }
        var seen = Set<String>()
        let notes = sides.filter { $0.blockTime == nil }.map(\.note).filter { !$0.isEmpty && seen.insert($0).inserted }
        return notes.isEmpty
            ? "The anchors are here but their block headers were not, so no time is claimed from them."
            : notes.joined(separator: " ")
    }

    // ── 2. what it is ───────────────────────────────────────────────────────

    /// The grid is on show: a recording of several files with its row open.
    /// The big preview and the grid take turns (Mike, 2026-09-11:
    /// "reclicking files in this recording should fold back in big thumb"):
    /// picking a file folds the grid and shows the file; reopening the row
    /// folds the file and shows the grid.
    private var gridShowing: Bool {
        filesOpen && (page.described.members?.count ?? 0) > 1
    }

    /// The file itself, then the rest of the recording it belongs to.
    private var subject: some View {
        VStack(alignment: .leading, spacing: 0) {
            if hasChosenFile && !gridShowing {
                SubjectView(path: shownPath, name: evidence?.file.name ?? page.subject.name, bytes: evidence?.file.bytes ?? 0)
            }

            if let members = page.described.members, members.count > 1 {
                if hasChosenFile && !gridShowing { Rectangle().fill(G.border).frame(height: 1) }
                /* Was folded on Mike's word (2026-09-09: "sometimes theres a
                 * lot of files"); open from 2026-09-11, now that the preview
                 * sits last on the page. The row says how many. */
                Button { withAnimation(.easeOut(duration: 0.18)) { filesOpen.toggle() } } label: {
                    HStack(spacing: 12) {
                        Text("Files in this recording (\(G.count(page.described.memberCount ?? members.count)))")
                            .font(G.label).foregroundStyle(G.ink)
                        Spacer(minLength: 12)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(G.secondary)
                            .rotationEffect(.degrees(filesOpen ? 90 : 0))
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(filesHover ? G.hover : Color.white)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { filesHover = $0 }

                if filesOpen {
                    Rectangle().fill(G.border).frame(height: 1)
                    /* ⚠️ A VIEWER, NOT A LIST. Mike, 2026-09-09: "would it be a
                     * good idea to have a 'viewer' so you can see all the files
                     * in the drop?" Tiles, thumbnails made as they scroll into
                     * view, a click opening that file's page. */
                    let bundleDir = (page.subject.evidencePath as NSString).deletingLastPathComponent
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 8)], spacing: 8) {
                            ForEach(members) { m in
                                FileTile(path: (bundleDir as NSString).appendingPathComponent(m.rel), name: m.name, bytes: m.bytes,
                                         current: hasChosenFile && m.originDigestB64 == evidence?.originDigestB64) {
                                    /* Picking one folds the rest away: the file takes the stage. */
                                    withAnimation(.easeOut(duration: 0.18)) { filesOpen = false }
                                    state.openMember(m)
                                }
                            }
                        }
                        .padding(12)
                        if let total = page.described.memberCount, total > members.count {
                            Text("and \(G.count(total - members.count)) more, in the recording folder")
                                .font(G.small).foregroundStyle(G.secondary).padding(.horizontal, 16).padding(.bottom, 12)
                        }
                    }
                    .frame(maxHeight: 460)
                }
            } else if let member = evidence?.member, hasChosenFile {
                Rectangle().fill(G.border).frame(height: 1)
                Text("Member \(G.count(member.index + 1)) of \(G.count(member.count)) in this set")
                    .font(G.small).foregroundStyle(G.secondary)
                    .padding(.horizontal, 16).padding(.vertical, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardChrome()
    }

    // ── 3. what was recorded ────────────────────────────────────────────────

    /// The facts somebody quotes: where in the ledger, who signed, the hashes.
    /// Folded, on Mike's word (2026-09-09): "collapse into 'position details'
    /// and it opens, then 'recording details' in place of just details".
    private var record: some View {
        Card(title: "Position details") {
            Field(label: "Position", value: "#\(evidence?.position.counter ?? "?")")
            Field(label: "Epoch", value: evidence?.position.epochId ?? "", mono: true)
            if let known = page.checked?.enclave {
                Field(label: "Enclave", value: known)
            } else if let m = proof?["environment"]?["measurement"]?.string {
                Field(label: "Enclave measurement", value: m, mono: true)
            }
            Field(label: "File hash", value: evidence?.originDigestB64 ?? "", mono: true)
            if evidence?.member != nil {
                Field(label: "New file hash", value: evidence?.artifactDigestB64 ?? "", mono: true)
                Field(label: "Set hash", value: proof?["artifact"]?["digestB64"]?.string ?? "", mono: true)
            } else {
                Field(label: "New file hash", value: proof?["artifact"]?["digestB64"]?.string ?? "", mono: true)
            }
            Field(label: "Commitment", value: carriedBy, last: true)
        }
    }

    /// How the artifact carries the commitment, in the words the site uses.
    private var carriedBy: String {
        if evidence?.member != nil { return "in each member's bytes" }
        switch evidence?.placement {
        case "trailer/1": return "in the bytes appended to the file"
        case "container/1", "container/2": return "in a wrapper around the file"
        case .some(let id): return id
        case nil: return "Not declared"
        }
    }

    // ── 4. everything else, under one heading ───────────────────────────────

    private var details: some View {
        Card(title: "Recording details") {
            if let member = evidence?.member {
                Section("Set") {
                    Field(label: "Members", value: G.count(member.count))
                    Field(label: "This file", value: "member \(G.count(member.index + 1)) of \(G.count(member.count))")
                    Field(label: "Kind", value: evidence?.set ?? "")
                }
            }
            if let allocation = proof?["slotAllocation"], allocation.isPresent {
                Section("Reserved slot") {
                    Field(label: "Slot counter", value: "#\(allocation["counter"]?.string ?? "?")")
                    Field(label: "Nonce", value: allocation["nonceB64"]?.string ?? "", mono: true)
                    Field(label: "Slot signature", value: allocation["signatureB64"]?.string ?? "", mono: true)
                    Field(label: "Epoch ID", value: allocation["epochId"]?.string ?? "", mono: true)
                }
            }
            if let c = proof?["commit"], c.isPresent {
                Section("Artifact commit") {
                    Field(label: "Artifact counter", value: "#\(c["counter"]?.string ?? "?")")
                    if let prev = c["prevB64"]?.string { Field(label: "Previous hash", value: prev, mono: true) }
                    if let slotHash = c["slotHashB64"]?.string { Field(label: "Slot hash", value: slotHash, mono: true) }
                    if let anchor = c["slotAnchor"], anchor.isPresent {
                        Field(label: "Anchor at allocation", value: "Ethereum block \(anchor["blockNumber"]?.string ?? "?")")
                        Field(label: "Anchor block hash", value: anchor["blockHash"]?.string ?? "", mono: true)
                    }
                    if let anchor = c["anchor"], anchor.isPresent {
                        Field(label: "Anchored block", value: "Ethereum block \(anchor["blockNumber"]?.string ?? "?")")
                        Field(label: "Anchored block hash", value: anchor["blockHash"]?.string ?? "", mono: true)
                    }
                }
            }
            if let signer = proof?["signer"], signer.isPresent {
                Section("Signature") {
                    if let hash = proof?["proofHash"]?.string { Field(label: "This BitGraph's hash", value: hash, mono: true) }
                    Field(label: "Signature", value: signer["signatureB64"]?.string ?? "", mono: true)
                    Field(label: "Public key", value: signer["publicKeyB64"]?.string ?? "", mono: true)
                }
            }
            if let env = proof?["environment"], env.isPresent {
                Section(page.checked?.enclave != nil ? "Hardware enclave" : "Environment") {
                    Field(label: "PCR0 measurement", value: env["measurement"]?.string ?? "", mono: true)
                    if let format = env["attestation"]?["format"]?.string { Field(label: "Attestation format", value: format) }
                    /* ⚠️ THE MEASUREMENT ABOVE IS A CLAIM IN A DOCUMENT. What
                     * follows is the attestation itself, opened and checked
                     * offline: its signature, its certificate chain up to the
                     * AWS Nitro root, and the PCR0 the hardware put inside it. */
                    if let a = page.checked?.attestation {
                        Field(label: "Attestation document", value: a.valid
                              ? "Verified offline: signature, and the certificate chain to the AWS Nitro root."
                              : (a.failure ?? "This document could not be opened, so nothing is claimed from it."),
                              tone: a.valid ? .normal : .quiet)
                        if let pcr0 = a.pcr0 {
                            Field(label: a.matchesDeclared ? "PCR0 inside the attestation, matching the declared one" : "PCR0 INSIDE THE ATTESTATION, WHICH IS NOT THE DECLARED ONE",
                                  value: pcr0, mono: true, tone: a.matchesDeclared ? .normal : .fault)
                        }
                        if let module = a.moduleId { Field(label: "Enclave module", value: module, mono: true) }
                        if let n = a.certChainLength { Field(label: "Certificates to the AWS root", value: G.count(n)) }
                        ForEach(a.checks) { step in
                            Field(label: step.name, value: step.detail, tone: step.pass ? .quiet : .fault)
                        }
                    }
                }
            }
            if let sides = page.checked?.bounds {
                ForEach(sides) { bound in
                    Section(bound.side == "before" ? "Recorded after this block" : "Recorded before this block") {
                        if let n = bound.blockNumber { Field(label: "Block", value: "#\(G.count(n))") }
                        if let time = bound.blockTime { Field(label: "Block time", value: time, mono: true) }
                        /* A public block, with nothing of ours in the path: a
                         * convenience, never the evidence. The evidence is the
                         * header beside the anchor in the folder, whose
                         * keccak256 was recomputed before any time was shown. */
                        if let url = bound.etherscanUrl { Field(label: "Etherscan", value: url, link: true) }
                        if let contradiction = bound.contradiction { Field(label: "Contradiction", value: contradiction, tone: .fault) }
                        /* ⚠️ Whatever is missing says WHICH KIND of missing it
                         * is. "Not fetched" and "does not exist" are opposite
                         * claims and only one is about the holder. */
                        if bound.blockNumber == nil { Field(label: bound.state, value: bound.note, tone: .quiet) }
                    }
                }
            }
            /* Every byte this BitGraph rests on: see Raw.swift. */
            RawSection(proof: proof, committedB64: page.described.committedB64, evidenceRaw: page.described.evidenceRaw)
        }
    }

    // ── the window, from the anchors ────────────────────────────────────────

    /// ⚠️ Built ONLY from anchors whose header was checked. A block time read
    /// off an unverified header would be a time asserted from an untrusted
    /// source, which is the one thing this product does not do.
    private var whenLines: (date: String, window: String)? {
        let sides = page.checked?.bounds ?? []
        let before = sides.first { $0.side == "before" }?.blockTime.flatMap(Self.parse)
        let after = sides.first { $0.side == "after" }?.blockTime.flatMap(Self.parse)

        let dateOf: (Date) -> String = { d in
            let f = DateFormatter(); f.dateStyle = .long; f.timeStyle = .none
            return f.string(from: d)
        }
        let timeOf: (Date) -> String = { d in
            let f = DateFormatter(); f.dateStyle = .none; f.timeStyle = .medium
            return f.string(from: d)
        }

        switch (before, after) {
        case (.some(let a), .some(let b)):
            return Calendar.current.isDate(a, inSameDayAs: b)
                ? (dateOf(b), "between \(timeOf(a)) and \(timeOf(b))")
                : (dateOf(b), "between \(dateOf(a)) \(timeOf(a)) and \(dateOf(b)) \(timeOf(b))")
        case (.some(let a), .none):
            /* The upper side has not landed: the ellipsis is the whole story here. */
            return (dateOf(a), "between \(timeOf(a)) and …")
        case (.none, .some(let b)):
            return (dateOf(b), "between … and \(timeOf(b))")
        case (.none, .none):
            return nil
        }
    }

    // Reachable by the surface tests: these are decisions, not drawing.
    var whenLinesForTesting: (date: String, window: String)? { whenLines }
    var carriedByForTesting: String { carriedBy }
    var verdictLineForTesting: String { verdict.line }
    var verdictHeadlineForTesting: String { verdict.headline }
    var pendingWhyForTesting: String { pendingWhy }

    private static func parse(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
}

// ── the pieces ──────────────────────────────────────────────────────────────

extension View {
    /// A white card with a hairline border and Google's 12pt corners.
    func cardChrome() -> some View {
        self
            .background(RoundedRectangle(cornerRadius: G.zoneRadius).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: G.zoneRadius).strokeBorder(G.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: G.zoneRadius))
    }
}

/// A disclosure card: the title row is the toggle, a chevron turns when it
/// opens, and the row tints on hover like everything else here.
struct Card<Content: View>: View {
    let title: String
    var defaultOpen: Bool = false
    /* ⚠️ A CLOSURE, CALLED ONLY WHEN OPEN. It used to be built in init, so a
     * folded Recording details still pretty-printed a 435 KB proof on every
     * pass over the page (Mike, 2026-09-10: "beach ball"). */
    let content: () -> Content
    @State private var open: Bool
    @State private var hovering = false

    init(title: String, defaultOpen: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.defaultOpen = defaultOpen
        self.content = content
        _open = State(initialValue: defaultOpen)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.easeOut(duration: 0.18)) { open.toggle() } } label: {
                HStack(spacing: 12) {
                    Text(title).font(G.label).foregroundStyle(G.ink)
                    Spacer(minLength: 12)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(G.secondary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(hovering ? G.hover : Color.white)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }

            if open {
                Rectangle().fill(G.border).frame(height: 1)
                VStack(alignment: .leading, spacing: 0) { content() }
            }
        }
        .cardChrome()
    }
}

/// A heading inside the Details card, with its fields under it.
struct Section<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(G.label)
                .foregroundStyle(G.blue)
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 4)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One value: the label above it, the value beneath, mono for anything hashed.
///
/// ⚠️ THE WHOLE ROW COPIES. Every value on this page is something somebody
/// needs to paste somewhere: a digest into a verifier, a counter into a
/// question. The row is the copy target and says "Copied!" in place of the
/// value for a moment.
///
/// ⚠️ A HASH NEVER WRAPS. It scrolls sideways instead.
struct Field: View {
    let label: String
    let value: String
    var mono: Bool = false
    var link: Bool = false
    var tone: Tone = .normal
    /// The last row of a plain card draws no hairline beneath itself.
    var last: Bool = false

    enum Tone { case normal, quiet, fault }

    @State private var copied = false
    @State private var hovering = false

    var body: some View {
        if !value.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(G.small)
                    .foregroundStyle(G.secondary)
                if mono {
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(copied ? "Copied!" : value)
                            .font(G.data)
                            .foregroundStyle(copied ? G.blue : valueColor)
                            .lineLimit(1)
                    }
                } else {
                    Text(copied ? "Copied!" : value)
                        .font(G.body)
                        .foregroundStyle(copied ? G.blue : (link ? G.blue : valueColor))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(hovering ? G.hover : Color.clear)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .onTapGesture { link ? open() : copy() }
            .help(link ? "Open in your browser" : "Click to copy")
            if !last { Rectangle().fill(G.border).frame(height: 1) }
        }
    }

    private var valueColor: Color {
        switch tone {
        case .fault: return G.red
        case .quiet: return G.secondary
        case .normal: return G.ink
        }
    }

    private func open() {
        guard let url = URL(string: value) else { return }
        NSWorkspace.shared.open(url)
    }

    private func copy() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
    }
}
