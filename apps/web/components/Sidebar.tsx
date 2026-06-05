import type { Theme } from "../types";
import type { Project } from "../types/api";

type Props = {
  theme: Theme;
  onToggleTheme: () => void;
  apiHealth: string;
  deps: Record<string, string>;
  projectName: string;
  onProjectNameChange: (v: string) => void;
  onCreateProject: () => void;
  isCreatingProject: boolean;
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
};

export default function Sidebar({
  theme,
  onToggleTheme,
  apiHealth,
  deps,
  projectName,
  onProjectNameChange,
  onCreateProject,
  isCreatingProject,
  projects,
  selectedProjectId,
  onSelectProject,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="bot">
          <span />
          <span />
        </div>
        <div>
          <h1>RLM Forge</h1>
          <p>Recursive Research OS</p>
        </div>
      </div>

      <button className="themeToggle" onClick={onToggleTheme}>
        {theme === "dark" ? "☀ Light" : "☾ Dark"}
      </button>

      <section className="panel compact">
        <div className="panelTitle">System</div>
        <div className="statusRow">
          <span>API</span>
          <b>{apiHealth}</b>
        </div>
        {Object.entries(deps).map(([key, value]) => (
          <div className="statusRow" key={key}>
            <span>{key}</span>
            <b className={value.includes("ok") ? "ok" : "bad"}>{value}</b>
          </div>
        ))}
      </section>

      <section className="panel compact">
        <div className="panelTitle">New Project</div>
        <input
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          placeholder="Project name"
        />
        <button
          className="primary"
          onClick={onCreateProject}
          disabled={isCreatingProject}
        >
          {isCreatingProject ? "Creating..." : "Generate ✦"}
        </button>
      </section>

      <section className="projectList">
        <div className="panelTitle">Projects</div>
        {projects.map((project) => (
          <button
            key={project.id}
            className={
              project.id === selectedProjectId
                ? "projectItem active"
                : "projectItem"
            }
            onClick={() => onSelectProject(project.id)}
          >
            <span className="projectIcon">⌘</span>
            <span>{project.name}</span>
          </button>
        ))}
      </section>
    </aside>
  );
}
