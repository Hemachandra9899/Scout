"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function looksLikeNumericDump(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;

  const numericLines = lines.filter((l) => {
    const digits = (l.match(/\d/g) || []).length;
    return digits > 0 && digits / l.length > 0.2;
  });

  const tableRows = (text.match(/^\|.+\|$/gm) || []).length;
  const currencyValues = (text.match(/[\$€£¥]\s*\d+(?:,\d{3})*(?:\.\d+)?/g) || []).length;
  const percentages = (text.match(/\d+(?:\.\d+)?%/g) || []).length;

  const numericRatio = numericLines.length / lines.length;
  return (
    numericRatio > 0.35 ||
    currencyValues > 15 ||
    percentages > 15 ||
    (tableRows > 20 && numericRatio > 0.25)
  );
}

function wrapTables(html: string): string {
  return html.replace(
    /<table[\s\S]*?<\/table>/g,
    (match) => `<div class="markdown-table-wrap">${match}</div>`,
  );
}

export function MessageContent({ content }: { content: string }) {
  if (!content?.trim()) {
    return <p className="answerText text-muted">Waiting for answer...</p>;
  }

  const isDump = looksLikeNumericDump(content);

  return (
    <div className="message-content">
      {isDump && (
        <div className="raw-data-warning">
          This answer contains raw data that may not be fully analyzed. Consider
          rephrasing your question to request analysis or a summary.
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="markdown-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
