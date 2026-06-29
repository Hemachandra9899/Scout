"use client";

import { useState, useRef } from "react";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onOpenPlusMenu: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function Composer({
  value,
  onChange,
  onSend,
  onOpenPlusMenu,
  disabled,
  placeholder = "Ask anything",
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <footer className="composer-wrapper">
      <div className="composer-box">
        <button className="composer-plus-btn" onClick={onOpenPlusMenu} title="Add files, apps, or actions">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v8" /><path d="M8 12h8" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={1}
        />
        <div className="composer-actions-right">
          {value.trim() && (
            <button
              className="generate-btn"
              onClick={onSend}
              disabled={disabled || !value.trim()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
