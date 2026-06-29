"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Conversation, ProjectDocument, ResearchJob } from "../lib/api";
import { getContractAnswerMarkdown, getContractSources, getResearchContract } from "../lib/researchContract";
import { FileUploadPanel } from "../components/FileUploadPanel";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { MessageContent } from "../components/MessageContent";
import { SourcesPanel } from "../components/SourcesPanel";
import { RunProgress } from "../components/RunProgress";
import { ResearchDebugPanel } from "../components/ResearchDebugPanel";
import { Sidebar } from "../components/Sidebar";
import { Composer } from "../components/Composer";
import { AccountMenu } from "../components/AccountMenu";
import { SettingsModal } from "../components/SettingsModal";
import { AppsMenu } from "../components/AppsMenu";
import { ComposerPlusMenu } from "../components/ComposerPlusMenu";
import { MemoryUploadModal } from "../components/MemoryUploadModal";
import { DocumentUploadModal } from "../components/DocumentUploadModal";
import { MemoryGraph } from "../components/MemoryGraph";
import { AgentRunsPanel } from "../components/AgentRunsPanel";
import { useProjects, useCreateProject } from "../hooks/useProjects";
import { useProjectJobs } from "../hooks/useProjectJobs";
import { useProjectDocuments } from "../hooks/useDocuments";
import {
  useProjectConversations,
  useConversation,
  useCreateConversation,
} from "../hooks/useConversations";
import {
  useCreateResearchJob,
  useResearchJobStatus,
  useResearchJob,
} from "../hooks/useResearchJob";

type Theme = "dark" | "light";

function isGenericAnswer(value: string) {
  const normalized = value.trim().toLowerCase();

  if (
    [
      "done",
      "completed",
      "all questions have been answered.",
      "the task is complete.",
      "task complete",
    ].includes(normalized)
  ) {
    return true;
  }

  const placeholderPatterns = [
    "the comparison table",
    "the table above",
    "as shown above",
    "are provided above",
    "is provided above",
    "see above",
    "refer to the",
    "see the table",
  ];

  return placeholderPatterns.some((p) => normalized.includes(p));
}

function extractStdout(job?: ResearchJob) {
  const runs = job?.agentRuns || [];

  for (const run of runs) {
    const result = run.finalOutput as any;
    const steps = Array.isArray(result?.steps) ? result.steps : [];

    for (const step of [...steps].reverse()) {
      if (typeof step?.stdout === "string" && step.stdout.trim()) {
        return step.stdout.trim();
      }
    }
  }

  return "";
}

function answerText(job?: ResearchJob) {
  if (!job) return "";

  const contractAnswer = getContractAnswerMarkdown(job);
  if (contractAnswer && !isGenericAnswer(contractAnswer)) return contractAnswer;

  const report = job.reports?.[0];

  if (report?.content && !isGenericAnswer(report.content)) {
    return report.content;
  }

  const stdout = extractStdout(job);
  if (stdout) return stdout;

  const finalOutput = job.agentRuns?.[0]?.finalOutput as any;
  const final = finalOutput?.final;

  if (typeof final === "string" && !isGenericAnswer(final)) return final;

  return job.error || "";
}

