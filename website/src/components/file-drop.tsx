"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { formatFileSize } from "@/lib/bitgraph";

interface FileDropProps {
  onFile?: (file: File) => void;
  file?: File | null;
  onClear?: () => void;
  /** Multi-file mode */
  multiple?: boolean;
  onFiles?: (files: File[]) => void;
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
  /** Render a "take photo" link that opens the camera on mobile */
  showCapture?: boolean;
  /** Label for the browse link */
  browseLabel?: string;
  /** Label for the capture link */
  captureLabel?: string;
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
  files,
  onRemoveFile,
  onClearAll,
  disabled,
  accept,
  hint,
  subhint,
  buttonLabel,
  shutter,
  showCapture,
  browseLabel = "browse",
  captureLabel = "take photo",
  headline = "Take a BitGraph",
  headlineSize = "clamp(20px, 6vw, 24px)",
}: FileDropProps) {
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);

  const hasFiles = multiple ? (files && files.length > 0) : !!file;

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragover(false);
      if (disabled) return;
      if (multiple && onFiles) {
        const dropped = Array.from(e.dataTransfer.files);
        if (dropped.length) onFiles(dropped);
      } else if (onFile && e.dataTransfer.files.length) {
        onFile(e.dataTransfer.files[0]);
      }
    },
    [onFile, onFiles, multiple, disabled]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      if (multiple && onFiles) {
        onFiles(Array.from(e.target.files));
      } else if (onFile) {
        onFile(e.target.files[0]);
      }
      // Reset input so the same file(s) can be re-selected
      e.target.value = "";
    },
    [onFile, onFiles, multiple]
  );

  // Clipboard paste: ⌘V / Ctrl-V from anywhere on the page picks the file up,
  // as long as no file is currently being processed.
  useEffect(() => {
    if (hasFiles || disabled) return;
    const handlePaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files || []);
      if (pasted.length === 0) return;
      e.preventDefault();
      if (multiple && onFiles) onFiles(pasted);
      else if (onFile) onFile(pasted[0]);
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [hasFiles, disabled, multiple, onFile, onFiles]);

  const triggerBrowse = (e: React.MouseEvent) => {
    e.stopPropagation();
    inputRef.current?.click();
  };

  const triggerCapture = (e: React.MouseEvent) => {
    e.stopPropagation();
    captureRef.current?.click();
  };

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
          ? "border-[#c3c8cf] bg-white"
          : "border-[#c3c8cf] bg-white hover:border-[#0065A4] hover:bg-[#fafbfd] focus-visible:border-[#0065A4] focus-visible:ring-2 focus-visible:ring-[#0065A4]/20"
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

      {/* Camera capture input (mobile) */}
      {showCapture && (
        <input
          ref={captureRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={handleInputChange}
          disabled={disabled}
        />
      )}

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
            <div className="mt-4 text-center" style={{ color: "#6b7280", fontSize: "min(12.5px, 2.9vw)", lineHeight: 1.5, whiteSpace: "pre-line" }}>{hint}</div>
          )}
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
            <div className="mt-1.5 text-center" style={{ color: "#6b7280", fontSize: "min(12px, 2.8vw)", lineHeight: 1.5, whiteSpace: "pre-line" }}>{subhint}</div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center py-8 px-4 sm:px-6 w-full">
          {/* Icon: a document with a plus — "select a file". Square corners, no
              round caps. non-scaling-stroke pins the stroke to 2.25 SCREEN px
              so it matches the chevrons: this svg renders at 44-52px from a
              24-unit viewBox, so a scaled stroke would draw ~3px and read
              heavier than every other icon.
              Not a download/upload arrow: the file never leaves the device. */}
          <div className="mb-4">
            <svg className="fd-icon" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#0065A4" strokeWidth="2.25" vectorEffect="non-scaling-stroke">
              <path d="M5 2 H14 L19 7 V22 H5 Z" vectorEffect="non-scaling-stroke" />
              <path d="M14 2 V7 H19" vectorEffect="non-scaling-stroke" />
              <line x1="12" y1="12" x2="12" y2="18" vectorEffect="non-scaling-stroke" />
              <line x1="9" y1="15" x2="15" y2="15" vectorEffect="non-scaling-stroke" />
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
                color: "var(--fd-subhint, #6b7280)",
                fontSize: "var(--fd-subhint-size, min(12px, 2.8vw))",
                lineHeight: 1.5,
                whiteSpace: "pre-line",
              }}
            >
              {subhint}
            </div>
          )}
          {showCapture && !hint && (
            <button
              onClick={triggerCapture}
              className="mt-6 text-center"
              style={{
                color: "#0065A4",
                fontSize: "min(12px, 2.8vw)",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
              }}
              disabled={disabled}
            >
              {captureLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
