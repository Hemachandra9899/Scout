"use client";

import { useState } from "react";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "general" | "apps" | "personalization" | "data";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("general");

  if (!open) return null;

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "personalization", label: "Personalization" },
    { id: "apps", label: "Apps" },
    { id: "data", label: "Data Controls" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Settings</h2>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-modal-body">
          <nav className="settings-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`settings-tab ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
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
                    <span>Agent executor (UI hint)</span>
                    <input type="checkbox" className="settings-toggle" />
                  </label>
                </div>
                <div className="settings-field">
                  <label className="settings-toggle-label">
                    <span>Cache debug</span>
                    <input type="checkbox" className="settings-toggle" />
                  </label>
                </div>
              </div>
            )}

            {tab === "personalization" && (
              <div className="settings-section">
                <div className="settings-field">
                  <label>Accent color</label>
                  <div className="settings-color-row">
                    {["#d7ff00", "#31e8df", "#ff9acc", "#ff9f1a", "#ff252f"].map((c) => (
                      <button
                        key={c}
                        className="settings-color-swatch"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <div className="settings-field">
                  <label className="settings-toggle-label">
                    <span>Show memory graph</span>
                    <input type="checkbox" className="settings-toggle" defaultChecked />
                  </label>
                </div>
              </div>
            )}

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

            {tab === "data" && (
              <div className="settings-section">
                <p className="settings-note">
                  Data controls are not yet backed by a persistent settings service.
                  Preferences are stored locally for this session.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
