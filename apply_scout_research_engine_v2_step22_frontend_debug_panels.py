#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 22:
# Frontend debug panels for research response contract.
#
# Run from Scout repo root on main AFTER Step 21.
#
# This patch:
# - Adds apps/web/lib/researchContract.ts to extract contractVersion/ui/debug from
#   report metadata, agent finalOutput, or step result.
# - Adds apps/web/components/ResearchDebugPanel.tsx with tabs:
#     Summary, Sources, Crawl, Evidence, Grounding, Raw
# - Updates app/page.tsx to prefer ui.answerMarkdown and ui.citations.
# - Shows ResearchDebugPanel on completed/failed assistant jobs when contract exists.
# - Adds CSS for the debug panel.
# - Adds web typecheck/root scripts.
#
# After applying:
#   npm install
#   npm run typecheck:web
#   npm run typecheck:api
#   npm run test:api
#   npm run typecheck:knowledge
#   npm run test:knowledge

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"wrote {path}")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def read_json(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def write_json(path: str, data: dict) -> None:
    (ROOT / path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"updated {path}")


def assert_repo_root() -> None:
    required = [
        "package.json",
        "apps/web/package.json",
        "apps/web/app/page.tsx",
        "apps/web/app/globals.css",
        "apps/web/lib/api.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run from Scout repo root after Step 21. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


RESEARCH_CONTRACT_TS = r'''
import type { ResearchJob } from "./api";

export type ResearchContractUi = {
  status?: string;
  query?: string;
  normalizedQuery?: string;
  answerMarkdown?: string;
  citations?: Array<Record<string, any>>;
  confidence?: number;
  answerMode?: string;
  groundingStatus?: string;
  groundingIssues?: Array<Record<string, any>>;
  evidenceCoverage?: Record<string, any>;
  crawlTrace?: Record<string, any>;
  skippedCrawls?: Array<Record<string, any>>;
  resources?: Array<Record<string, any>>;
  warnings?: string[];
};

export type ResearchContractDebug = {
  search?: Record<string, any>;
  crawl?: Record<string, any>;
  evidence?: Record<string, any>;
  answer?: Record<string, any>;
  memories?: Record<string, any>;
};

export type ResearchContract = {
  contractVersion: string;
  ui?: ResearchContractUi;
  debug?: ResearchContractDebug;
  [key: string]: any;
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isResearchContract(value: unknown): value is ResearchContract {
  return isRecord(value) && value.contractVersion === "research-response-v1";
}

function searchNestedContract(value: unknown, depth = 0): ResearchContract | undefined {
  if (depth > 4) return undefined;
  if (isResearchContract(value)) return value;
  if (!isRecord(value)) return undefined;

  const preferredKeys = [
    "result",
    "finalOutput",
    "final",
    "output",
    "response",
    "data",
    "research",
  ];

  for (const key of preferredKeys) {
    const nested = searchNestedContract(value[key], depth + 1);
    if (nested) return nested;
  }

  for (const nestedValue of Object.values(value)) {
    const nested = searchNestedContract(nestedValue, depth + 1);
    if (nested) return nested;
  }

  return undefined;
}

export function getResearchContract(job?: ResearchJob): ResearchContract | undefined {
  if (!job) return undefined;

  for (const report of job.reports ?? []) {
    const metadata = report.metadata;
    const fromMetadata = searchNestedContract(metadata);
    if (fromMetadata) return fromMetadata;
  }

  for (const run of job.agentRuns ?? []) {
    const fromRun = searchNestedContract(run.finalOutput);
    if (fromRun) return fromRun;

    for (const step of run.steps ?? []) {
      const fromStepResult = searchNestedContract(step.result);
      if (fromStepResult) return fromStepResult;

      if (typeof step.stdout === "string") {
        try {
          const parsed = JSON.parse(step.stdout);
          const fromStdout = searchNestedContract(parsed);
          if (fromStdout) return fromStdout;
        } catch {
          // stdout is often plain text; ignore parse failures.
        }
      }
    }
  }

  return undefined;
}

export function getContractAnswerMarkdown(job?: ResearchJob): string {
  const contract = getResearchContract(job);
  return contract?.ui?.answerMarkdown?.trim() || "";
}

export function getContractSources(job?: ResearchJob): Array<Record<string, any>> {
  const contract = getResearchContract(job);
  const citations = contract?.ui?.citations;
  if (Array.isArray(citations) && citations.length > 0) return citations;

  const resources = contract?.ui?.resources;
  if (Array.isArray(resources) && resources.length > 0) return resources;

  return [];
}

export function hasResearchContract(job?: ResearchJob): boolean {
  return Boolean(getResearchContract(job));
}
'''


DEBUG_PANEL_TSX = r'''
"use client";

import { useMemo, useState } from "react";
import type { ResearchContract } from "../lib/researchContract";

type Tab = "summary" | "sources" | "crawl" | "evidence" | "grounding" | "raw";

function safeArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="debugJson">{JSON.stringify(value ?? {}, null, 2)}</pre>;
}

function Pill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number | undefined;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className={`debugPill ${tone}`}>
      <span>{label}</span>
      <b>{value ?? "—"}</b>
    </div>
  );
}

function toneForGrounding(status?: string): "good" | "warn" | "bad" | "neutral" {
  if (status === "pass") return "good";
  if (status === "warning") return "warn";
  if (status === "fail") return "bad";
  return "neutral";
}

function host(url?: string) {
  if (!url) return "unknown";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function SummaryTab({ contract }: { contract: ResearchContract }) {
  const ui = contract.ui ?? {};
  const debug = contract.debug ?? {};
  const evidence = ui.evidenceCoverage ?? {};
  const crawl = ui.crawlTrace ?? {};
  const warnings = safeArray<string>(ui.warnings);

  return (
    <div className="debugTabBody">
      <div className="debugGrid">
        <Pill label="Mode" value={ui.answerMode} />
        <Pill
          label="Grounding"
          value={ui.groundingStatus}
          tone={toneForGrounding(ui.groundingStatus)}
        />
        <Pill label="Confidence" value={ui.confidence} />
        <Pill label="Citations" value={safeArray(ui.citations).length} />
        <Pill label="Accepted pages" value={safeNumber(crawl.acceptedPages)} />
        <Pill label="Retries" value={safeNumber(crawl.retryCount)} />
        <Pill label="Filtered claims" value={safeNumber(evidence.filteredClaimCount)} />
        <Pill label="Warnings" value={warnings.length} tone={warnings.length ? "warn" : "good"} />
      </div>

      {warnings.length > 0 ? (
        <div className="debugWarnings">
          {warnings.map((warning, index) => (
            <div key={index} className="debugWarning">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      <details className="debugDetails">
        <summary>Debug summary</summary>
        <JsonBlock value={debug} />
      </details>
    </div>
  );
}

function SourcesTab({ contract }: { contract: ResearchContract }) {
  const citations = safeArray<Record<string, any>>(contract.ui?.citations);
  const resources = safeArray<Record<string, any>>(contract.ui?.resources);

  return (
    <div className="debugTabBody">
      <h4>Citations</h4>
      {citations.length ? (
        <div className="debugList">
          {citations.map((citation, index) => (
            <a
              key={`${citation.url ?? index}-${index}`}
              href={citation.url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="debugSourceCard"
            >
              <span>[{citation.id ?? index + 1}]</span>
              <div>
                <b>{citation.title || "Untitled source"}</b>
                <small>{host(citation.url)} · {citation.tier || "unknown"}</small>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="debugMuted">No citations found.</p>
      )}

      <h4>Planned resources</h4>
      {resources.length ? (
        <div className="debugList">
          {resources.slice(0, 10).map((resource, index) => (
            <div key={`${resource.url ?? index}-${index}`} className="debugResourceRow">
              <b>{resource.title || host(resource.url)}</b>
              <small>
                {host(resource.url)} · score {resource.score ?? "—"} · {resource.tier ?? "unknown"}
              </small>
              {resource.metadata?.searchTrace ? (
                <small>
                  route {resource.metadata.searchTrace.routeKind || "unknown"} · providers{" "}
                  {safeArray(resource.metadata.searchTrace.selectedProviders).join(", ") || "—"}
                </small>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="debugMuted">No planned resources found.</p>
      )}
    </div>
  );
}

function CrawlTab({ contract }: { contract: ResearchContract }) {
  const crawl = contract.ui?.crawlTrace ?? {};
  const skipped = safeArray<Record<string, any>>(contract.ui?.skippedCrawls);
  const resourceTraces = safeArray<Record<string, any>>(crawl.resourceTraces);

  return (
    <div className="debugTabBody">
      <div className="debugGrid">
        <Pill label="Accepted" value={safeNumber(crawl.acceptedPages)} />
        <Pill label="Skipped" value={safeNumber(crawl.skippedPages)} />
        <Pill label="Quality rejects" value={safeNumber(crawl.rejectedByQuality)} />
        <Pill label="Duplicate URL" value={safeNumber(crawl.rejectedByDuplicateUrl)} />
        <Pill label="Duplicate content" value={safeNumber(crawl.rejectedByDuplicateContent)} />
        <Pill label="Retries" value={safeNumber(crawl.retryCount)} />
      </div>

      {resourceTraces.length ? (
        <div className="debugList">
          {resourceTraces.map((trace, index) => (
            <div key={`${trace.resourceUrl ?? index}-${index}`} className="debugResourceRow">
              <b>{trace.resourceUrl || trace.url || `Resource ${index + 1}`}</b>
              <small>
                attempts {trace.attempts ?? safeArray(trace.attempts).length ?? "—"} · retried{" "}
                {String(Boolean(trace.retried))}
              </small>
              <small>
                accepted {trace.pagesAccepted ?? trace.acceptedPages ?? 0} · skipped{" "}
                {trace.pagesSkipped ?? trace.skippedPages ?? 0} · failed{" "}
                {trace.pagesFailed ?? trace.failedUrls ?? 0}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="debugMuted">No resource crawl traces found.</p>
      )}

      {skipped.length ? (
        <details className="debugDetails">
          <summary>Skipped crawls ({skipped.length})</summary>
          <JsonBlock value={skipped} />
        </details>
      ) : null}
    </div>
  );
}

function EvidenceTab({ contract }: { contract: ResearchContract }) {
  const coverage = contract.ui?.evidenceCoverage ?? {};

  return (
    <div className="debugTabBody">
      <div className="debugGrid">
        <Pill label="Raw claims" value={safeNumber(coverage.rawClaimCount ?? coverage.claimCount)} />
        <Pill label="Filtered" value={safeNumber(coverage.filteredClaimCount ?? coverage.claimCount)} />
        <Pill label="Quality rejected" value={safeNumber(coverage.qualityRejectedClaimCount)} />
        <Pill label="Duplicate rejected" value={safeNumber(coverage.duplicateRejectedClaimCount)} />
        <Pill label="Supported" value={safeNumber(coverage.supportedClaimCount)} />
        <Pill label="Weak" value={safeNumber(coverage.weakClaimCount)} />
        <Pill label="Unsupported" value={safeNumber(coverage.unsupportedClaimCount)} />
        <Pill label="Official sources" value={safeNumber(coverage.officialSourceCount)} />
      </div>

      {safeArray<string>(coverage.missing).length ? (
        <div className="debugWarnings">
          {safeArray<string>(coverage.missing).map((item, index) => (
            <div key={index} className="debugWarning">
              {item}
            </div>
          ))}
        </div>
      ) : null}

      <JsonBlock value={coverage} />
    </div>
  );
}

function GroundingTab({ contract }: { contract: ResearchContract }) {
  const audit = {
    status: contract.ui?.groundingStatus,
    issues: contract.ui?.groundingIssues ?? [],
    ...(contract.debug?.answer?.groundingAudit ?? {}),
  };

  return (
    <div className="debugTabBody">
      <div className="debugGrid">
        <Pill label="Status" value={audit.status} tone={toneForGrounding(audit.status)} />
        <Pill label="Issues" value={safeArray(audit.issues).length || audit.issueCount || 0} />
        <Pill label="Grounded claims" value={audit.groundedClaimCount} />
      </div>
      <JsonBlock value={audit} />
    </div>
  );
}

export function ResearchDebugPanel({
  contract,
}: {
  contract?: ResearchContract;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("summary");

  const tabs = useMemo<Array<{ id: Tab; label: string }>>(
    () => [
      { id: "summary", label: "Summary" },
      { id: "sources", label: "Sources" },
      { id: "crawl", label: "Crawl" },
      { id: "evidence", label: "Evidence" },
      { id: "grounding", label: "Grounding" },
      { id: "raw", label: "Raw" },
    ],
    [],
  );

  if (!contract) return null;

  return (
    <div className="researchDebugPanel">
      <button className="sourcesButton" onClick={() => setOpen(!open)}>
        {open ? "Hide Research Debug" : "Research Debug"}
      </button>

      {open ? (
        <div className="researchDebugBody">
          <div className="debugTabs">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={`debugTab ${tab === item.id ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "summary" ? <SummaryTab contract={contract} /> : null}
          {tab === "sources" ? <SourcesTab contract={contract} /> : null}
          {tab === "crawl" ? <CrawlTab contract={contract} /> : null}
          {tab === "evidence" ? <EvidenceTab contract={contract} /> : null}
          {tab === "grounding" ? <GroundingTab contract={contract} /> : null}
          {tab === "raw" ? (
            <div className="debugTabBody">
              <JsonBlock value={contract} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
'''


CSS_APPEND = r'''
/* Research debug panel */
.researchDebugPanel {
  margin-top: 10px;
}

.researchDebugBody {
  margin-top: 10px;
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.18);
  border-radius: 6px;
  overflow: hidden;
}

.debugTabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--line);
  background: var(--panel2);
}

.debugTab {
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 10px;
}

.debugTab.active {
  color: #000;
  background: var(--lime);
  border-color: var(--lime);
}

.debugTabBody {
  padding: 10px;
}

.debugTabBody h4 {
  margin: 8px 0 6px;
  color: var(--lime);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.debugGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}

.debugPill {
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 5px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.debugPill span {
  color: var(--muted);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.debugPill b {
  color: var(--text);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  margin: 0;
}

.debugPill.good b {
  color: var(--lime);
}

.debugPill.warn b {
  color: var(--orange);
}

.debugPill.bad b {
  color: var(--bad);
}

.debugWarnings {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0;
}

.debugWarning {
  border: 1px solid rgba(255, 159, 26, 0.45);
  color: var(--orange);
  background: rgba(255, 159, 26, 0.08);
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.debugList {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.debugSourceCard,
.debugResourceRow {
  display: flex;
  gap: 8px;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 5px;
  padding: 8px;
  color: var(--text);
  text-decoration: none;
}

.debugSourceCard span {
  font-family: ui-monospace, monospace;
  color: var(--lime);
}

.debugSourceCard div,
.debugResourceRow {
  min-width: 0;
}

.debugSourceCard b,
.debugResourceRow b {
  color: var(--text);
  font-size: 11px;
  margin: 0;
}

.debugSourceCard small,
.debugResourceRow small,
.debugMuted {
  color: var(--muted);
  font-size: 10px;
  display: block;
  overflow-wrap: anywhere;
}

.debugResourceRow {
  flex-direction: column;
  gap: 2px;
}

.debugDetails {
  margin-top: 10px;
  border-top: 1px solid var(--line);
  padding-top: 8px;
}

.debugJson {
  margin: 8px 0 0;
  max-height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
'''


def patch_page() -> None:
    path = "apps/web/app/page.tsx"
    text = read(path)

    if '../lib/researchContract' not in text:
        text = text.replace(
            'import { api, Conversation, ProjectDocument, ResearchJob } from "../lib/api";',
            'import { api, Conversation, ProjectDocument, ResearchJob } from "../lib/api";\nimport { getContractAnswerMarkdown, getContractSources, getResearchContract } from "../lib/researchContract";'
        )

    if '../components/ResearchDebugPanel' not in text:
        text = text.replace(
            'import { RunProgress } from "../components/RunProgress";',
            'import { RunProgress } from "../components/RunProgress";\nimport { ResearchDebugPanel } from "../components/ResearchDebugPanel";'
        )

    old_answer_start = '''function answerText(job?: ResearchJob) {
  if (!job) return "";

  const report = job.reports?.[0];'''

    new_answer_start = '''function answerText(job?: ResearchJob) {
  if (!job) return "";

  const contractAnswer = getContractAnswerMarkdown(job);
  if (contractAnswer && !isGenericAnswer(contractAnswer)) return contractAnswer;

  const report = job.reports?.[0];'''

    if old_answer_start in text:
        text = text.replace(old_answer_start, new_answer_start)

    old_sources = '''function getSources(job?: ResearchJob) {
  const report = job?.reports?.[0] as any;
  const sources = report?.metadata?.sources;

  if (Array.isArray(sources)) return sources;

  const resultSources = (job?.agentRuns?.[0]?.finalOutput as any)?.sources;
  if (Array.isArray(resultSources)) return resultSources;

  return [];
}'''

    new_sources = '''function getSources(job?: ResearchJob) {
  const contractSources = getContractSources(job);
  if (contractSources.length > 0) return contractSources;

  const report = job?.reports?.[0] as any;
  const sources = report?.metadata?.sources;

  if (Array.isArray(sources)) return sources;

  const resultSources = (job?.agentRuns?.[0]?.finalOutput as any)?.sources;
  if (Array.isArray(resultSources)) return resultSources;

  return [];
}'''

    if old_sources in text:
        text = text.replace(old_sources, new_sources)

    old_panel = '''                        <SourcesPanel sources={getSources(activeJob)} />
                        {activeJob.agentRuns?.length ? ('''

    new_panel = '''                        <SourcesPanel sources={getSources(activeJob)} />
                        <ResearchDebugPanel contract={getResearchContract(activeJob)} />
                        {activeJob.agentRuns?.length ? ('''

    if old_panel in text:
        text = text.replace(old_panel, new_panel)
    elif "ResearchDebugPanel" not in text:
        print("warning: could not insert ResearchDebugPanel automatically")

    write(path, text)


def update_packages() -> None:
    web_pkg = read_json("apps/web/package.json")
    scripts = web_pkg.setdefault("scripts", {})
    scripts["typecheck"] = "tsc --noEmit"
    write_json("apps/web/package.json", web_pkg)

    root_pkg = read_json("package.json")
    root_scripts = root_pkg.setdefault("scripts", {})
    root_scripts["typecheck:web"] = "npm --workspace apps/web run typecheck"
    write_json("package.json", root_pkg)


def append_css() -> None:
    path = "apps/web/app/globals.css"
    text = read(path)
    if ".researchDebugPanel" not in text:
        text = text.rstrip() + "\n\n" + CSS_APPEND.strip() + "\n"
    write(path, text)


def append_once(path: str, heading: str, content: str) -> None:
    target = ROOT / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.strip() + "\n", encoding="utf-8")
        print(f"wrote {path}")
        return

    text = target.read_text(encoding="utf-8")
    if heading in text:
        print(f"skipped {path}; already contains {heading}")
        return

    target.write_text(text.rstrip() + "\n\n" + content.strip() + "\n", encoding="utf-8")
    print(f"updated {path}")


README_APPEND = r'''
---

## Frontend research debug panels

The web app can render the `research-response-v1` contract from completed jobs.

Debug tabs:

```text
Summary
Sources
Crawl
Evidence
Grounding
Raw
```

The UI prefers:

```text
ui.answerMarkdown
ui.citations
ui.evidenceCoverage
ui.crawlTrace
ui.groundingStatus
```

when a contract is available, while preserving legacy report rendering as fallback.
'''


TODO_APPEND = r'''
## Done in v2 Slice 20

- [x] Added frontend research contract extractor.
- [x] Added ResearchDebugPanel with Summary, Sources, Crawl, Evidence, Grounding, and Raw tabs.
- [x] Updated answer rendering to prefer `ui.answerMarkdown`.
- [x] Updated sources rendering to prefer `ui.citations`.
- [x] Added web typecheck script.

## Now

### UI validation

- [ ] Run `npm run typecheck:web`.
- [ ] Run `npm run typecheck:api`.
- [ ] Run `npm run test:api`.
- [ ] Run `npm run typecheck:knowledge`.
- [ ] Run `npm run test:knowledge`.
- [ ] Run Docker UI smoke test.
- [ ] Confirm completed jobs show Research Debug panel.
'''


LESSONS_APPEND = r'''
## Research Engine v2 Slice 20

- Frontend should consume a stable `ui` contract and avoid parsing raw internals when possible.
- Keep raw debug JSON available, but make common traces first-class tabs.
- Contract extraction should be tolerant because jobs may store output in report metadata, agent final output, or step results.
- Legacy report rendering should remain as fallback.
'''


def main() -> None:
    assert_repo_root()

    write("apps/web/lib/researchContract.ts", RESEARCH_CONTRACT_TS)
    write("apps/web/components/ResearchDebugPanel.tsx", DEBUG_PANEL_TSX)

    patch_page()
    append_css()
    update_packages()

    append_once("README.md", "Frontend research debug panels", README_APPEND)
    append_once("docs/TODO.md", "Done in v2 Slice 20", TODO_APPEND)
    append_once("docs/LESSONS.md", "Research Engine v2 Slice 20", LESSONS_APPEND)

    print("\nDone.")
    print("\nNext commands:")
    print("  npm install")
    print("  npm run typecheck:web")
    print("  npm run typecheck:api")
    print("  npm run test:api")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("")
    print("Then run Docker UI smoke test and confirm the completed assistant bubble shows:")
    print("  Research Debug -> Summary/Sources/Crawl/Evidence/Grounding/Raw")


if __name__ == "__main__":
    main()
