"use client";

import { useState } from "react";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Live dep health map from API, e.g. { postgres: "ok", redis: "ok", qdrant: "ok", rlmRuntime: "ok" } */
  deps?: Record<string, string>;
}

type SettingsTab = "general" | "personalization" | "apps" | "integrations" | "data";

const INTEGRATION_META: Record<string, { label: string; description: string; port?: string }> = {
  postgres: {
    label: "PostgreSQL",
    description: "Primary relational database. Stores projects, conversations, and research jobs.",
    port: "5432",
  },
  redis: {
    label: "Redis",
    description: "In-memory cache and job queue. Used for fast lookups and async task management.",
    port: "6379",
  },
  qdrant: {
    label: "Qdrant",
    description: "Vector database for semantic search. Stores and queries embedding vectors.",
    port: "6333",
  },
  rlmRuntime: {
    label: "RLM Runtime",
    description: "Recursive Language Model execution engine. Handles agent planning and synthesis.",
  },
};

function StatusBadge({ value }: { value: string }) {
  const isOk = value?.toLowerCase().includes("ok");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        background: isOk ? "rgba(16,163,127,0.12)" : "rgba(239,68,68,0.12)",
        color: isOk ? "#10a37f" : "#f87171",
        border: `1px solid ${isOk ? "rgba(16,163,127,0.25)" : "rgba(239,68,68,0.25)"}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: isOk ? "#10a37f" : "#f87171",
          display: "inline-block",
          flexShrink: 0,
          boxShadow: isOk ? "0 0 4px rgba(16,163,127,0.6)" : undefined,
        }}
      />
      {isOk ? "Connected" : "Disconnected"}
    </span>
  );
}

export function SettingsModal({ open, onClose, deps = {} }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("general");

  if (!open) return null;

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "personalization", label: "Personalization" },
    { id: "apps", label: "Apps" },
    { id: "integrations", label: "Integrations" },
    { id: "data", label: "Data Controls" },
  ];

  const integrationKeys = ["postgres", "redis", "qdrant", "rlmRuntime"];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        {/* Header */}
        <div className="settings-modal-header">
          <h2>Settings</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-modal-body">
          {/* Side tabs */}
          <nav className="settings-tabs" aria-label="Settings navigation">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`settings-tab ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
                role="tab"
                aria-selected={tab === t.id}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="settings-content">
            {/* ── General ── */}
            {tab === "general" && (
              <div className="settings-section">
                <div className="settings-field">
                  <label>Appearance</label>
                  <select className="settings-select">
                    <option value="system">System</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
                <div className="settings-field">
                  <label>Language</label>
                  <select className="settings-select">
                    <option value="en">English</option>
                  </select>
                </div>
                <div className="settings-field">
                  <label className="settings-toggle-label">
                    <span>Higher intelligence mode</span>
                    <input type="checkbox" className="settings-toggle" />
                  </label>
                </div>
                <div className="settings-field">
                  <label className="settings-toggle-label">
                    <span>Enable dictation</span>
                    <input type="checkbox" className="settings-toggle" />
                  </label>
                </div>
                <div className="settings-field">
                  <label className="settings-toggle-label">
                    <span>Agent executor hints</span>
                    <input type="checkbox" className="settings-toggle" />
                  </label>
                </div>
              </div>
            )}

            {/* ── Personalization ── */}
            {tab === "personalization" && (
              <div className="settings-section">
                <div className="settings-field">
                  <label>Accent color</label>
                  <div className="settings-color-row">
                    {["#10a37f", "#06b6d4", "#8b5cf6", "#f59e0b", "#ec4899"].map((c) => (
                      <button
                        key={c}
                        className="settings-color-swatch"
                        style={{ backgroundColor: c }}
                        aria-label={`Set accent color ${c}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="settings-field">
                  <label className="settings-toggle-label">
                    <span>Show memory graph in sidebar</span>
                    <input type="checkbox" className="settings-toggle" defaultChecked />
                  </label>
                </div>
                <div className="settings-field">
                  <label className="settings-toggle-label">
                    <span>Show source cards in responses</span>
                    <input type="checkbox" className="settings-toggle" defaultChecked />
                  </label>
                </div>
              </div>
            )}

            {/* ── Apps ── */}
            {tab === "apps" && (
              <div className="settings-section">
                {[
                  "Memory Graph",
                  "Repo Graph",
                  "Agent Runs",
                  "GitHub Repo Analyzer",
                  "Web Research",
                ].map((app) => (
                  <div className="settings-field" key={app}>
                    <label className="settings-toggle-label">
                      <span>{app}</span>
                      <input type="checkbox" className="settings-toggle" defaultChecked />
                    </label>
                  </div>
                ))}
              </div>
            )}

            {/* ── Integrations ── */}
            {tab === "integrations" && (
              <div className="settings-section">
                <p className="settings-note" style={{ marginBottom: 8 }}>
                  Live status of Scout's backend service connections.
                </p>
                {integrationKeys.map((key) => {
                  const meta = INTEGRATION_META[key];
                  const depValue = deps[key] || (key === "rlmRuntime" ? deps["rlmRuntime"] : undefined) || "";
                  return (
                    <div
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 16,
                        padding: "16px 0",
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                            {meta?.label || key}
                          </span>
                          {meta?.port && (
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--muted)",
                                fontFamily: "var(--font-mono)",
                                background: "var(--panel2)",
                                border: "1px solid var(--line-2)",
                                borderRadius: 4,
                                padding: "1px 6px",
                              }}
                            >
                              :{meta.port}
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
                          {meta?.description}
                        </p>
                        {depValue && (
                          <p
                            style={{
                              fontSize: 11,
                              color: "var(--muted)",
                              margin: "4px 0 0",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {depValue}
                          </p>
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <StatusBadge value={depValue} />
                      </div>
                    </div>
                  );
                })}

                <div style={{ marginTop: 20 }}>
                  <p className="settings-note">
                    Connection status is checked live against the Scout API. Restart the API server if a service appears disconnected.
                  </p>
                </div>
              </div>
            )}

            {/* ── Data Controls ── */}
            {tab === "data" && (
              <div className="settings-section">
                <div className="settings-field">
                  <label className="settings-toggle-label">
                    <span>Improve Scout with my data</span>
                    <input type="checkbox" className="settings-toggle" />
                  </label>
                </div>
                <div className="settings-field">
                  <label className="settings-toggle-label">
                    <span>Save conversation history</span>
                    <input type="checkbox" className="settings-toggle" defaultChecked />
                  </label>
                </div>
                <p className="settings-note" style={{ marginTop: 8 }}>
                  Data controls are not yet backed by a persistent settings service. Preferences are stored locally for this session.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
