"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { formatFileSize } from "@/lib/bitgraph";
import {
  entriesFromDataTransfer, walkEntries,
  supportsDirectoryPicker, pickDirectory, type WalkedFile,
} from "@/lib/folder-check";

/* Creating a BitGraph is always a SELECTION of a file that already exists —
   no step in the process may create anything (doctrine, 2026-07-31). Two
   browser paths violate that by constructing bytes that exist nowhere:
   a photo taken through the OS file sheet's "Take Photo" (a temporary blob
   WebKit discards when the sheet closes) and raw clipboard-image data pasted
   with ⌘V (screenshot-to-clipboard, "copy image"). Recording either mints a
   permanent proof of bits the user can never produce again. The OS sheet's
   camera option cannot be suppressed while keeping the photo library, so
   ephemeral blobs are refused at intake instead. Both arrive with a generic
   constructed name and a seconds-old timestamp; real files and library picks
   carry their own names or dates, so the two signals together are the
   discriminator. A real file that happens to match just gets asked to be
   re-picked, which is harmless. */
const EPHEMERAL_NAME = /^image\.(png|jpe?g|gif|heic|heif|webp)$/i;
const isEphemeralBlob = (f: File) =>
  EPHEMERAL_NAME.test(f.name) && Date.now() - f.lastModified < 120_000;

interface FileDropProps {
  onFile?: (file: File) => void;
  file?: File | null;
  onClear?: () => void;
  /** Multi-file mode */
  multiple?: boolean;
  onFiles?: (files: File[]) => void;
  /** When set, a drop containing a DIRECTORY is walked read-only and handed
      over as a flat file list with relative paths — the drop zone detecting
      what it was given, no mode switch. Plain-file drops are untouched. */
  onFolder?: (walked: WalkedFile[]) => void;
  /** Progress while the dropped folder is being READ, before anything can be
      shown. `done` marks the last call; onFolder follows immediately after. */
  onFolderScan?: (files: number, done: boolean) => void;
  files?: File[];
  onRemoveFile?: (index: number) => void;
  onClearAll?: () => void;
  disabled?: boolean;
  accept?: string;
  hint?: string;
  /** Smaller, quieter line rendered beneath the hint */
  subhint?: string;
  /** When set, the empty state shows a blue CTA button with this label
      (instead of the icon + headline). The whole box still accepts drops. */
  buttonLabel?: string;
  /** When true, the empty state is JUST a big clickable shutter circle. */
  shutter?: boolean;
  /** Label for the browse link */
  browseLabel?: string;
  /** Drop-zone headline (proof pages say "Take another BitGraph") */
  headline?: string;
  /** Headline font size (CSS length/clamp). Defaults to the compact card size. */
  headlineSize?: string;
}

