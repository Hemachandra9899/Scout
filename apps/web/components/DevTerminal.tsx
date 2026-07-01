"use client";

import { useEffect, useRef, useState } from "react";
import type { ResearchJob } from "../lib/api";

interface DevTerminalProps {
  open: boolean;
  onClose: () => void;
  activeJob?: ResearchJob;
  answerText?: string;
}

type LogLevel = "system" | "agent" | "vector" | "rlm" | "output" | "error" | "info" | "step";

interface LogLine {
  id: string;
  time: string;
  tag: LogLevel;
  content: string;
  style?: "success" | "error" | "warn" | "dim";
}

function now(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function mkLog(tag: LogLevel, content: string, style?: LogLine["style"]): LogLine {
  return {
    id: Math.random().toString(36).slice(2),
    time: now(),
    tag,
    content,
    style,
  };
}

export function DevTerminal({ open, onClose, activeJob, answerText }: DevTerminalProps) {
  const [activeTab, setActiveTab] = useState<"logs" | "output" | "trace">("logs");
  const scrollRef = useRef<HTMLDivElement>(null);

  const logs = buildLogs(activeJob);

  // Auto-scroll to bottom
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, logs.length]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="dev-terminal-overlay" role="dialog" aria-label="Dev Terminal" aria-modal="true">
      {/* macOS-style title bar */}
      <div className="dev-terminal-bar">
        <div className="dev-terminal-bar-left">
          <div className="dev-terminal-dot red" />
          <div className="dev-terminal-dot yellow" />
          <div className="dev-terminal-dot green" />
          <span className="dev-terminal-title">
            scout-terminal — {activeJob ? `job:${activeJob.id.slice(0, 8)}` : "idle"} — 80×24
          </span>
        </div>
        <button className="dev-terminal-close" onClick={onClose} aria-label="Close terminal">
          ✕ close [esc]
        </button>
      </div>

      {/* Tab bar */}
      <div className="dev-terminal-tabs" role="tablist">
        {(["logs", "output", "trace"] as const).map((tab) => (
          <button
            key={tab}
            className={`dev-terminal-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
            role="tab"
            aria-selected={activeTab === tab}
          >
            {tab === "logs" && "🖥 Logs"}
            {tab === "output" && "📄 Output"}
            {tab === "trace" && "🔍 Trace"}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="dev-terminal-body">
        {activeTab === "logs" && (
          <div className="dev-terminal-scroll" ref={scrollRef}>
            {logs.length === 0 ? (
              <div className="dev-log-line">
                <span className="dev-log-time">{now()}</span>
                <span className="dev-log-tag info">INFO</span>
                <span className="dev-log-content dim">Waiting for research job… Type a question in the chat.</span>
              </div>
            ) : (
              logs.map((line) => (
                <div key={line.id} className="dev-log-line">
                  <span className="dev-log-time">{line.time}</span>
                  <span className={`dev-log-tag ${line.tag}`}>{line.tag.toUpperCase()}</span>
                  <span className={`dev-log-content${line.style ? ` ${line.style}` : ""}`}>
                    {line.content}
                  </span>
                </div>
              ))
            )}
            {activeJob && !["completed", "failed"].includes(activeJob.status?.toLowerCase() || "") && (
              <div className="dev-log-line">
                <span className="dev-log-time">{now()}</span>
                <span className="dev-log-tag rlm">RLM</span>
                <span className="dev-log-content">
                  Processing<span className="dev-terminal-cursor" />
                </span>
              </div>
            )}
          </div>
        )}

        {activeTab === "output" && (
          <div className="dev-terminal-scroll" ref={scrollRef}>
            {answerText ? (
              <>
                <div className="dev-log-line">
                  <span className="dev-log-time">{now()}</span>
                  <span className="dev-log-tag output">OUTPUT</span>
                  <span className="dev-log-content success">Research complete — report generated.</span>
                </div>
                <div style={{ marginTop: 16, padding: "0 4px" }}>
                  <div className="dev-report-header">▶ FINAL REPORT</div>
                  <div className="dev-report-content">{answerText}</div>
                </div>
              </>
            ) : (
              <div className="dev-log-line">
                <span className="dev-log-time">{now()}</span>
                <span className="dev-log-tag info">INFO</span>
                <span className="dev-log-content dim">No output yet. Run a research query.</span>
              </div>
            )}
          </div>
        )}

        {activeTab === "trace" && (
          <div className="dev-terminal-scroll" ref={scrollRef}>
            {activeJob ? (
              <>
                <div className="dev-log-line">
                  <span className="dev-log-time">{now()}</span>
                  <span className="dev-log-tag system">SYSTEM</span>
                  <span className="dev-log-content">Job ID: <span style={{ color: "#06b6d4" }}>{activeJob.id}</span></span>
                </div>
                <div className="dev-log-line">
                  <span className="dev-log-time">{now()}</span>
                  <span className="dev-log-tag system">SYSTEM</span>
                  <span className="dev-log-content">Status: <span style={{ color: statusColor(activeJob.status) }}>{activeJob.status?.toUpperCase()}</span></span>
                </div>
                <div className="dev-log-line">
                  <span className="dev-log-time">{now()}</span>
                  <span className="dev-log-tag info">QUERY</span>
                  <span className="dev-log-content">{activeJob.question}</span>
                </div>
                {activeJob.agentRuns?.map((run, ri) => (
                  <div key={run.id}>
                    <div className="dev-log-line">
                      <span className="dev-log-time">{now()}</span>
                      <span className="dev-log-tag agent">AGENT</span>
                      <span className="dev-log-content">
                        Run #{ri + 1} | depth={run.depth} | status=<span style={{ color: statusColor(run.status) }}>{run.status}</span> | query="{run.query}"
                      </span>
                    </div>
                    {run.steps?.map((step) => (
                      <div key={step.id} className="dev-log-line" style={{ paddingLeft: 20 }}>
                        <span className="dev-log-time">{now()}</span>
                        <span className="dev-log-tag step">STEP</span>
                        <span className="dev-log-content" style={{ color: "#a0a0a0" }}>
                          [{step.stepIndex}] {step.stdout || step.code || "Evaluating…"}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
                {(activeJob as any).error && (
                  <div className="dev-log-line">
                    <span className="dev-log-time">{now()}</span>
                    <span className="dev-log-tag error">ERROR</span>
                    <span className="dev-log-content error">{(activeJob as any).error}</span>
                  </div>
                )}
                <div style={{ marginTop: 12, padding: "12px 0", borderTop: "1px solid #222" }}>
                  <pre style={{ background: "transparent", color: "#555", fontSize: 11, padding: 0, maxHeight: "none", border: "none", fontFamily: "var(--font-mono)" }}>
                    {JSON.stringify(activeJob, null, 2)}
                  </pre>
                </div>
              </>
            ) : (
              <div className="dev-log-line">
                <span className="dev-log-time">{now()}</span>
                <span className="dev-log-tag info">INFO</span>
                <span className="dev-log-content dim">No job selected. Start a chat to see the trace.</span>
              </div>
            )}
          </div>
        )}

        {/* Status bar */}
        <div className="dev-terminal-prompt">
          <span className="dev-prompt-symbol">$</span>
          <span className="dev-prompt-text">
            scout-research {activeJob ? `--job=${activeJob.id.slice(0, 8)} --status=${activeJob.status}` : "--idle"}
            {!activeJob || ["completed", "failed"].includes(activeJob.status?.toLowerCase() || "") ? (
              <>
                {" "}
                <span className="dev-terminal-cursor" />
              </>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

function statusColor(status?: string | null): string {
  const s = status?.toLowerCase() || "";
  if (s === "completed") return "#34d399";
  if (s === "failed") return "#f87171";
  if (s === "running") return "#fbbf24";
  return "#8a8a8a";
}

function buildLogs(job?: ResearchJob): LogLine[] {
  if (!job) return [];
  const lines: LogLine[] = [];

  lines.push(mkLog("system", `Research session initialized — job ${job.id.slice(0, 8)}`, "success"));
  lines.push(mkLog("info", `Query: "${job.question}"`));
  lines.push(mkLog("system", `Project: ${job.projectId || "default"}`));
  lines.push(mkLog("system", "Routing intent through classifier…"));
  lines.push(mkLog("system", `Status: ${job.status?.toUpperCase()}`, job.status?.toLowerCase() === "completed" ? "success" : job.status?.toLowerCase() === "failed" ? "error" : undefined));

  if (job.status?.toLowerCase() !== "queued") {
    lines.push(mkLog("agent", "Agent planner initialized. Decomposing research task…"));
    lines.push(mkLog("agent", "Generating sub-queries for recursive search…"));
  }

  const runs = job.agentRuns || [];
  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri];
    lines.push(mkLog("agent", `Run #${ri + 1} started — depth=${run.depth} — "${run.query}"`));
    lines.push(mkLog("vector", `Querying vector store (Qdrant) for: "${run.query?.slice(0, 60)}…"`));
    lines.push(mkLog("vector", `Retrieved evidence candidates. Reranking with deterministic scorer…`));

    const steps = run.steps || [];
    for (let si = 0; si < steps.length; si++) {
      const step = steps[si];
      lines.push(
        mkLog(
          "step",
          `[${si + 1}/${steps.length}] ${step.code || step.stdout || "Executing step…"}`
        )
      );
      if (step.stdout) {
        lines.push(mkLog("step", `  ↳ stdout: ${step.stdout.slice(0, 200)}`));
      }
    }

    lines.push(mkLog("rlm", `RLM recursive loop — run #${ri + 1} — status: ${run.status?.toUpperCase()}`));

    if (run.status?.toLowerCase() === "completed") {
      lines.push(mkLog("rlm", `Run #${ri + 1} complete. Synthesizing evidence…`, "success"));
    } else if (run.status?.toLowerCase() === "failed") {
      const runErr = (run.finalOutput as any)?.error || "Unknown error";
      lines.push(mkLog("error", `Run #${ri + 1} failed: ${runErr}`, "error"));
    }
  }

  if (runs.length > 0) {
    lines.push(mkLog("vector", "Evidence gathered from all runs. Running reranker pipeline…"));
    lines.push(mkLog("rlm", "Injecting memory context from curator…"));
    lines.push(mkLog("rlm", "Generating final synthesis with LLM…"));
  }

  if (job.status?.toLowerCase() === "completed") {
    lines.push(mkLog("output", "Report generation complete.", "success"));
    lines.push(mkLog("output", `Report length: ${job.reports?.[0]?.content?.length || 0} chars`, "success"));
    lines.push(mkLog("system", "✓ Research pipeline done.", "success"));
  }

  if (job.status?.toLowerCase() === "failed") {
    const jobErr = (job as any).error || "See trace tab for details.";
    lines.push(mkLog("error", `Job failed: ${jobErr}`, "error"));
  }

  return lines;
}
