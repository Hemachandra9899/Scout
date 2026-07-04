"use client";

import { useEffect, useState, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Memory {
  id: string;
  projectId: string;
  userId: string | null;
  scope: string;
  kind: string;
  text: string;
  entities: string[];
  sourceUrls: string[];
  confidence: number;
  eventTime: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface MemoryGraphProps {
  projectId: string;
  onClose: () => void;
}

export function MemoryGraph({ projectId, onClose }: MemoryGraphProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [kindFilter, setKindFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [selected, setSelected] = useState<Memory | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchMemories = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ projectId });
      if (kindFilter) params.set("kind", kindFilter);
      if (scopeFilter) params.set("scope", scopeFilter);
      const res = await fetch(`${API_URL}/memories?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMemories(data.memories);
      setTotal(data.total);
    } catch {
      // silent
    } finally {
      setBusy(false);
    }
  }, [projectId, kindFilter, scopeFilter]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const kindBadgeClass = (kind: string) => {
    const map: Record<string, string> = {
      preference: "preference",
      durable_fact: "durable_fact",
      source_quality: "source_quality",
      decision: "decision",
      task_trace: "task_trace",
    };
    return map[kind] || "";
  };

  return (
    <div className="app-panel">
      <div className="memory-graph-container">
        {/* Header */}
        <div className="memory-graph-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9z" />
            </svg>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Memory Graph</h2>
            <span style={{ fontSize: 12, color: "var(--muted)", background: "var(--panel2)", border: "1px solid var(--line-2)", borderRadius: 6, padding: "2px 8px" }}>
              {busy ? "Loading…" : `${memories.length} / ${total}`}
            </span>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close memory graph">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Filters */}
        <div className="memory-graph-filters">
          <select
            className="memory-graph-filter-select"
            value={kindFilter}
            onChange={(e) => { setKindFilter(e.target.value); setSelected(null); }}
            aria-label="Filter by kind"
          >
            <option value="">All kinds</option>
            <option value="preference">Preference</option>
            <option value="fact">Fact</option>
            <option value="durable_fact">Durable Fact</option>
            <option value="source_quality">Source Quality</option>
            <option value="source_failure">Source Failure</option>
            <option value="decision">Decision</option>
            <option value="task_trace">Task Trace</option>
          </select>
          <select
            className="memory-graph-filter-select"
            value={scopeFilter}
            onChange={(e) => { setScopeFilter(e.target.value); setSelected(null); }}
            aria-label="Filter by scope"
          >
            <option value="">All scopes</option>
            <option value="user">User</option>
            <option value="project">Project</option>
            <option value="session">Session</option>
            <option value="agent">Agent</option>
            <option value="source">Source</option>
          </select>
          <button
            className="smallButton"
            onClick={fetchMemories}
            style={{ marginLeft: "auto" }}
          >
            ↻ Refresh
          </button>
        </div>

        {/* Body: list + detail */}
        <div className="memory-graph-body">
          {/* List */}
          <div className="memory-graph-list">
            {!busy && memories.length === 0 && (
              <div className="memory-detail-empty" style={{ padding: 20, textAlign: "center" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" style={{ margin: "0 auto 8px" }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                </svg>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>No memories found</div>
              </div>
            )}
            {busy && (
              <div style={{ padding: 20, display: "flex", justifyContent: "center" }}>
                <div className="spinner" />
              </div>
            )}
            {memories.map((m) => (
              <button
                key={m.id}
                className={`memory-graph-item ${selected?.id === m.id ? "selected" : ""}`}
                onClick={() => setSelected(selected?.id === m.id ? null : m)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className={`memory-kind-badge ${kindBadgeClass(m.kind)}`}>
                    {m.kind.replace("_", " ")}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: "auto" }}>
                    {(m.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <span className="memory-graph-text">{m.text}</span>
                <span className="memory-graph-meta">
                  {m.scope} · {new Date(m.createdAt).toLocaleDateString()}
                  {m.entities?.length ? ` · ${m.entities.length} entities` : ""}
                </span>
              </button>
            ))}
          </div>

          {/* Detail panel */}
          <div className="memory-graph-detail">
            {!selected ? (
              <div className="memory-detail-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--line-2)" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9z" />
                </svg>
                <span style={{ fontSize: 14, color: "var(--muted)", marginTop: 8 }}>
                  Select a memory to view details
                </span>
              </div>
            ) : (
              <div className="memory-detail-body">
                <div className="memory-detail-header">
                  <span className={`memory-kind-badge ${kindBadgeClass(selected.kind)}`}>
                    {selected.kind.replace("_", " ")}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
                    {selected.scope}
                  </span>
                </div>

                <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--text)", marginBottom: 20 }}>
                  {selected.text}
                </p>

                {/* Confidence */}
                <div className="memory-detail-section">
                  <h4>Confidence</h4>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="memory-confidence-bar" style={{ flex: 1 }}>
                      <div
                        className="memory-confidence-fill"
                        style={{ width: `${(selected.confidence * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="value">{(selected.confidence * 100).toFixed(1)}%</span>
                  </div>
                </div>

                {/* Entities */}
                {selected.entities?.length > 0 && (
                  <div className="memory-detail-section">
                    <h4>Entities</h4>
                    <div className="memory-entity-tags">
                      {selected.entities.map((e) => (
                        <span key={e} className="memory-entity-tag">{e}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Source URLs */}
                {selected.sourceUrls?.length > 0 && (
                  <div className="memory-detail-section">
                    <h4>Sources ({selected.sourceUrls.length})</h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {selected.sourceUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 12, color: "var(--cyan)", wordBreak: "break-all" }}
                        >
                          {url}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* User */}
                {selected.userId && (
                  <div className="memory-detail-section">
                    <h4>User</h4>
                    <span className="value">{selected.userId}</span>
                  </div>
                )}

                {/* Event time */}
                {selected.eventTime && (
                  <div className="memory-detail-section">
                    <h4>Event Time</h4>
                    <span className="value">{new Date(selected.eventTime).toLocaleString()}</span>
                  </div>
                )}

                {/* Created */}
                <div className="memory-detail-section">
                  <h4>Created</h4>
                  <span className="value">{new Date(selected.createdAt).toLocaleString()}</span>
                </div>

                {/* Raw metadata */}
                {selected.metadata && Object.keys(selected.metadata).length > 0 && (
                  <details style={{ marginTop: 16 }}>
                    <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
                      Raw metadata
                    </summary>
                    <pre style={{ background: "#0a0a0a", color: "#6ee7b7", fontSize: 11, padding: 12, borderRadius: 8, marginTop: 8, maxHeight: 200, overflow: "auto", border: "1px solid var(--line-2)" }}>
                      {JSON.stringify(selected.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
