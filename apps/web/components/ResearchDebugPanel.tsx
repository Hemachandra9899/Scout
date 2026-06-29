"use client";

import { useMemo, useState } from "react";
import type { ResearchContract } from "../lib/researchContract";

type Tab = "summary" | "sources" | "crawl" | "evidence" | "grounding" | "graph" | "raw";

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

function apiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

function downloadUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${apiBaseUrl()}${path}`;
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

function GraphTab({ contract }: { contract: ResearchContract }) {
  const graph = (contract.ui?.graph ?? {}) as Record<string, any>;
  const debug = contract.debug ?? {};
  const downloads = (graph.downloads ?? debug.graphReportDownloads ?? {}) as Record<string, string>;
  const relationTypeCounts = (graph.relationTypeCounts ?? {}) as Record<string, number>;
  const suggestedQuestions = safeArray<string>(graph.suggestedQuestions);
  const highDegreeNodes = safeArray<Record<string, any>>(graph.highDegreeNodes);
  const paths = safeArray<Record<string, any>>(graph.paths);
  const entities = safeArray<Record<string, any>>(graph.entities);
  const relations = safeArray<Record<string, any>>(graph.relations);

  const markdownUrl = downloadUrl(downloads.markdown ?? downloads.latestMarkdown);
  const jsonUrl = downloadUrl(downloads.json ?? downloads.latestJson);

  return (
    <div className="debugTabBody">
      <div className="debugGrid">
        <Pill label="Graph used" value={String(Boolean(graph.used ?? debug.graph?.used))} tone={graph.used ? "good" : "neutral"} />
        <Pill label="Report used" value={String(Boolean(graph.reportUsed ?? debug.graphReportUsed))} tone={graph.reportUsed ? "good" : "neutral"} />
        <Pill label="Entities" value={safeNumber(debug.graphReportNodeCount ?? debug.graph?.entityCount ?? entities.length)} />
        <Pill label="Relations" value={safeNumber(debug.graphReportRelationCount ?? debug.graph?.relationCount ?? relations.length)} />
        <Pill label="High-degree" value={safeNumber(debug.graphReportHighDegreeCount ?? highDegreeNodes.length)} />
        <Pill label="Paths" value={safeNumber(debug.graphPathCount ?? debug.graph?.pathCount ?? paths.length)} />
      </div>

      {markdownUrl || jsonUrl ? (
        <div className="debugActions">
          {markdownUrl ? (
            <a className="smallButton" href={markdownUrl} target="_blank" rel="noopener noreferrer">
              Download GRAPH_REPORT.md
            </a>
          ) : null}
          {jsonUrl ? (
            <a className="smallButton" href={jsonUrl} target="_blank" rel="noopener noreferrer">
              Download JSON
            </a>
          ) : null}
        </div>
      ) : null}

      {Object.keys(relationTypeCounts).length > 0 ? (
        <>
          <h4>Relation type counts</h4>
          <div className="debugList">
            {Object.entries(relationTypeCounts).slice(0, 12).map(([type, count]) => (
              <div key={type} className="debugResourceRow">
                <b>{type}</b>
                <small>{count} relation(s)</small>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {highDegreeNodes.length > 0 ? (
        <>
          <h4>High-degree nodes</h4>
          <div className="debugList">
            {highDegreeNodes.slice(0, 10).map((item, index) => {
              const entity = item.entity ?? item;
              return (
                <div key={`${entity.id ?? entity.name ?? index}-${index}`} className="debugResourceRow">
                  <b>{entity.name ?? "Unknown node"}</b>
                  <small>{entity.type ?? "entity"} · degree {item.degree ?? "—"}</small>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {paths.length > 0 ? (
        <>
          <h4>Graph paths</h4>
          <div className="debugList">
            {paths.slice(0, 10).map((path, index) => {
              const relation = safeArray<Record<string, any>>(path.relations)[0];
              return (
                <div key={index} className="debugResourceRow">
                  <b>{path.source?.name ?? "source"} → {path.target?.name ?? "target"}</b>
                  <small>{relation?.relationType ?? "relation"} · score {path.score ?? "—"}</small>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {suggestedQuestions.length > 0 ? (
        <>
          <h4>Suggested questions</h4>
          <div className="debugWarnings">
            {suggestedQuestions.slice(0, 8).map((question, index) => (
              <div key={index} className="debugWarning">
                {question}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <details className="debugDetails">
        <summary>Raw graph payload</summary>
        <JsonBlock value={graph} />
      </details>
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
      { id: "graph", label: "Graph" },
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
          {tab === "graph" ? <GraphTab contract={contract} /> : null}
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