export function FileDrop({
  onFile,
  file,
  onClear,
  multiple,
  onFiles,
  onFolder,
  onFolderScan,
  files,
  onRemoveFile,
  onClearAll,
  disabled,
  accept,
  hint,
  subhint,
  buttonLabel,
  shutter,
  browseLabel = "browse",
  headline = "Take a BitGraph",
  headlineSize = "clamp(20px, 6vw, 24px)",
}: FileDropProps) {
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // A SECOND input, because one cannot do both jobs: `multiple` selects files
  // and will not select a folder (it opens it instead), `webkitdirectory`
  // selects a folder and returns everything under it. Dragging always allowed
  // both; choosing did not, which made the picker feel broken.
  /* ⚠️ The folder link EXISTS ONLY where showDirectoryPicker does, and that
     is deliberate: it is the difference between a browser asking to "view
     files" and a browser asking to UPLOAD them.

     A webkitdirectory input makes the browser put up "Upload 4 files to this
     site? ... Only do this if you trust the site." on a page whose whole
     claim is that nothing is uploaded. Explaining that dialog in advance was
     tried and confused people more than the dialog did; showing the dialog
     confused them too. So it is never triggered. Dragging a folder in works
     in every browser and raises nothing, which is why the copy leads with
     "Drag a folder".

     Brave is the case that proves it matters: Chromium, but the File System
     Access API is off for privacy, so it takes this path. Detection runs
     after mount because the server cannot know the answer. */
  const [canPickFolder, setCanPickFolder] = useState(false);
  useEffect(() => { setCanPickFolder(supportsDirectoryPicker()); }, []);

  const chooseFolder = useCallback(async () => {
    // No progress is reported until the first file arrives: the dialog is
    // open until then and nothing is happening, so announcing a read that
    // has not started would strand the caller's spinner on cancel.
    const walked = await pickDirectory((n) => onFolderScan?.(n, false));
    if (!walked) return; // cancelled: nothing was ever raised
    onFolderScan?.(walked.length, true);
    onFolder?.(walked);
  }, [onFolder, onFolderScan]);
  // Set when an intake refused an ephemeral blob (see selectExisting).
  const [refusedEphemeral, setRefusedEphemeral] = useState(false);

  const hasFiles = multiple ? (files && files.length > 0) : !!file;

  // Every intake (drop, picker, paste) passes through here: ephemeral blobs
  // are dropped and the refusal notice raised; a clean selection clears it.
  const selectExisting = useCallback((list: File[]): File[] => {
    const kept = list.filter((f) => !isEphemeralBlob(f));
    setRefusedEphemeral(kept.length !== list.length);
    return kept;
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragover(false);
      if (disabled) return;
      // Folder drops: the entry handles MUST be captured synchronously —
      // DataTransferItemList is neutered after the first await. Only a drop
      // that actually contains a directory takes this path (entries is null
      // otherwise); dataTransfer.files would show a folder as a useless
      // 0-byte pseudo-file, so walking is also the only correct reading.
      if (onFolder) {
        const entries = entriesFromDataTransfer(e.dataTransfer);
        if (entries) {
          // Say so IMMEDIATELY: the walk below is the one stretch of a big
          // drop with nothing on screen, and it is the longest.
          onFolderScan?.(0, false);
          void walkEntries(entries, (n) => onFolderScan?.(n, false)).then((walked) => {
            onFolderScan?.(walked.length, true);
            // Always handed over, even when empty, so the caller can retire
            // the reading state instead of spinning forever on a folder that
            // turned out to hold nothing.
            onFolder(walked);
          });
          return;
        }
      }
      const dropped = selectExisting(Array.from(e.dataTransfer.files));
      if (!dropped.length) return;
      if (multiple && onFiles) onFiles(dropped);
      else if (onFile) onFile(dropped[0]);
    },
    [onFile, onFiles, onFolder, onFolderScan, multiple, disabled, selectExisting]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const picked = selectExisting(Array.from(e.target.files));
      if (picked.length) {
        if (multiple && onFiles) onFiles(picked);
        else if (onFile) onFile(picked[0]);
      }
      // Reset input so the same file(s) can be re-selected
      e.target.value = "";
    },
    [onFile, onFiles, multiple, selectExisting]
  );

  // Clipboard paste: ⌘V / Ctrl-V from anywhere on the page picks the file up,
  // as long as no file is currently being processed.
  useEffect(() => {
    if (hasFiles || disabled) return;
    const handlePaste = (e: ClipboardEvent) => {
      const pastedAll = Array.from(e.clipboardData?.files || []);
      if (pastedAll.length === 0) return;
      e.preventDefault();
      // A pasted Finder/Explorer file is a selection of existing bytes; raw
      // clipboard-image data is a freshly constructed blob and gets refused.
      const pasted = selectExisting(pastedAll);
      if (pasted.length === 0) return;
      if (multiple && onFiles) onFiles(pasted);
      else if (onFile) onFile(pasted[0]);
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [hasFiles, disabled, multiple, onFile, onFiles, selectExisting]);

  const triggerBrowse = (e: React.MouseEvent) => {
    e.stopPropagation();
    inputRef.current?.click();
  };

  // Why the just-taken photo (or pasted image data) was not recorded. One
  // short line stating the rule, in the site's error red (same as the Roll
  // search error) since a selection was actively refused.
  const refusalNote = refusedEphemeral ? (
    <div
      className="mt-3 text-center"
      style={{
        color: "#dc2626", fontSize: "min(12px, 2.8vw)", lineHeight: 1.5,
        position: "relative", zIndex: 2,
      }}
    >
      Photos must be chosen from your camera roll or files.
    </div>
  ) : null;

  return (
    <div
      onClick={(e) => { if (!disabled && !hasFiles && e.target === e.currentTarget) inputRef.current?.click(); }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragover(true);
      }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}
      role={!hasFiles && !shutter ? "button" : undefined}
      tabIndex={!hasFiles && !disabled && !shutter ? 0 : -1}
      aria-label={!hasFiles && !shutter ? "Drop, paste, or click to select a file" : undefined}
      onKeyDown={(e) => {
        if (!hasFiles && !disabled && !shutter && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={
        shutter
          ? `relative flex flex-col items-center justify-center outline-none ${disabled ? "opacity-50" : ""}`
          : `
        h-full relative border-2 rounded-none transition-all duration-200 cursor-pointer flex items-center outline-none
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        ${dragover
          ? "border-[#0065A4] bg-[#f0f6ff] ring-2 ring-[#0065A4]/20 scale-[1.005]"
          : hasFiles
          /* Rest is a step darker than the card hairlines (#b3bac2, was
             #c3c8cf) so the box has presence sitting still. It deliberately
             does NOT start blue: blue is what hover means, and the light fill
             on top of blue is what dragging over means. Starting blue
             collapses those two rungs and leaves hover nothing to say. */
          ? "border-[#b3bac2] bg-white"
          : "border-[#b3bac2] bg-white hover:border-[#0065A4] hover:bg-[#fafbfd] focus-visible:border-[#0065A4] focus-visible:ring-2 focus-visible:ring-[#0065A4]/20"
        }
      `
      }
    >
      {/* File input covers the entire drop zone when no files are selected */}
      <input
        ref={inputRef}
        type="file"
        title=""
        accept={accept || "*/*"}
        multiple={multiple}
        onChange={handleInputChange}
        disabled={disabled}
        style={!hasFiles && !shutter ? {
          position: "absolute", inset: 0, width: "100%", height: "100%",
          opacity: 0, cursor: "pointer", zIndex: 1, fontSize: 0,
        } : {
          position: "absolute", width: 1, height: 1, opacity: 0, top: -9999, fontSize: 0,
        }}
      />

      {/* ── Multi-file mode: file list ── */}
      {multiple && files && files.length > 0 ? (
        <div className="w-full px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-text-tertiary font-medium">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                className="text-xs text-text-secondary hover:text-text transition-colors"
                disabled={disabled}
              >
                Add more
              </button>
              {onClearAll && (
                <button
                  onClick={(e) => { e.stopPropagation(); onClearAll(); }}
                  className="text-xs text-text-tertiary hover:text-text transition-colors"
                  disabled={disabled}
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
          <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center justify-between py-2 px-3 hover:bg-bg-subtle/50 group transition-colors">
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-text truncate block">{f.name}</span>
                  <span className="text-xs text-text-tertiary">{formatFileSize(f.size)}</span>
                </div>
                {onRemoveFile && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveFile(i); }}
                    className="text-xs text-text-tertiary hover:text-error transition-colors opacity-0 group-hover:opacity-100 ml-2 shrink-0"
                    disabled={disabled}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {refusalNote}
        </div>
      ) : /* ── Single-file mode: existing behavior ── */
      file ? (
        <div className="flex items-center justify-between px-6 py-5 w-full">
          <div>
            <div className="text-sm font-medium text-text">{file.name}</div>
            <div className="text-xs text-text-tertiary mt-0.5">
              {formatFileSize(file.size)}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear?.();
            }}
            className="text-xs text-text-tertiary hover:text-text transition-colors"
            disabled={disabled}
          >
            Remove
          </button>
        </div>
      ) : shutter ? (
        /* Shutter variant: a big clickable circle (the camera shutter) with the
           action name under it. No box chrome. Clicking the shutter opens the
           picker; drag-and-drop and paste still work on the element. */
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
            disabled={disabled}
            aria-label={headline}
            className="fd-shutter"
          >
            <span className="fd-shutter-core">
              <span className="fd-shutter-label">{headline}</span>
            </span>
          </button>
          {hint && (
            <div className="mt-4 text-center" style={{ color: "#4b5563", fontSize: "min(12.5px, 2.9vw)", lineHeight: 1.5, whiteSpace: "pre-line" }}>{hint}</div>
          )}
          {refusalNote}
        </div>
      ) : buttonLabel ? (
        /* Button variant: a single blue CTA. It sits above the invisible
           full-box input overlay (z-index) and opens the picker on click; the
           surrounding box still accepts drops. */
        <div className="flex flex-col items-center py-8 px-4 sm:px-6 w-full">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
            disabled={disabled}
            className="relative z-[2] cursor-pointer rounded-none border-none bg-[#0065A4] text-white transition-colors hover:bg-[#005089]"
            style={{ padding: "14px 26px", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", fontFamily: "inherit" }}
          >
            {buttonLabel}
          </button>
          {hint && (
            <div className="mt-4 text-center" style={{ color: "#111827", fontSize: "min(13px, 3vw)", lineHeight: 1.5, whiteSpace: "pre-line" }}>{hint}</div>
          )}
          {subhint && (
            <div className="mt-1.5 text-center" style={{ color: "#4b5563", fontSize: "min(12px, 2.8vw)", lineHeight: 1.5, whiteSpace: "pre-line" }}>{subhint}</div>
          )}
          {refusalNote}
        </div>
      ) : (
        <div className="flex flex-col items-center py-8 px-4 sm:px-6 w-full">
          {/* Icon: a document with a plus — "select a file". Square corners, no
              round caps. The stroke must read 2.25 SCREEN px at every render
              size, matching the chevrons; vector-effect: non-scaling-stroke was
              tried and browsers disagreed (Chromium honored it and drew thin,
              others scaled the stroke fat). So the weight is baked into user
              units instead — geometry scaling is identical in every engine:
              1.227 here covers the 44px mobile size (2.25 / (44/24)), and
              .fd-icon's desktop media query overrides to 1.038 for 52px.
              Not a download/upload arrow: the file never leaves the device. */}
          <div className="mb-4">
            <svg className="fd-icon" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#0065A4" strokeWidth="1.227">
              <path d="M5 2 H14 L19 7 V22 H5 Z" />
              <path d="M14 2 V7 H19" />
              <line x1="12" y1="12" x2="12" y2="18" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <div
            className="fd-headline tracking-tight text-center"
            style={{
              color: "#111827",
              // Size/weight are overridable per-breakpoint via CSS custom
              // properties (the home hero bumps both on desktop); fall back to
              // the prop size and medium weight elsewhere.
              fontSize: `var(--fd-headline, ${headlineSize})`,
              fontWeight: "var(--fd-weight, 500)",
              whiteSpace: "nowrap",
            }}
          >
            {headline}
          </div>
          {/* Supporting copy under the action: the privacy line first (the
              file stays local), then a smaller, quieter line about automatic
              recognition of files already on record. */}
          {hint && (
            <div
              className="mt-4 text-center"
              style={{
                // Color and size are overridable per-instance (the home box grays
                // both lines and matches them to the explainer's size). Defaults
                // unchanged for the maker/proof FileDrops.
                color: "var(--fd-hint, #111827)",
                fontSize: "var(--fd-hint-size, min(13px, 3vw))",
                lineHeight: 1.5,
                whiteSpace: "pre-line",
              }}
            >
              {hint}
            </div>
          )}
          {subhint && (
            <div
              className="mt-1.5 text-center"
              style={{
                color: "var(--fd-subhint, #4b5563)",
                fontSize: "var(--fd-subhint-size, min(12px, 2.8vw))",
                lineHeight: 1.5,
                whiteSpace: "pre-line",
              }}
            >
              {subhint}
            </div>
          )}
          {/* Clicking the box opens the FILE picker, which cannot select a
              folder. This is the way to hand over a whole one without
              dragging. A text link, not a button. */}
          {onFolder && canPickFolder && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void chooseFolder(); }}
                disabled={disabled}
                className="mt-2 relative z-[2]"
                style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  color: "#0065A4", fontWeight: 500, fontFamily: "inherit",
                  fontSize: "var(--fd-subhint-size, min(12px, 2.8vw))",
                }}
              >
                or choose a folder
              </button>
            </>
          )}
          {refusalNote}
        </div>
      )}
    </div>
  );
}
