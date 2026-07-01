"use client";

import { useCallback, useRef } from "react";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onOpenPlusMenu: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** Active mode selected from the + menu ("auto" hides the chip). */
  mode?: string;
  onClearMode?: () => void;
  /** Pass the plus button ref so ComposerPlusMenu can exclude it from outside-click */
  plusBtnRef?: React.RefObject<HTMLButtonElement>;
}

const MODE_LABELS: Record<string, string> = {
  web_research: "Web research",
  deep_research: "Deep research",
  github_repo: "GitHub repo",
  agent: "Agent mode",
  kb: "Knowledge base",
};

export function Composer({
  value,
  onChange,
  onSend,
  onOpenPlusMenu,
  disabled,
  placeholder = "Ask anything",
  mode = "auto",
  onClearMode,
  plusBtnRef,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    },
    [onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  };

  return (
    <footer className="composer-wrapper">
      <div className="composer-box" role="form" aria-label="Chat composer">
        {/* Active mode chip */}
        {mode && mode !== "auto" && MODE_LABELS[mode] && (
          <div className="composer-mode-row">
            <span className="composer-mode-chip">
              {MODE_LABELS[mode]}
              <button
                type="button"
                className="composer-mode-clear"
                onClick={onClearMode}
                aria-label="Clear mode"
                title="Clear mode"
              >
                ×
              </button>
            </span>
          </div>
        )}

        {/* Textarea row */}
        <div className="composer-top-row">
          <textarea
            id="composer-input"
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            aria-label="Message input"
            style={{ flex: 1 }}
          />
        </div>

        {/* Actions row */}
        <div className="composer-bottom-row">
          {/* Left: only the + button */}
          <div className="composer-left-actions">
            <button
              ref={plusBtnRef}
              className="composer-plus-btn"
              onClick={onOpenPlusMenu}
              title="Attach files or tools"
              aria-label="Open tools menu"
              id="composer-plus-btn"
              type="button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          {/* Right: send button */}
          <div className="composer-actions-right">
            <button
              className="generate-btn"
              id="composer-send-btn"
              onClick={onSend}
              disabled={disabled || !value.trim()}
              title={disabled ? "Processing…" : "Send message"}
              aria-label="Send"
              type="button"
            >
              {disabled ? (
                /* Stop icon when running */
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="none"
                >
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              ) : (
                /* Arrow-up icon */
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      <p className="composer-hint">
        Scout can make mistakes. Check important info.
      </p>
    </footer>
  );
}
