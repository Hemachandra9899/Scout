"use client";

import { useState, useEffect, useRef } from "react";

interface TraceEvent {
  id: string;
  timestamp: string;
  elapsedMs: number;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface AgentRunsPanelProps {
  projectId: string;
  onClose: () => void;
}

export function AgentRunsPanel({ projectId, onClose }: AgentRunsPanelProps) {
  const [query, setQuery] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const eventsRef = useRef<TraceEvent[]>([]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  async function startRun() {
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    setEvents([]);
    setStatus("starting");
    try {
      const res = await fetch("http://localhost:8000/agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, query: query.trim() }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const data = await res.json();
      setRunId(data.runId);
      setStatus("running");
      connectSSE(data.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("idle");
      setBusy(false);
    }
  }

  function connectSSE(id: string) {
    const source = new EventSource(`http://localhost:8000/agents/runs/${id}/events`);

    source.addEventListener("agent_started", (e) => {
      const event = JSON.parse(e.data) as TraceEvent;
      eventsRef.current = [...eventsRef.current, event];
      setEvents([...eventsRef.current]);
    });

    source.addEventListener("step_started", (e) => {
      const event = JSON.parse(e.data) as TraceEvent;
      eventsRef.current = [...eventsRef.current, event];
      setEvents([...eventsRef.current]);
    });

    source.addEventListener("step_completed", (e) => {
      const event = JSON.parse(e.data) as TraceEvent;
      eventsRef.current = [...eventsRef.current, event];
      setEvents([...eventsRef.current]);
    });

    source.addEventListener("step_failed", (e) => {
      const event = JSON.parse(e.data) as TraceEvent;
      eventsRef.current = [...eventsRef.current, event];
      setEvents([...eventsRef.current]);
    });

    source.addEventListener("budget_exceeded", (e) => {
      const event = JSON.parse(e.data) as TraceEvent;
      eventsRef.current = [...eventsRef.current, event];
      setEvents([...eventsRef.current]);
    });

    source.addEventListener("agent_completed", (e) => {
      const event = JSON.parse(e.data) as TraceEvent;
      eventsRef.current = [...eventsRef.current, event];
      setEvents([...eventsRef.current]);
      setStatus("completed");
      setBusy(false);
      source.close();
    });

    source.addEventListener("agent_failed", (e) => {
      const event = JSON.parse(e.data) as TraceEvent;
      eventsRef.current = [...eventsRef.current, event];
      setEvents([...eventsRef.current]);
      setStatus("failed");
      setBusy(false);
      source.close();
    });

    source.addEventListener("run_completed", () => {
      setStatus("completed");
      setBusy(false);
      source.close();
    });

    source.addEventListener("run_failed", () => {
      setStatus("failed");
      setBusy(false);
      source.close();
    });

    source.onerror = () => {
      setStatus("failed");
      setError("SSE connection failed");
      setBusy(false);
      source.close();
    };
  }

  const dotClass = (type: string) => {
    if (type === "step_completed" || type === "agent_completed") return "completed";
    if (type === "step_failed" || type === "agent_failed" || type === "budget_exceeded") return "failed";
    if (type === "step_started" || type === "agent_started") return "running";
    return "pending";
  };

  return (
    <div className="app-panel">
      <div className="agent-runs-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Agent Runs</h2>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a query for the agent executor..."
            style={{
              flex: 1,
              background: "var(--panel2)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              color: "var(--text)",
              padding: "8px 12px",
              fontSize: 13,
              outline: "none",
            }}
            onKeyDown={(e) => { if (e.key === "Enter") startRun(); }}
          />
          <button
            className="memory-upload-btn"
            onClick={startRun}
            disabled={busy || !query.trim()}
          >
            {busy ? "Running..." : "Run"}
          </button>
        </div>

        {status !== "idle" && (
          <div className="agent-run-card">
            <div className="agent-run-header">
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{runId?.slice(0, 8)}</span>
              <span className={`agent-run-status ${status}`}>{status}</span>
            </div>
            <div className="agent-run-steps">
              {events.map((ev) => (
                <div key={ev.id} className="agent-step-item">
                  <span className={`agent-step-dot ${dotClass(ev.type)}`} />
                  <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 40 }}>
                    {(ev.elapsedMs / 1000).toFixed(1)}s
                  </span>
                  <span style={{ fontSize: 12 }}>{ev.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div style={{ color: "var(--bad)", fontSize: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
