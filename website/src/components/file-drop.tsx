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
  /** Render a "take photo" link that opens the camera on mobile */
  showCapture?: boolean;
  /** Label for the browse link */
  browseLabel?: string;
  /** Label for the capture link */
  captureLabel?: string;
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
  showCapture,
  browseLabel = "browse",
  captureLabel = "take photo",
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
      role={!hasFiles ? "button" : undefined}
      tabIndex={!hasFiles && !disabled ? 0 : -1}
      aria-label={!hasFiles ? "Drop, paste, or click to select a file" : undefined}
      onKeyDown={(e) => {
        if (!hasFiles && !disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={`
        h-full relative border-2 rounded-none transition-all duration-200 cursor-pointer flex items-center outline-none
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        ${dragover
          ? "border-[#0065A4] bg-[#f0f6ff] ring-2 ring-[#0065A4]/20 scale-[1.005]"
          : hasFiles
          ? "border-[#c3c8cf] bg-white"
          : "border-[#c3c8cf] bg-white hover:border-[#0065A4] hover:bg-[#fafbfd] focus-visible:border-[#0065A4] focus-visible:ring-2 focus-visible:ring-[#0065A4]/20"
        }
      `}
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
        style={!hasFiles ? {
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
      ) : (
        <div className="flex flex-col items-center py-8 px-4 sm:px-6 w-full">
          {/* Headline first: name the gesture, then the arrow points down into
              the tray where the file goes. */}
          <div
            className="mb-4 font-semibold tracking-tight text-center"
            style={{
              color: "#111827",
              fontSize: "min(20px, 4vw)",
              whiteSpace: "nowrap",
            }}
          >
            Take a BitGraph
          </div>
          <div>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#0065A4" strokeWidth="1.5">
              <path d="M21 15 V21 H3 V15" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          {/* One gesture, two outcomes: the arrow and the clickable box carry
              the mechanics, so no "drop or click" boilerplate; the only line
              under the headline is the one that says something (the hint). */}
          {hint && (
            <div
              className="mt-2 text-center"
              style={{
                color: "#111827",
                fontSize: "min(13px, 3vw)",
                lineHeight: 1.5,
                whiteSpace: "pre-line",
              }}
            >
              {hint}
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
