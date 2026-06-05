"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import Workspace from "../components/Workspace";
import * as api from "../services/research";
import type { Theme } from "../types";
import type { Project, ResearchJob } from "../types/api";

export default function Home() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [apiHealth, setApiHealth] = useState("checking");
  const [deps, setDeps] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [activeJobId, setActiveJobId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [question, setQuestion] = useState(
    "Compare FalkorDB and Neo4j for GraphRAG."
  );
  const [error, setError] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isCreatingJob, setIsCreatingJob] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  async function loadHealth() {
    try {
      const [h, d] = await Promise.all([api.health(), api.deps()]);
      setApiHealth(`${h.status}:${h.service}`);
      setDeps(d);
    } catch (e) {
      setApiHealth("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadProjects() {
    const rows = await api.listProjects();
    setProjects(rows);
    if (!selectedProjectId && rows.length > 0) {
      setSelectedProjectId(rows[0].id);
    }
  }

  async function loadJobs(projectId: string) {
    if (!projectId) return;
    const rows = await api.listProjectJobs(projectId);
    setJobs(rows);
    if (!activeJobId && rows.length > 0) {
      setActiveJobId(rows[0].id);
    }
  }

  async function createProject() {
    if (!projectName.trim()) return;
    setError("");
    setIsCreatingProject(true);
    try {
      const project = await api.createProject({
        name: projectName.trim(),
        description: "Created from RLM Forge UI",
      });
      setProjectName("");
      setSelectedProjectId(project.id);
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function createJob() {
    if (!selectedProjectId || !question.trim()) return;
    setError("");
    setIsCreatingJob(true);
    try {
      const created = await api.createResearchJob({
        projectId: selectedProjectId,
        question: question.trim(),
      });
      setActiveJobId(created.jobId);
      await loadJobs(selectedProjectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsCreatingJob(false);
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("rlm-theme") as Theme | null;
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("rlm-theme", theme);
  }, [theme]);

  useEffect(() => {
    loadHealth();
    loadProjects().catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadJobs(selectedProjectId).catch((e) =>
        setError(e instanceof Error ? e.message : String(e))
      );
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!activeJobId || !selectedProjectId) return;
    const timer = setInterval(async () => {
      const job = await api.getResearchJob(activeJobId);
      setJobs((prev) => {
        const without = prev.filter((j) => j.id !== job.id);
        return [job, ...without];
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [activeJobId, selectedProjectId]);

  return (
    <main className="shell">
      <Sidebar
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        apiHealth={apiHealth}
        deps={deps}
        projectName={projectName}
        onProjectNameChange={setProjectName}
        onCreateProject={createProject}
        isCreatingProject={isCreatingProject}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={(id) => {
          setSelectedProjectId(id);
          setActiveJobId("");
        }}
      />
      <Workspace
        selectedProject={selectedProject}
        error={error}
        question={question}
        onQuestionChange={setQuestion}
        onCreateJob={createJob}
        isCreatingJob={isCreatingJob}
        selectedProjectId={selectedProjectId}
        jobs={jobs}
        activeJobId={activeJobId}
        onSelectJob={setActiveJobId}
      />
    </main>
  );
}
