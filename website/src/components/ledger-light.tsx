"use client";

/* Is your BitGraphs folder connected? — a light in the corner, on every page.
 *
 * Mike's call, and it overrides two standing rules on purpose. "A count, never
 * a dot" and "nothing red" were both his, made the same day, and he changed
 * them once he had used the thing: "not connected should be red and connected
 * should be green and clicking it should open a nice modal asking for the
 * location of your BitGraph folder. no amount of proofs needed and no dialog
 * in dropbox."
 *
 * So: no count, no line inside the drop box, and a literal red/green light.
 * The reasoning that produced the old rules was that not-connected is the
 * normal first state rather than a fault — which is true, and is exactly why
 * the light is a DOOR: it is the one place that tells you what is missing and
 * lets you fix it in the same gesture.
 *
 * ⚠️ A PAGE CANNOT ASK FOR A PATH. There is no way for a web page to be told
 * "/Users/you/BitGraphs" and read it; the File System Access API is the only
 * thing close and it needs a permission grant, cannot reach a folder's parent,
 * and does not exist in Brave, Safari or Firefox. So the modal asks for the
 * folder the only way a browser allows: you drag it in. The copy says that
 * plainly rather than pretending to a file dialog it cannot open.
 */

import { useCallback, useEffect, useState } from "react";
import { loadLedger, addProofs, readBitGraphsFiles, saveLedger, emptyLedger } from "@/lib/local-ledger";
import { buildBitGraphsFile } from "@/lib/bitgraphs-file";
import { entriesFromDataTransfer, walkEntries } from "@/lib/folder-check";
import { fusedMarkerOf } from "@/lib/fuse-client";

/** Fired whenever the connected ledger changes, so the light updates without
 *  a navigation — connecting happens here and in the camera. */
export const LEDGER_CHANGED = "bitgraph:ledger-changed";

const originOf = (p: Parameters<typeof fusedMarkerOf>[0]) => {
  try { return fusedMarkerOf(p)?.originDigestB64 ?? null; } catch { return null; }
};

export function LedgerLight() {
  // null = not read yet, so the first paint says nothing rather than flashing
  // red at someone who is connected.
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useCallback(() => {
    void loadLedger().then((l) => setCount(l.proofs.length));
  }, []);

  useEffect(() => {
    read();
    window.addEventListener(LEDGER_CHANGED, read);
    window.addEventListener("focus", read);
    return () => {
      window.removeEventListener(LEDGER_CHANGED, read);
      window.removeEventListener("focus", read);
    };
  }, [read]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  /* Connecting: read every BitGraphs file in what was dropped and fold it in.
     ⚠️ THIS CANNOT MINT. It only parses JSON already on the machine. */
  const connect = async (dt: DataTransfer) => {
    setBusy(true);
    try {
      const entries = entriesFromDataTransfer(dt);
      const files = entries ? (await walkEntries(entries)).map((w) => w.file) : Array.from(dt.files);
      const { proofs, sources } = await readBitGraphsFiles(files);
      if (!proofs.length) return;
      const next = addProofs(await loadLedger(originOf), proofs, sources[0] ?? null, originOf);
      await saveLedger(next);
      setCount(next.proofs.length);
      window.dispatchEvent(new Event(LEDGER_CHANGED));
      setOpen(false);
    } finally {
      setBusy(false);
      setDragging(false);
    }
  };

  /* The one place a copy is written to disk, because it is the one place you
     asked for one. A make writes to this browser and nothing else: doing it on
     every make meant a save dialog every time for anyone with "ask where to
     save each file" on, which is a modal in front of the product's main
     gesture. */
  const saveCopy = async () => {
    const l = await loadLedger(originOf);
    const doc = buildBitGraphsFile(l.proofs.map((p) => ({ proof: p, proofs: [p] })), "your BitGraphs");
    if (!doc.proofs.length) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bitgraphs.json";
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const forget = async () => {
    await saveLedger(emptyLedger());
    setCount(0);
    window.dispatchEvent(new Event(LEDGER_CHANGED));
  };

  if (count === null) return null;
  const on = count > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={on ? "Your BitGraphs folder is connected" : "No BitGraphs folder connected"}
        aria-label={on ? "BitGraphs folder connected" : "No BitGraphs folder connected"}
        style={{
          display: "flex", alignItems: "center", gap: 7, padding: 0,
          background: "none", border: "none", cursor: "pointer",
          fontSize: 13, fontWeight: 700, fontFamily: "inherit",
          color: "#111827", whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 9, height: 9, borderRadius: "50%", flex: "none",
            background: on ? "#16a34a" : "#dc2626",
          }}
        />
        {/* Names the noun. Under the box this is the only line there is, so
            "Connected" alone would not say connected to WHAT. */}
        {on ? "Folder connected" : "Folder not connected"}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 60,
            background: "rgba(17,24,39,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); void connect(e.dataTransfer); }}
            style={{
              background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0,
              width: "min(480px, 100%)", padding: 24,
              /* ⚠️ SET EXPLICITLY, DO NOT INHERIT. The light lives inside a
                 centring wrapper under the box on home, so every line in here
                 was arriving centred no matter what the card said — the whole
                 modal read as a poster. The drop zone below sets its own
                 centre, because a target's label centred is what says it is a
                 target. */
              textAlign: "left",
            }}
          >
            {/* Left-aligned throughout (Mike), except the drop zone's own
                label: that one is a target, and a centred label is what says
                so. Everything else is prose, and prose read against a ragged
                left edge is slower — the site sets every other card this way. */}
            <div style={{ fontSize: 17, fontWeight: 800, color: "#111827", marginBottom: 6, letterSpacing: "-0.01em" }}>
              Your BitGraphs folder
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "#4b5563", marginBottom: 16 }}>
              {on
                ? `${count.toLocaleString()} BitGraph${count === 1 ? " is" : "s are"} kept in this browser. Save a copy to keep ${count === 1 ? "it" : "them"} somewhere you back up — a browser can clear its storage without asking.`
                : "Nothing connected yet. Drag in a folder of BitGraphs files, or make one and it is kept here."}
            </div>
            <div
              style={{
                border: `1px dashed ${dragging ? "#16a34a" : "#b3bac2"}`,
                padding: "30px 20px", textAlign: "center",
                fontSize: 13.5, fontWeight: 600,
                color: dragging ? "#16a34a" : "#4b5563",
                background: dragging ? "rgba(22,163,74,0.05)" : "transparent",
              }}
            >
              {busy ? "Reading…" : "Drag your BitGraphs folder here"}
            </div>
            {/* Said once, plainly, instead of implying a file dialog that a web
                page is not allowed to open. */}
            <div style={{ fontSize: 12, lineHeight: 1.55, color: "#6b7280", marginTop: 10 }}>
              A web page cannot browse your disk or be told a path, so dragging is
              the way in. Nothing is uploaded and nothing is recorded.
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, marginTop: 20 }}>
              {on ? (
                <button type="button" onClick={() => void saveCopy()} className="bg-action-link" style={{ padding: 0, fontSize: 13 }}>
                  <span>Save a copy</span>
                  <span className="arrow" aria-hidden>&rarr;</span>
                </button>
              ) : <span />}
              <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                {on && (
                  <button type="button" onClick={() => void forget()}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                             fontFamily: "inherit", fontSize: 12.5, color: "#6b7280" }}>
                    Forget it
                  </button>
                )}
                <button type="button" onClick={() => setOpen(false)} className="bg-action-link" style={{ padding: 0, fontSize: 13 }}>
                  <span>Close</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
