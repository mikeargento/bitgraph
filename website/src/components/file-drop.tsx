"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { formatFileSize } from "@/lib/bitgraph";
import { useDashedEdges } from "@/lib/use-dashed-edges";
import {
  entriesFromDataTransfer, walkEntries, type WalkedFile, type DirHandle,
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
  /** A re-usable handle for the folder that was handed over, when the
      browser can produce one (Chromium, from a drop or the picker). This is
      what a caller stores so its next sync needs no drag. */
  onFolderHandle?: (handle: DirHandle) => void;
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
  onFolderHandle,
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
  headline = "Record a BitGraph",
  headlineSize = "clamp(20px, 6vw, 24px)",
}: FileDropProps) {
  const [dragover, setDragover] = useState(false);
  // The edges are painted (see use-dashed-edges), so hover and focus have to
  // be state rather than :hover/:focus-visible border classes.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const edges = useDashedEdges();
  const inputRef = useRef<HTMLInputElement>(null);
  // A SECOND input, because one cannot do both jobs: `multiple` selects files
  // and will not select a folder (it opens it instead), `webkitdirectory`
  // selects a folder and returns everything under it. Dragging always allowed
  // both; choosing did not, which made the picker feel broken.
  /* ⚠️ THERE IS NO "choose a folder" LINK, in any browser (Mike, 2026-08-07,
     after seeing both paths). Folders arrive by DRAGGING, full stop, which is
     why the copy says so out loud.

     Both ways of clicking to a folder were built and both were rejected on
     the same grounds. showDirectoryPicker (Chrome, Edge) raises "Let site
     view files?"; a webkitdirectory input (everyone else, including Brave,
     which is Chromium with the File System Access API off) raises "Upload N
     files to this site? ... Only do this if you trust the site." Nothing is
     ever uploaded, the files are read locally and only digests leave, but the
     browser picks that wording, not us, and an upload warning on a page whose
     whole claim is that nothing is uploaded costs more than the link is
     worth. Dragging raises no dialog anywhere.

     So: do not reintroduce the link, and do not reach for webkitdirectory to
     "fix" the file picker's inability to select a folder. That inability is
     the design. */
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
          // A drop can also yield a STORABLE handle (Chromium's
          // getAsFileSystemHandle), which is how "sync again without a drag"
          // gets its permission slip from an ordinary drag. Captured
          // synchronously, same rule as the entries: the item list is
          // neutered after the first await.
          const handlePromises: Array<Promise<unknown>> = [];
          if (onFolderHandle) {
            for (let i = 0; i < e.dataTransfer.items.length; i++) {
              const it = e.dataTransfer.items[i] as DataTransferItem & { getAsFileSystemHandle?: () => Promise<unknown> };
              if (typeof it.getAsFileSystemHandle === "function") handlePromises.push(it.getAsFileSystemHandle());
            }
          }
          // Say so IMMEDIATELY: the walk below is the one stretch of a big
          // drop with nothing on screen, and it is the longest.
          onFolderScan?.(0, false);
          void walkEntries(entries, (n) => onFolderScan?.(n, false)).then(async (walked) => {
            onFolderScan?.(walked.length, true);
            // Always handed over, even when empty, so the caller can retire
            // the reading state instead of spinning forever on a folder that
            // turned out to hold nothing.
            onFolder(walked);
            for (const hp of handlePromises) {
              try {
                const h = (await hp) as DirHandle | null;
                if (h && h.kind === "directory") { onFolderHandle?.(h); break; }
              } catch { /* this browser's drops are not storable; fine */ }
            }
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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => setFocused(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
      /* ⚠️ DASHED EDGES, drawn per edge by use-dashed-edges — the drop-target
         doctrine (2026-08-06): a dashed border means "this is where you drop
         files", every drop box wears it. Rest is a step darker than the card
         hairlines (#b3bac2) so the box has presence sitting still. It
         deliberately does NOT start blue: blue is what hover means, and the
         light fill on top of blue is what dragging over means. Starting blue
         collapses those two rungs and leaves hover nothing to say. */
      ref={edges.ref}
      style={shutter ? undefined : edges.edgeStyle(
        !disabled && (dragover || ((hovered || focused) && !hasFiles)) ? "#0065A4" : "#b3bac2",
      )}
      className={
        shutter
          ? `relative flex flex-col items-center justify-center outline-none ${disabled ? "opacity-50" : ""}`
          : `
        h-full relative rounded-none transition-all duration-200 cursor-pointer flex items-center outline-none
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        ${dragover
          ? "bg-[#f0f6ff] ring-2 ring-[#0065A4]/20 scale-[1.005]"
          : hasFiles
          ? "bg-white"
          : "bg-white hover:bg-[#fafbfd] focus-visible:ring-2 focus-visible:ring-[#0065A4]/20"
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
            <div className="mt-4 text-center" style={{ color: "#4b5563", fontSize: "min(12.5px, 2.9vw)", lineHeight: 1.5, whiteSpace: "pre-line", textWrap: "balance" }}>{hint}</div>
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
            <div className="mt-4 text-center" style={{ color: "#111827", fontSize: "min(13px, 3vw)", lineHeight: 1.5, whiteSpace: "pre-line", textWrap: "balance" }}>{hint}</div>
          )}
          {subhint && (
            <div className="mt-1.5 text-center" style={{ color: "#4b5563", fontSize: "min(12px, 2.8vw)", lineHeight: 1.5, whiteSpace: "pre-line", textWrap: "balance" }}>{subhint}</div>
          )}
          {refusalNote}
        </div>
      ) : (
        /* THE WHOLE BLOCK OF TEXT is centered in the frame, weighed as one
           thing: title plus every line under it, their combined height split
           evenly above and below. No mark: the drawn box is already the
           picture of where a file goes, so an icon inside it was saying the
           same thing a second time, quieter.

           An earlier pass centered the TITLE exactly and let the copy hang
           below it. That put the title at the frame's midpoint but left the
           block itself bottom-heavy, since everything else sat underneath.
           Centering the block is the composition; the title's own position
           falls out of it.

           The mechanism is the parent's align-items: center against a child
           of natural height, so nothing here may set a height or stretch.
           Padding stays symmetric for the same reason: an uneven pad would
           shift the block off the middle just as surely. */
        <div className="w-full px-4 sm:px-6 py-5 flex flex-col items-center">
          <div
            className="fd-headline tracking-tight text-center"
            style={{
              /* Black at rest, brand blue on hover or keyboard focus, driven
                 by the SAME state that turns the dashed edges blue, so the
                 title and the frame light up together and the box reads as
                 one object rather than two. It has to be state rather than a
                 :hover rule because the edges are painted, not bordered, and
                 the two must not be able to disagree. */
              color: (hovered || focused) && !disabled
                ? "var(--fd-title-hover, #0065A4)"
                : "var(--fd-title, #111827)",
              transition: "color .2s",
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

          {/* Below the title: the instruction, then the privacy fact. The gap
              is applied only when there is something to separate, so a caller
              passing neither line cannot leave a phantom margin behind and
              push the block off center. */}
          <div style={{ marginTop: hint || subhint ? "var(--fd-copy-gap, 20px)" : 0 }}>
            {hint && (
              <div
                className="text-center"
                style={{
                  // Color and size are overridable per-instance (the home box grays
                  // both lines and matches them to the explainer's size). Defaults
                  // unchanged for the maker/proof FileDrops.
                  color: "var(--fd-hint, #111827)",
                  fontSize: "var(--fd-hint-size, min(13px, 3vw))",
                  lineHeight: 1.5,
                  whiteSpace: "pre-line",
                  textWrap: "balance",
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
                  textWrap: "balance",
                }}
              >
                {subhint}
              </div>
            )}
            {refusalNote}
          </div>
        </div>
      )}
    </div>
  );
}
