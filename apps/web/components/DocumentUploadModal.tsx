"use client";

import { useState, useRef } from "react";

interface DocumentUploadModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export function DocumentUploadModal({ open, onClose, projectId }: DocumentUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  async function handleSubmit() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("projectId", projectId);
      formData.append("file", file);

      const res = await fetch("http://localhost:8000/tools/ingest-file", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const data = await res.json();
      setResult({ ok: true, message: `"${data.title}" ingested (${data.chunksCreated} chunks, ${data.embeddedChunks} embedded).` });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="document-upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="memory-upload-header">
          <h2>Upload Document</h2>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="document-upload-body">
          <input
            ref={inputRef}
            type="file"
            accept=".md,.txt,.pdf,.csv,.json,.yaml,.yml"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{
              background: "var(--panel2)",
              border: "1px solid var(--line)",
              borderRadius: "8px",
              color: "var(--text)",
              padding: "10px",
              fontSize: "13px",
              width: "100%",
            }}
          />

          <button
            className="memory-upload-btn"
            onClick={handleSubmit}
            disabled={busy || !file}
            style={{ alignSelf: "flex-end" }}
          >
            {busy ? "Ingesting..." : "Ingest Document"}
          </button>

          {result && (
            <div className={`memory-upload-result ${result.ok ? "success" : "error"}`}>
              {result.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
