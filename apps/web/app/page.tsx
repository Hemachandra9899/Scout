"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, chatStream, Conversation, ProjectDocument, ResearchJob } from "../lib/api";
import { queryKeys } from "../lib/query/queryKeys";
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
import { DevTerminal } from "../components/DevTerminal";
import { useProjects, useCreateProject } from "../hooks/useProjects";
import { useProjectJobs } from "../hooks/useProjectJobs";
import { useProjectDocuments } from "../hooks/useDocuments";
import {
  useProjectConversations,
  useConversation,
  useCreateConversation,
} from "../hooks/useConversations";
import {
  useResearchJobStatus,
  useResearchJob,
} from "../hooks/useResearchJob";

type Theme = "dark" | "light";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Helpers ─────────────────────────────────────────────────
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
  if (report?.content && !isGenericAnswer(report.content)) return report.content;
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

// ─── Component ───────────────────────────────────────────────
export default function Home() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [activeConversationId, setActiveConversationId] = useState("");
  const [activeJobId, setActiveJobId] = useState("");
  const [projectName, setProjectName] = useState("Scout");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [memoryUploadOpen, setMemoryUploadOpen] = useState(false);
  const [documentUploadOpen, setDocumentUploadOpen] = useState(false);
  const [activeApp, setActiveApp] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<string>("auto");
  const [streaming, setStreaming] = useState<{
    question: string;
    answer: string;
    thinking: string;
    flow: string;
    sources: unknown[];
    active: boolean;
  } | null>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const isSendingRef = useRef(false);
  const MIN_THINKING_MS = 600;
  const queryClient = useQueryClient();

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

  const showStreamingBubble = useMemo(() => {
    if (!streaming) return false;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && lastMsg.content === streaming.answer) {
      return false;
    }
    return true;
  }, [messages, streaming]);

  const currentAnswer = useMemo(() => answerText(activeJob), [activeJob]);

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
    if (!text.trim() || streaming?.active || isSendingRef.current) return;
    const pid = selectedProjectId || projects[0]?.id;
    if (!pid) {
      setError("Please create or select a project first.");
      return;
    }
    setError("");
    setQuestion("");
    setActiveJobId("");
    isSendingRef.current = true;

    const mode = composerMode;
    let conversationId = activeConversationId || undefined;

    // Shared buffers between the SSE producer and the typewriter consumer.
    let fullAnswer = "";
    let networkDone = false;
    let sources: unknown[] = [];

    setStreaming({
      question: text,
      answer: "",
      thinking: "Thinking",
      flow: "",
      sources: [],
      active: true,
    });

    // Producer: drain the SSE stream into the shared buffers.
    const pump = chatStream(
      { projectId: pid, query: text, mode, conversationId },
      (event, data) => {
        if (event === "conversation" && data.conversationId) {
          conversationId = data.conversationId;
        } else if (event === "intent") {
          setStreaming((s) => (s ? { ...s, flow: data.flow ?? "" } : s));
        } else if (event === "thinking") {
          setStreaming((s) => (s ? { ...s, thinking: data.label ?? s.thinking } : s));
        } else if (event === "token") {
          fullAnswer += data.delta ?? "";
        } else if (event === "sources") {
          sources = data.sources ?? [];
        } else if (event === "error") {
          if (!fullAnswer) fullAnswer = `Error: ${data.error}`;
        }
      },
    )
      .then(() => {
        networkDone = true;
      })
      .catch((e) => {
        networkDone = true;
        if (!fullAnswer) fullAnswer = e instanceof Error ? e.message : String(e);
      });

    // Consumer: enforce a minimum visible "thinking" phase, then reveal the answer
    // progressively (typewriter) — so thinking + streaming are always visible,
    // regardless of how fast the backend delivered the tokens.
    const startedAt = Date.now();
    let lastLabelUpdate = Date.now();
    let labelIdx = 0;
    const thinkingLabels = [
      "Searching web and local databases",
      "Extracting key details from sources",
      "Synthesizing final answer",
    ];

    while (
      (Date.now() - startedAt < MIN_THINKING_MS || !networkDone) &&
      fullAnswer.length === 0
    ) {
      await sleep(40);
      
      // Cycle thinking labels to show progress / running state
      if (Date.now() - lastLabelUpdate > 3000) {
        const nextLabel = thinkingLabels[labelIdx];
        if (nextLabel) {
          setStreaming((s) => (s ? { ...s, thinking: nextLabel } : s));
          labelIdx++;
        }
        lastLabelUpdate = Date.now();
      }
    }

    const waited = Date.now() - startedAt;
    if (waited < MIN_THINKING_MS) await sleep(MIN_THINKING_MS - waited);

    let shown = 0;
    while (true) {
      if (shown < fullAnswer.length) {
        const backlog = fullAnswer.length - shown;
        const step = backlog > 150 ? 6 : backlog > 50 ? 3 : 1;
        shown = Math.min(fullAnswer.length, shown + step);
        const slice = fullAnswer.slice(0, shown);
        setStreaming((s) => (s ? { ...s, answer: slice, thinking: "" } : s));
        await sleep(20);
      } else if (networkDone) {
        break;
      } else {
        await sleep(30);
      }
    }

    try {
      await pump;
      setStreaming((s) =>
        s ? { ...s, answer: fullAnswer, thinking: "", sources, active: false } : s,
      );

      setComposerMode("auto");
      if (conversationId) {
        try {
          await queryClient.fetchQuery({
            queryKey: queryKeys.conversation(conversationId),
            queryFn: () => api.getConversation(conversationId!),
          });
        } catch {
          /* keep the stream bubble content if the refetch fails */
        }
        setActiveConversationId(conversationId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectConversations(pid),
      });
    } finally {
      isSendingRef.current = false;
      setStreaming(null);
    }
  }

  function selectConversation(id: string) {
    setActiveConversationId(id);
    setActiveJobId("");
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

  // Auto-select first project
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSettingsOpen(false);
        setAppsOpen(false);
        setMemoryUploadOpen(false);
        setDocumentUploadOpen(false);
        setPlusMenuOpen(false);
        setActiveApp(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Greet based on time
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h >= 22 || h < 4) return "Hi night owl. What should we do now?";
    if (h < 12) return "Good morning. How can I help?";
    if (h < 17) return "Good afternoon. How can I help?";
    return "Good evening. How can I help?";
  }, []);

  const isJobRunning =
    activeJob && !["completed", "failed"].includes(activeJob.status?.toLowerCase() || "");
  const isJobDone =
    activeJob && ["completed", "failed"].includes(activeJob.status?.toLowerCase() || "");

  return (
    <main className="app-container">
      {/* ── Sidebar column ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          width: sidebarOpen ? "var(--sidebar-width)" : "0px",
          overflow: "hidden",
          flexShrink: 0,
          transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
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
          onCreateProject={async (name) => {
            try {
              const proj = await createProjectMutation.mutateAsync({ name });
              setSelectedProjectId(proj.id);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
        {/* Account menu pinned to bottom of sidebar */}
        <div
          style={{
            marginTop: "auto",
            borderTop: "1px solid var(--line)",
            background: "var(--panel)",
            flexShrink: 0,
            opacity: sidebarOpen ? 1 : 0,
            transition: "opacity 0.2s ease",
          }}
        >
          <AccountMenu onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </div>

      {/* ── Main content ── */}
      <section className="chat-container">
        {/* Header */}
        <header className="chatHeader">
          <div className="header-left">
            {/* Sidebar open toggle (when collapsed) */}
            {!sidebarOpen && (
              <button
                className="menu-toggle"
                onClick={() => setSidebarOpen(true)}
                title="Open sidebar"
                aria-label="Open sidebar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
                </svg>
              </button>
            )}

            {/* Inline new-chat button when sidebar is collapsed */}
            {!sidebarOpen && (
              <button
                className="menu-toggle"
                onClick={handleNewChat}
                title="New chat"
                aria-label="New chat"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
                </svg>
              </button>
            )}

            <div className="header-title">
              <h2>
                {activeApp === "memory-graph"
                  ? "Memory Graph"
                  : activeApp === "agent-runs"
                  ? "Agent Runs"
                  : activeConversationId
                  ? (conversations.find((c) => c.id === activeConversationId)?.title || "Chat")
                  : "Scout"}
              </h2>
            </div>
          </div>

          <div className="header-right">
            {/* API health status dots */}
            <div className="status-row">
              {Object.entries(deps).map(([key, value]) => (
                <div
                  key={key}
                  className={`status-indicator ${(value as string).includes("ok") ? "ok" : ""}`}
                  title={`${key}: ${value}`}
                >
                  <span className="dot" />
                  <span>{key === "rlmRuntime" ? "rlm" : key}</span>
                </div>
              ))}
            </div>

            {/* Dev mode terminal toggle */}
            <button
              id="dev-mode-toggle"
              className={`dev-mode-toggle-btn ${devMode ? "active" : ""}`}
              onClick={() => setDevMode(!devMode)}
              title={devMode ? "Close Terminal" : "Open Dev Terminal"}
              aria-label="Toggle dev terminal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              {devMode ? "Close Terminal" : "Dev Terminal"}
            </button>

            {/* Theme toggle */}
            <button
              className="theme-toggle-btn"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </header>

        {/* Workspace */}
        <div className="workspace-wrapper">
          <div className="workspace-left">
            {/* ── App views ── */}
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
            ) : (
              /* ── Chat view ── */
              <section className="messages-wrapper" aria-live="polite">
                {messages.length > 0 || streaming ? (
                  <div className="messages">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`bubble ${msg.role === "user" ? "user" : "assistant"}`}
                      >
                        {msg.role === "user" ? (
                          <p>{msg.content}</p>
                        ) : (
                          <MessageContent content={msg.content} />
                        )}
                      </div>
                    ))}

                    {/* In-flight / just-finished streamed turn */}
                    {showStreamingBubble && streaming && (
                      <>
                        <div className="bubble user">
                          <p>{streaming.question}</p>
                        </div>
                        <div className="bubble assistant">
                          {streaming.answer ? (
                            <div className="streaming-answer">
                              <MessageContent content={streaming.answer} isStreaming={streaming.active} />
                            </div>
                          ) : (
                            <div className="thinking-indicator" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-secondary)" }}>
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
                              <span style={{ fontSize: 14, fontWeight: 400 }}>
                                {streaming.thinking || "Thinking"}
                                {streaming.flow ? ` · ${streaming.flow}` : ""}…
                              </span>
                            </div>
                          )}
                          {devMode && streaming.sources.length > 0 && (
                            <SourcesPanel sources={streaming.sources as any} />
                          )}
                        </div>
                      </>
                    )}

                    {/* Dev-only legacy job trace (agent runs, research debug) */}
                    {devMode && isJobRunning && (
                      <div className="bubble assistant">
                        <RunProgress status={activeJob!.status} devMode={devMode} />
                      </div>
                    )}
                    {devMode && isJobDone && (
                      <div className="bubble assistant">
                        <MessageContent content={currentAnswer} />
                        <SourcesPanel sources={getSources(activeJob)} />
                        <ResearchDebugPanel contract={getResearchContract(activeJob)} />
                        {activeJob!.agentRuns?.length ? (
                          <details className="trace-details">
                            <summary>
                              Trace Logs ({activeJob!.agentRuns.length} run{activeJob!.agentRuns.length !== 1 ? "s" : ""})
                            </summary>
                            <pre className="trace-pre">
                              {JSON.stringify(activeJob!.agentRuns, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── Welcome dashboard ── */
                  <div className="welcome-dashboard">
                    <div className="welcome-logo">Scout</div>
                    <h1 className="welcome-greeting" suppressHydrationWarning>{greeting}</h1>
                    <div className="presets-container">
                      <button
                        className="preset-pill"
                        onClick={() => setQuestion("Deep search recursive runtime logs and summarize findings")}
                      >
                        Deep search runtime logs
                      </button>
                      <button
                        className="preset-pill"
                        onClick={() => setQuestion("Extract structured entities from all data sources")}
                      >
                        Extract structured entities
                      </button>
                      <button
                        className="preset-pill"
                        onClick={() => setQuestion("Crawl and analyze nested API documentation recursively")}
                      >
                        Crawl API documentation
                      </button>
                      <button
                        className="preset-pill"
                        onClick={() => setQuestion("Summarize all recent memory entries and decisions")}
                      >
                        Summarize memory graph
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="messages" style={{ width: "100%", maxWidth: 760 }}>
                    <div className="error-message">{error}</div>
                  </div>
                )}
              </section>
            )}

            {/* ── Composer (only in chat view) ── */}
            {!activeApp && (
              <div style={{ position: "relative", width: "100%" }}>
                <ComposerPlusMenu
                  open={plusMenuOpen}
                  onClose={() => setPlusMenuOpen(false)}
                  triggerRef={plusBtnRef}
                  onAction={(action) => {
                    if (action === "agent-mode") {
                      setComposerMode("agent");
                    } else if (action === "web-research") {
                      setComposerMode("web_research");
                    } else if (action === "deep-research") {
                      setComposerMode("deep_research");
                    } else if (action === "github-repo") {
                      setComposerMode("github_repo");
                    } else if (action === "memory-upload") {
                      setMemoryUploadOpen(true);
                    } else if (action === "document-upload" || action === "file-upload") {
                      setDocumentUploadOpen(true);
                    } else if (action === "memory-graph") {
                      setActiveApp("memory-graph");
                    }
                  }}
                />
                <Composer
                  value={question}
                  onChange={setQuestion}
                  onSend={() => sendMessage(question)}
                  onOpenPlusMenu={() => setPlusMenuOpen((prev) => !prev)}
                  disabled={Boolean(streaming?.active) || isSendingRef.current}
                  mode={composerMode}
                  onClearMode={() => setComposerMode("auto")}
                  plusBtnRef={plusBtnRef}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Dev Terminal Overlay ── */}
      <DevTerminal
        open={devMode}
        onClose={() => setDevMode(false)}
        activeJob={activeJob}
        answerText={currentAnswer}
      />

      {/* ── Modals ── */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        deps={deps}
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
      {appsOpen && (
        <AppsMenu
          open={appsOpen}
          onClose={() => setAppsOpen(false)}
          onSelectApp={(app) => {
            setAppsOpen(false);
            setActiveApp(app);
          }}
        />
      )}
    </main>
  );
}
