"use client";

import { useRef, useEffect } from "react";

interface ComposerPlusMenuProps {
  open: boolean;
  onClose: () => void;
  onAction: (action: string) => void;
  /** Ref to the + button so we don't close when clicking it (toggle handled by parent) */
  triggerRef?: React.RefObject<HTMLButtonElement>;
}

const actions = [
  {
    id: "file-upload",
    label: "Add photos & files",
    description: "Upload images or documents",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    id: "document-upload",
    label: "Upload document",
    description: "Ingest a document into knowledge base",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="13" x2="12" y2="17" />
        <line x1="10" y1="15" x2="14" y2="15" />
      </svg>
    ),
  },
  {
    id: "memory-upload",
    label: "Upload memory",
    description: "Curate a durable fact or preference",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    id: "web-research",
    label: "Web research",
    description: "Search the web for current information",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
  },
  {
    id: "deep-research",
    label: "Deep research",
    description: "Recursive multi-step research mode",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    id: "github-repo",
    label: "GitHub repository",
    description: "Analyze a public repository",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
        <path d="M9 18c-4.51 2-5-2-7-2" />
      </svg>
    ),
  },
  {
    id: "agent-mode",
    label: "Agent mode",
    description: "Multi-step autonomous agent execution",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
];

export function ComposerPlusMenu({
  open,
  onClose,
  onAction,
  triggerRef,
}: ComposerPlusMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking inside the menu itself
      if (menuRef.current && menuRef.current.contains(target)) return;
      // Don't close if clicking the trigger button (parent handles toggle)
      if (triggerRef?.current && triggerRef.current.contains(target)) return;
      onClose();
    };

    // Use mousedown so it fires before the button's click event
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <div className="composer-plus-dropdown" ref={menuRef}>
      {actions.map((action) => (
        <button
          key={action.id}
          className="composer-plus-item"
          onClick={() => {
            onAction(action.id);
            onClose();
          }}
        >
          <span className="composer-plus-item-icon">{action.icon}</span>
          <div className="composer-plus-item-text">
            <span className="composer-plus-item-label">{action.label}</span>
            <span className="composer-plus-item-desc">{action.description}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
