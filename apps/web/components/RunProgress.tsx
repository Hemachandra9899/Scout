"use client";

const DEFAULT_STEPS = [
  "Understanding your request",
  "Checking project knowledge",
  "Searching web/docs if needed",
  "Reading sources",
  "Writing answer",
];

export function RunProgress({
  status,
  steps = DEFAULT_STEPS,
  devMode = false,
}: {
  status: string;
  steps?: string[];
  devMode?: boolean;
}) {
  const isRunning = ["running", "queued"].includes(status?.toLowerCase());

  if (!isRunning) return null;

  if (!devMode) {
    return (
      <div className="runProgress" style={{ border: "none", background: "none", padding: 0, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-secondary)" }}>
          <div
            style={{
              width: 16,
              height: 16,
              border: "2px solid rgba(255,255,255,0.1)",
              borderTopColor: "var(--accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 400 }}>Thinking…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="runProgress">
      <div className="progressTitle">Working</div>
      {steps.map((step, index) => (
        <div className="progressStep" key={step}>
          <span>{index + 1}</span>
          <p>{step}</p>
        </div>
      ))}
    </div>
  );
}
