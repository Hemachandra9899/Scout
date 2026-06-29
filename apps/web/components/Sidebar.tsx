"use client";

import { useState } from "react";
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
}

const primaryItems = [
  { id: "new-chat", label: "New chat", icon: "edit" },
  { id: "search", label: "Search chats", icon: "search" },
  { id: "library", label: "Library", icon: "library" },
  { id: "projects", label: "Projects", icon: "folder" },
  { id: "scheduled", label: "Scheduled", icon: "clock" },
  { id: "apps", label: "Apps", icon: "grid" },
  { id: "more", label: "More", icon: "more" },
];

const pinnedItems = [
  { id: "personal", label: "Personal", type: "folder" },
  { id: "memory-graph", label: "Memory Graph", type: "app" },
  { id: "repo-graph", label: "Repo Graph", type: "app" },
];

function iconSVG(id: string) {
  const props = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const s = (id: string) => <svg {...props} key={id}>{id === "edit" && <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></>}{id === "search" && <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>}{id === "library" && <><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></>}{id === "folder" && <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>}{id === "clock" && <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>}{id === "grid" && <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>}{id === "more" && <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>}</svg>;
  return s(id);
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
}: SidebarProps) {
  return (
    <aside className={`side ${sidebarOpen ? "" : "collapsed"}`}>
      <div className="side-header">
        <div className="brand">
          <h1>Scout</h1>
        </div>
      </div>

      <nav className="side-primary-nav">
        <button className="side-nav-item primary" onClick={onNewChat}>
          <span className="side-nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span>New chat</span>
        </button>
        <button className="side-nav-item">
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
      </nav>

      <div className="side-section-label">Pinned</div>
      <div className="side-list">
        {pinnedItems.map((item) => (
          <button key={item.id} className="side-list-item">
            <span className="side-list-icon">
              {item.type === "app" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              )}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="side-section-label">Recent conversations</div>
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

      <div className="side-footer">
        <button className="side-nav-item" onClick={onToggle}>
          <span className="side-nav-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
            </svg>
          </span>
          <span>Collapse sidebar</span>
        </button>
      </div>
    </aside>
  );
}
