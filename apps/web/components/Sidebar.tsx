"use client";

import type { Project } from "../lib/api";

interface SidebarProps {
  projects: Project[];
  selectedProjectId: string;
  conversations: Array<{ id: string; title?: string }>;
  activeConversationId: string;
  sidebarOpen: boolean;
  onNewChat: () => void;
  onSelectProject: (id: string) => void;
  onSelectConversation: (id: string) => void;
  onToggle: () => void;
  onCreateProject: (name: string) => void;
}

// Today / Yesterday grouping helper
function groupConversations(conversations: Array<{ id: string; title?: string }>) {
  return conversations;
}

export function Sidebar({
  projects,
  selectedProjectId,
  conversations,
  activeConversationId,
  sidebarOpen,
  onNewChat,
  onSelectProject,
  onSelectConversation,
  onToggle,
  onCreateProject,
}: SidebarProps) {
  return (
    <aside className={`side ${sidebarOpen ? "" : "collapsed"}`}>
      {/* ── Top strip: toggle + new chat ── */}
      <div className="side-header">
        {/* Sidebar close/open toggle */}
        <button className="side-icon-btn" onClick={onToggle} title="Close sidebar" aria-label="Close sidebar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </button>

        {/* New chat pencil */}
        <button className="side-icon-btn" onClick={onNewChat} title="New chat" aria-label="New chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
        </button>
      </div>

      {/* ── Primary nav ── */}
      <nav className="side-primary-nav">
        <button className="side-nav-item" onClick={onNewChat}>
          <span className="side-nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <span>Search chats</span>
        </button>

        <button className="side-nav-item">
          <span className="side-nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
          </span>
          <span>Library</span>
        </button>

        {/* Project Selector Dropdown */}
        <div style={{ padding: "8px 12px 4px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Active Project
            </label>
            <button
              onClick={() => {
                const name = prompt("Enter project name:");
                if (name && name.trim()) {
                  onCreateProject(name.trim());
                }
              }}
              style={{
                fontSize: 10,
                color: "var(--accent)",
                fontWeight: 600,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                marginLeft: "auto",
              }}
              title="Create new project"
            >
              + Create
            </button>
          </div>
          <select
            value={selectedProjectId}
            onChange={(e) => onSelectProject(e.target.value)}
            style={{
              width: "100%",
              background: "#121212",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "white",
              fontSize: 13,
              padding: "6px 10px",
              borderRadius: 6,
              cursor: "pointer",
              outline: "none",
            }}
            aria-label="Select project"
          >
            {projects.length === 0 ? (
              <option value="" disabled>No projects found</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
        </div>
      </nav>

      {/* ── Pinned apps ── */}
      <div className="side-section-label">Pinned</div>
      <div className="side-list">
        <button className="side-list-item">
          <span className="side-list-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.86 6.4 1.65 1.65 0 0 0 9 4.88V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </span>
          <span className="side-list-text">Memory Graph</span>
        </button>
        <button className="side-list-item">
          <span className="side-list-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
          </span>
          <span className="side-list-text">Repo Graph</span>
        </button>
        <button className="side-list-item">
          <span className="side-list-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span className="side-list-text">Personal</span>
        </button>
      </div>

      {/* ── Recent conversations ── */}
      <div className="side-section-label">Recent</div>
      <div className="side-list" style={{ flex: 1, overflowY: "auto" }}>
        {conversations.length === 0 ? (
          <div className="side-empty-text">No conversations yet.</div>
        ) : (
          conversations.map((conv) => (
            <button
              key={conv.id}
              className={`side-list-item ${conv.id === activeConversationId ? "active" : ""}`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <span className="side-list-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <span className="side-list-text">{conv.title || "Chat"}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
