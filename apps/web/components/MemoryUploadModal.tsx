"use client";

import { useState } from "react";

interface MemoryUploadModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export function MemoryUploadModal({ open, onClose, projectId }: MemoryUploadModalProps) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("fact");
  const [scope, setScope] = useState("user");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function handleSubmit() {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("http://localhost:8000/memories/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, text: text.trim(), kind, scope }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const data = await res.json();
      setResult({ ok: true, message: `Memory saved (${data.written} written).` });
      setText("");
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="memory-upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="memory-upload-header">
          <h2>Upload Memory</h2>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="memory-upload-body">
          <textarea
            placeholder="Enter a durable fact, preference, or observation..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="memory-upload-row">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="fact">Fact</option>
              <option value="preference">Preference</option>
              <option value="durable_fact">Durable Fact</option>
              <option value="decision">Decision</option>
              <option value="task_trace">Task Trace</option>
            </select>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="user">User</option>
              <option value="project">Project</option>
              <option value="session">Session</option>
              <option value="agent">Agent</option>
              <option value="source">Source</option>
            </select>
          </div>

          <button className="memory-upload-btn" onClick={handleSubmit} disabled={busy || !text.trim()}>
            {busy ? "Saving..." : "Save Memory"}
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