function getSources(job?: ResearchJob) {
  const contractSources = getContractSources(job);
  if (contractSources.length > 0) return contractSources;

  const report = job?.reports?.[0] as any;
  const sources = report?.metadata?.sources;

  if (Array.isArray(sources)) return sources;

  const resultSources = (job?.agentRuns?.[0]?.finalOutput as any)?.sources;
  if (Array.isArray(resultSources)) return resultSources;

  return [];
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function TypewriterText({ text }: { text: string }) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    if (!text) {
      setDisplayedText("");
      return;
    }

    const tokens = text.split(/(\s+)/);
    setDisplayedText("");

    let currentIdx = 0;
    const interval = setInterval(() => {
      setDisplayedText((prev) => {
        const next = tokens.slice(0, currentIdx + 1).join("");
        currentIdx++;
        if (currentIdx >= tokens.length) {
          clearInterval(interval);
        }
        return next;
      });
    }, 40);

    return () => clearInterval(interval);
  }, [text]);

  return <span className="answerText">{displayedText}</span>;
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [activeConversationId, setActiveConversationId] = useState("");
  const [activeJobId, setActiveJobId] = useState("");
  const [projectName, setProjectName] = useState("Scout");
  const [question, setQuestion] = useState(
    "Explain what Scout is in simple words.",
  );
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [memoryUploadOpen, setMemoryUploadOpen] = useState(false);
  const [documentUploadOpen, setDocumentUploadOpen] = useState(false);
  const [activeApp, setActiveApp] = useState<string | null>(null);

  const { data: deps = {} } = useQuery({
    queryKey: ["health", "deps"],
    queryFn: api.deps,
  });
  const { data: projects = [] } = useProjects();
  const { data: jobs = [] } = useProjectJobs(selectedProjectId);
  const { data: documents = [] } = useProjectDocuments(selectedProjectId);
  const { data: conversations = [] } = useProjectConversations(selectedProjectId);
  const { data: activeConversation } = useConversation(activeConversationId);

  const createProjectMutation = useCreateProject();
  const createResearchJob = useCreateResearchJob(selectedProjectId);
  const createConversation = useCreateConversation(selectedProjectId);

  const { data: activeJobStatus } = useResearchJobStatus(activeJobId);
  const shouldFetchFullJob =
    activeJobStatus?.status === "COMPLETED" ||
    activeJobStatus?.status === "FAILED";
  const { data: activeFullJob } = useResearchJob(activeJobId, shouldFetchFullJob);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const activeJob = useMemo(
    () => activeFullJob || jobs.find((j) => j.id === activeJobId),
    [activeFullJob, jobs, activeJobId],
  );

  const messages = useMemo(() => {
    return activeConversation?.messages || [];
  }, [activeConversation]);

  const stages = useMemo(() => {
    if (!activeJob) {
      return { query: false, agent: false, vector: false, rlm: false, output: false, active: "" };
    }

    const status = activeJob.status?.toLowerCase() || "";
    const runsCount = activeJob.agentRuns?.length || 0;
    let query = true;
    let agent = false;
    let vector = false;
    let rlm = false;
    let output = false;
    let active = "query";

    if (status === "queued") {
      active = "query";
    } else if (status === "running") {
      agent = true;
      active = "agent";
      if (runsCount > 0) {
        vector = true;
        active = "vector";
      }
      const totalSteps = activeJob.agentRuns?.reduce(
        (sum, run) => sum + (run.steps?.length || 0),
        0,
      ) || 0;
      if (totalSteps > 0) {
        rlm = true;
        active = "rlm";
      }
    } else if (status === "completed") {
      agent = true;
      vector = true;
      rlm = true;
      output = true;
      active = "output";
    } else if (status === "failed") {
      agent = runsCount > 0;
      vector = runsCount > 0;
      rlm = runsCount > 0;
      active = "failed";
    }

    return { query, agent, vector, rlm, output, active };
  }, [activeJob]);

  const handleNewChat = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const conversation = await createConversation.mutateAsync("New Chat");
      setActiveConversationId(conversation.id);
      setActiveJobId("");
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedProjectId, createConversation]);

  async function sendMessage(text: string) {
    if (!text.trim()) return;
    let pid = selectedProjectId || projects[0]?.id;
    if (!pid) {
      setError("Please create or select a project first.");
      return;
    }
    setError("");
    try {
      const result = await createResearchJob.mutateAsync({
        question: text,
        conversationId: activeConversationId || undefined,
      });
      setActiveConversationId(result.conversationId);
      setActiveJobId(result.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function selectConversation(id: string) {
    setActiveConversationId(id);
    setActiveJobId("");
  }

  async function createProject() {
    setError("");
    try {
      const project = await createProjectMutation.mutateAsync({
        name: projectName || "Untitled Project",
        description: "Created from Scout UI",
      });
      setSelectedProjectId(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("rlm-theme") as Theme | null;
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("rlm-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (selectedProjectId) {
      setActiveConversationId("");
      setActiveJobId("");
    }
  }, [selectedProjectId]);

  return (
    <main className="app-container">
      <div style={{ display: "flex", flexDirection: "column", height: "100%", width: sidebarOpen ? "250px" : "0px", overflow: "hidden", flexShrink: 0, transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}>
        <Sidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          conversations={conversations}
          activeConversationId={activeConversationId}
          sidebarOpen={sidebarOpen}
          onNewChat={handleNewChat}
          onSelectProject={setSelectedProjectId}
          onSelectConversation={selectConversation}
          onToggle={() => setSidebarOpen(false)}
        />
        <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)" }}>
          <AccountMenu onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </div>

      <section className="chat-container">
        <header className="chatHeader">
          <div className="header-left">
            {!sidebarOpen && (
              <button
                className="menu-toggle"
                onClick={() => setSidebarOpen(true)}
                title="Expand sidebar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}
            <div className="header-title">
              <p>{selectedProject?.name || "No project selected"}</p>
              <h2>
                {activeConversationId ? "Chat" : "Scout Playground"}
              </h2>
            </div>
          </div>

          <div className="header-right">
            <div className="status-row">
              {Object.entries(deps).map(([key, value]) => (
                <div
                  key={key}
                  className={`status-indicator ${value.includes("ok") ? "ok" : ""}`}
                  title={`${key}: ${value}`}
                >
                  <span className="dot" />
                  <span>{key === "rlmRuntime" ? "rlm" : key}</span>
                </div>
              ))}
            </div>
            <button
              className="theme-toggle-btn"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "☀ Light" : "☾ Dark"}
            </button>
          </div>
        </header>

        <div className="workspace-wrapper">
          <div className="workspace-left">
            {activeApp === "memory-graph" ? (
              <MemoryGraph
                projectId={selectedProjectId || projects[0]?.id || ""}
                onClose={() => setActiveApp(null)}
              />
            ) : activeApp === "agent-runs" ? (
              <AgentRunsPanel
                projectId={selectedProjectId || projects[0]?.id || ""}
                onClose={() => setActiveApp(null)}
              />
            ) : !devMode ? (
              <section className="messages-wrapper">
                {messages.length > 0 ? (
                  <div className="messages">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`bubble ${msg.role === "user" ? "user" : "assistant"}`}
                      >
                        <b>{msg.role === "user" ? "You" : "Scout"}</b>
                        <p>{msg.content}</p>
                      </div>
                    ))}
                    {activeJob && !["completed", "failed"].includes(activeJob.status?.toLowerCase() || "") && (
                      <div className="bubble assistant">
                        <b>Scout</b>
                        <RunProgress status={activeJob.status} />
                        <p className="answerText text-muted">Running research...</p>
                      </div>
                    )}
                    {activeJob && ["completed", "failed"].includes(activeJob.status?.toLowerCase() || "") && (
                      <div className="bubble assistant">
                        <b>Scout</b>
                        <MessageContent content={answerText(activeJob)} />
                        <SourcesPanel sources={getSources(activeJob)} />
                        <ResearchDebugPanel contract={getResearchContract(activeJob)} />
                        {activeJob.agentRuns?.length ? (
                          <details className="trace-details">
                            <summary>
                              Trace Logs ({activeJob.agentRuns.length} runs)
                            </summary>
                            <pre className="trace-pre">
                              {JSON.stringify(activeJob.agentRuns, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="welcome-dashboard">
                    <div className="welcome-logo">SCOUT</div>
                    <div className="welcome-subtitle">
                      API, Docs and Recursive AI Research Engine
                    </div>
                    <div className="presets-container">
                      <button
                        className="preset-pill"
                        onClick={() => setQuestion("Deep search recursive runtime logs")}
                      >
                        Search
                      </button>
                      <button
                        className="preset-pill"
                        onClick={() => setQuestion("Extract structured entities from data sources")}
                      >
                        Extract
                      </button>
                      <button
                        className="preset-pill"
                        onClick={() => setQuestion("Crawl nested API documentations recursively")}
                      >
                        Crawl
                      </button>
                    </div>
                  </div>
                )}
                {error ? (
                  <div className="messages">
                    <div className="error-message">{error}</div>
                  </div>
                ) : null}
              </section>
            ) : (
              <div className="workflow-canvas">
                {createResearchJob.isPending && (
                  <>
                    <div className="cloud-code-particle" style={{ left: "42%", animationDelay: "0s" }}>
                      {"const rlm = new RLM()"}
                    </div>
                    <div className="cloud-code-particle" style={{ left: "56%", animationDelay: "1.5s" }}>
                      {"qdrant.query({ text })"}
                    </div>
                    <div className="cloud-code-particle" style={{ left: "48%", animationDelay: "3s" }}>
                      {"redis.set(cache_key)"}
                    </div>
                    <div className="cloud-code-particle" style={{ left: "52%", animationDelay: "4.5s" }}>
                      {"agent.reason(task)"}
                    </div>
                  </>
                )}

                <div className="workflow-nodes">
                  {[
                    { key: "output", color: "var(--lime)", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", children: "M14 2 14 8 20 8 M16 13H8 M16 17H8", title: "OUTPUT REPORT", desc: "Final Knowledge Summary" },
                    { key: "rlm", color: "var(--pink)", icon: "M13 2 3 14 12 14 11 22 21 10 12 10 13 2", children: "", title: "RLM RUNTIME", desc: "Recursive Execution Loop" },
                    { key: "vector", color: "var(--orange)", icon: "M12 5C7.34 5 3 5.9 3 7v4c0 1.66 4 3 9 3s9-1.34 9-3V7", children: "M3 12c0 1.66 4 3 9 3s9-1.34 9-3", title: "VECTOR RETRIEVE", desc: "Qdrant DB & Cache Query" },
                    { key: "agent", color: "var(--cyan)", icon: "M12 2a4 4 0 0 0-4 4v1H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z", children: "M12 11v6M9 14h6", title: "AGENT PLANNER", desc: "Reasoning Task Planning" },
                    { key: "query", color: "var(--lime)", icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", children: "", title: "QUERY INPUT", desc: activeJob ? activeJob.question.slice(0, 25) + (activeJob.question.length > 25 ? "..." : "") : "Idle" },
                  ].map((card, idx) => (
                    <div key={card.key}>
                      <div className={`flow-card-wrapper ${stages[card.key] ? "visible" : ""}`}>
                        <div className={`flow-card ${stages.active === card.key ? "active" : ""}`}>
                          <div className="flow-card-icon" style={{ backgroundColor: card.color }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5">
                              <path d={card.icon} />
                              {card.children && <><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></>}
                            </svg>
                          </div>
                          <div className="flow-card-body">
                            <div className="flow-card-title">{card.title}</div>
                            <div className="flow-card-desc">{card.desc}</div>
                          </div>
                          {stages.active === card.key && (
                            <div className="flow-card-tag" style={{ backgroundColor: card.color }}>
                              {card.key === "query" ? "User Query" : card.key === "agent" ? "Agent Planning" : card.key === "vector" ? "DB Fetching" : card.key === "rlm" ? "RLM Loop" : "Completed"}
                            </div>
                          )}
                        </div>
                      </div>
                      {idx < 4 && stages[card.key] && <div className="flow-connector" />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!activeApp && (
              <div style={{ position: "relative" }}>
                <ComposerPlusMenu
                  open={plusMenuOpen}
                  onClose={() => setPlusMenuOpen(false)}
                  onAction={(action) => {
                    if (action === "agent-mode") {
                      setActiveApp("agent-runs");
                    } else if (action === "memory-upload") {
                      setMemoryUploadOpen(true);
                    } else if (action === "document-upload") {
                      setDocumentUploadOpen(true);
                    } else if (action === "memory-graph") {
                      setActiveApp("memory-graph");
                    } else if (action === "repo-graph") {
                      setAppsOpen(true);
                    }
                  }}
                />
                <Composer
                  value={question}
                  onChange={setQuestion}
                  onSend={() => sendMessage(question)}
                  onOpenPlusMenu={() => setPlusMenuOpen(true)}
                  disabled={createResearchJob.isPending}
                />
              </div>
            )}
          </div>

          {devMode && (
            <div className="dev-console-panel">
              <div className="console-header">
                <h3>Console Sandbox Trace</h3>
                <span
                  style={{
                    color: "var(--lime)",
                    fontFamily: "var(--font-pixel)",
                    fontSize: "14px",
                  }}
                >
                  {activeJob ? activeJob.status : "Idle"}
                </span>
              </div>
              <div className="console-body">
                {activeJob ? (
                  <>
                    <div className="console-line">
                      <span className="timestamp">[00:01]</span>
                      <span className="tag">[SYSTEM]</span>
                      <span>
                        Initialized research sandbox session:{" "}
                        {shortId(activeJob.id)}
                      </span>
                    </div>
                    <div className="console-line">
                      <span className="timestamp">[00:02]</span>
                      <span className="tag">[SANDBOX]</span>
                      <span>
                        Running RLM executive with prompt input.
                      </span>
                    </div>
                    {activeJob.agentRuns?.map((run, idx) => (
                      <div key={run.id} className="console-line">
                        <span className="timestamp">
                          [00:{idx + 3}]
                        </span>
                        <span className="tag">[AGENT_RUN]</span>
                        <span>
                          Depth {run.depth}: status={run.status}, query="
                          {run.query}"
                        </span>
                        {run.steps?.map((step) => (
                          <div
                            key={step.id}
                            style={{
                              paddingLeft: "12px",
                              color: "var(--orange)",
                            }}
                          >
                            <span>
                              Step {step.stepIndex}:{" "}
                              {step.stdout || "Evaluating step..."}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {activeJob.error && (
                      <div
                        className="console-line"
                        style={{ color: "var(--bad)" }}
                      >
                        <span className="timestamp">[ERR]</span>
                        <span>{activeJob.error}</span>
                      </div>
                    )}
                    {activeJob.status?.toLowerCase() === "completed" && (
                      <>
                        <div
                          className="console-line"
                          style={{ color: "var(--lime)" }}
                        >
                          <span className="timestamp">[DONE]</span>
                          <span>Report generated successfully!</span>
                        </div>
                        <div className="console-answer-section">
                          <div className="console-answer-header">
                            &gt; FINAL REPORT OUTPUT:
                          </div>
                          <TypewriterText
                            text={answerText(activeJob)}
                          />
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="muted">
                    Waiting for research sandbox query...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <MemoryUploadModal
        open={memoryUploadOpen}
        onClose={() => setMemoryUploadOpen(false)}
        projectId={selectedProjectId || projects[0]?.id || ""}
      />
      <DocumentUploadModal
        open={documentUploadOpen}
        onClose={() => setDocumentUploadOpen(false)}
        projectId={selectedProjectId || projects[0]?.id || ""}
      />
    </main>
  );
}
