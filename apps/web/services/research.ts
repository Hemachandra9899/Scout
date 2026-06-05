import { request } from "../lib/api";
import type { Project, ResearchJob } from "../types/api";

export function health() {
  return request<{ status: string; service: string }>("/health");
}

export function deps() {
  return request<Record<string, string>>("/health/deps");
}

export function listProjects() {
  return request<Project[]>("/projects");
}

export function createProject(body: { name: string; description?: string }) {
  return request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listProjectJobs(projectId: string) {
  return request<ResearchJob[]>(`/projects/${projectId}/jobs`);
}

export function createResearchJob(body: {
  projectId: string;
  question: string;
}) {
  return request<{ jobId: string; queueJobId: string; status: string }>(
    "/research-jobs",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function getResearchJob(jobId: string) {
  return request<ResearchJob>(`/research-jobs/${jobId}`);
}
