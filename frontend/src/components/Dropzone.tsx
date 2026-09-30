"use client";

import { useRef, useState, type DragEvent } from "react";

const ACCEPTED_EXTENSIONS = [".csv", ".pdf"];

function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface DropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

/**
 * A8.2's drag-and-drop intake for either BVD export, plus a file-picker
 * fallback (T-42 step 42.1). Rejects a file whose extension is neither
 * `.csv` nor `.pdf` before any network call — a client only has the
 * filename to go on before it has sent the bytes, so `detectInvoiceFormat`'s
 * magic-byte check on the server stays the real authority for what actually
 * gets parsed.
 */
export default function Dropzone({ onFile, disabled = false }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  function handleFile(file: File): void {
    if (!hasAcceptedExtension(file.name)) {
      setRejection(`"${file.name}" isn't a CSV or PDF invoice export.`);
      return;
    }
    setRejection(null);
    onFile(file);
  }

  return (
    <div
      className={`import-dropzone${dragOver ? " import-dropzone-active" : ""}`}
      data-testid="dropzone"
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) inputRef.current?.click();
      }}
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.pdf"
        data-testid="file-input"
        style={{ display: "none" }}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleFile(file);
        }}
      />
      <div className="import-dropzone-title">Drop a BVD invoice here</div>
      <p className="import-dropzone-detail">
        The emailed PDF is preferred — it&rsquo;s the only export carrying express tractor and driver. The portal
        CSV is accepted too.
      </p>
      <span className="btn btn-ghost import-dropzone-browse">Browse file…</span>
      {rejection && (
        <p className="import-dropzone-rejection" data-testid="dropzone-rejection">
          {rejection}
        </p>
      )}
    </div>
  );
}
