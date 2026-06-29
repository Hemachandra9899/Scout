"use client";

interface AppsMenuProps {
  open: boolean;
  onClose: () => void;
  onSelect: (appId: string) => void;
}

const apps = [
  { id: "memory-graph", label: "Memory Graph", description: "Explore curated memories and entities" },
  { id: "repo-graph", label: "Repo Graph", description: "Visualize codebase relationships" },
  { id: "graph-reports", label: "Graph Reports", description: "Generated code graph reports" },
  { id: "documents", label: "Documents", description: "Uploaded project documents" },
  { id: "agent-runs", label: "Agent Runs", description: "Multi-step agent execution progress" },
  { id: "web-research", label: "Web Research", description: "Deep web research mode" },
  { id: "github-analyzer", label: "GitHub Repo Analyzer", description: "Analyze any public repository" },
];

export function AppsMenu({ open, onClose, onSelect }: AppsMenuProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="apps-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="apps-drawer-header">
          <h2>Apps</h2>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="apps-drawer-grid">
          {apps.map((app) => (
            <button
              key={app.id}
              className="app-card"
              onClick={() => { onSelect(app.id); onClose(); }}
            >
              <div className="app-card-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18" /><path d="M9 21V9" />
                </svg>
              </div>
              <div className="app-card-label">{app.label}</div>
              <div className="app-card-desc">{app.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
