export const queryKeys = {
  projects: ["projects"] as const,
  projectJobs: (projectId: string) => ["project-jobs", projectId] as const,
  researchJob: (jobId: string) => ["research-job", jobId] as const,
  researchJobStatus: (jobId: string) => ["research-job-status", jobId] as const,
  projectConversations: (projectId: string) =>
    ["project-conversations", projectId] as const,
  conversation: (id: string) => ["conversation", id] as const,
  projectDocuments: (projectId: string) =>
    ["project-documents", projectId] as const,
};
