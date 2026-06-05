import type { Project, ResearchJob, Report, AgentRun, AgentStep } from "../types/api";

type Props = {
  selectedProject: Project | undefined;
  error: string;
  question: string;
  onQuestionChange: (v: string) => void;
  onCreateJob: () => void;
  isCreatingJob: boolean;
  selectedProjectId: string;
  jobs: ResearchJob[];
  activeJobId: string;
  onSelectJob: (id: string) => void;
};

function prettyJson(value: unknown) {
  if (!value) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function RobotLarge() {
  return (
    <div className="robotLarge">
      <span />
      <span />
      <i />
    </div>
  );
}

function ErrorBox({ children }: { children: string }) {
  return <div className="errorBox">{children}</div>;
}

function JobList({
  jobs,
  activeJobId,
  onSelectJob,
}: {
  jobs: ResearchJob[];
  activeJobId: string;
  onSelectJob: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return <p className="muted">No jobs yet. Create a research task above.</p>;
  }
  return (
    <>
      {jobs.map((job) => (
        <button
          key={job.id}
          className={job.id === activeJobId ? "job active" : "job"}
          onClick={() => onSelectJob(job.id)}
        >
          <span>{job.question}</span>
          <b>{job.status}</b>
        </button>
      ))}
    </>
  );
}

function ReportCard({ report }: { report: Report }) {
  return (
    <article className="report">
      <h3>{report.title}</h3>
      <p>{report.content}</p>
      {report.metadata ? <pre>{prettyJson(report.metadata)}</pre> : null}
    </article>
  );
}

function Trace({ run }: { run: AgentRun }) {
  return (
    <details open className="trace">
      <summary>
        depth {run.depth} · {run.status}
      </summary>
      <p>{run.query}</p>
      {run.steps?.map((step: AgentStep) => (
        <pre key={step.id}>
          {prettyJson({
            stepIndex: step.stepIndex,
            stdout: step.stdout,
            result: step.result,
          })}
        </pre>
      ))}
    </details>
  );
}

function OutputPanel({ activeJob }: { activeJob: ResearchJob | undefined }) {
  if (!activeJob) {
    return <p className="muted">Select a job to inspect output.</p>;
  }
  return (
    <>
      <div className="jobHeader">
        <h3>{activeJob.status}</h3>
        <p>{activeJob.question}</p>
      </div>

      {activeJob.error && <pre className="errorPre">{activeJob.error}</pre>}

      {activeJob.reports?.map((report) => (
        <ReportCard key={report.id} report={report} />
      ))}

      <div className="panelTitle spaced">Agent Trace</div>
      {activeJob.agentRuns?.map((run) => (
        <Trace key={run.id} run={run} />
      ))}
    </>
  );
}

export default function Workspace({
  selectedProject,
  error,
  question,
  onQuestionChange,
  onCreateJob,
  isCreatingJob,
  selectedProjectId,
  jobs,
  activeJobId,
  onSelectJob,
}: Props) {
  return (
    <section className="workspace">
      <div className="topbar">
        <div>
          <p className="eyebrow">Local / Worktree / RLM Runtime</p>
          <h2>{selectedProject?.name || "No project selected"}</h2>
        </div>
        <div className="pixelBadge">v0.1</div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <section className="hero">
        <RobotLarge />

        <div className="askBox">
          <textarea
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            placeholder="Ask RLM Forge to research something..."
          />
          <button
            className="primary large"
            onClick={onCreateJob}
            disabled={!selectedProjectId || isCreatingJob}
          >
            {isCreatingJob ? "Running..." : "Generate ✦"}
          </button>
        </div>
      </section>

      <section className="contentGrid">
        <div className="panel">
          <div className="panelTitle">Research Jobs</div>
          <JobList
            jobs={jobs}
            activeJobId={activeJobId}
            onSelectJob={onSelectJob}
          />
        </div>

        <div className="panel reportPanel">
          <div className="panelTitle">Output</div>
          <OutputPanel activeJob={jobs.find((j) => j.id === activeJobId)} />
        </div>
      </section>
    </section>
  );
}
