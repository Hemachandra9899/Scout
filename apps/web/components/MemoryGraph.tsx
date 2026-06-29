"use client";

import { useEffect, useState, useCallback } from "react";

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
      const res = await fetch(`http://localhost:8000/memories?${params}`);
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
        <div className="memory-graph-header">
          <h2 style={{ margin: 0, fontSize: 16 }}>Memory Graph</h2>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="memory-graph-filters">
          <select className="memory-graph-filter-select" value={kindFilter} onChange={(e) => { setKindFilter(e.target.value); setSelected(null); }}>
            <option value="">All kinds</option>
            <option value="preference">Preference</option>
            <option value="fact">Fact</option>
            <option value="durable_fact">Durable Fact</option>
            <option value="source_quality">Source Quality</option>
            <option value="source_failure">Source Failure</option>
            <option value="decision">Decision</option>
            <option value="task_trace">Task Trace</option>
          </select>
          <select className="memory-graph-filter-select" value={scopeFilter} onChange={(e) => { setScopeFilter(e.target.value); setSelected(null); }}>
            <option value="">All scopes</option>
            <option value="user">User</option>
            <option value="project">Project</option>
            <option value="session">Session</option>
            <option value="agent">Agent</option>
            <option value="source">Source</option>
          </select>
          <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>
            {busy ? "Loading..." : `${memories.length} / ${total}`}
          </span>
        </div>

        <div className="memory-graph-nodes" style={{ flex: 1, overflowY: "auto" }}>
          {memories.map((m) => (
            <div
              key={m.id}
              className="memory-node-card"
              style={{ borderColor: selected?.id === m.id ? "var(--lime)" : undefined }}
              onClick={() => setSelected(selected?.id === m.id ? null : m)}
            >
              <span className={`memory-node-kind ${kindBadgeClass(m.kind)}`}>
                {m.kind}
              </span>
              <span className="memory-node-text">{m.text}</span>
              <div className="memory-node-meta">
                <span>{m.scope}</span>
                <span>{(m.confidence * 100).toFixed(0)}%</span>
                <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                {m.entities?.length ? <span>{m.entities.length} entities</span> : null}
              </div>
            </div>
          ))}
          {!busy && memories.length === 0 && (
            <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>
              No memories found
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="memory-node-detail">
          <button className="memory-detail-close" onClick={() => setSelected(null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="memory-detail-field">
            <span className="memory-detail-label">Text</span>
            <span className="memory-detail-value">{selected.text}</span>
          </div>
          <div className="memory-detail-field">
            <span className="memory-detail-label">Kind</span>
            <span className="memory-detail-value">{selected.kind}</span>
          </div>
          <div className="memory-detail-field">
            <span className="memory-detail-label">Scope</span>
            <span className="memory-detail-value">{selected.scope}</span>
          </div>
          <div className="memory-detail-field">
            <span className="memory-detail-label">Confidence</span>
            <span className="memory-detail-value">{(selected.confidence * 100).toFixed(0)}%</span>
          </div>
          {selected.userId && (
            <div className="memory-detail-field">
              <span className="memory-detail-label">User</span>
              <span className="memory-detail-value">{selected.userId}</span>
            </div>
          )}
          {selected.sourceUrls?.length > 0 && (
            <div className="memory-detail-field">
              <span className="memory-detail-label">Sources</span>
              <div className="memory-detail-value">
                {selected.sourceUrls.map((url) => (
                  <div key={url} style={{ fontSize: 11, wordBreak: "break-all" }}>
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
                      {url}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
          {selected.entities?.length > 0 && (
            <div className="memory-detail-field">
              <span className="memory-detail-label">Entities</span>
              <div className="memory-detail-value">
                {selected.entities.join(", ")}
              </div>
            </div>
          )}
          <div className="memory-detail-field">
            <span className="memory-detail-label">Created</span>
            <span className="memory-detail-value">{new Date(selected.createdAt).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
