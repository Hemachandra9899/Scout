export type ScoutProgressStage =
  | "route"
  | "memory"
  | "planning"
  | "provider_search"
  | "source_ranking"
  | "crawl"
  | "evidence"
  | "synthesis"
  | "critic"
  | "focused_retry"
  | "recovery"
  | "graph"
  | "report"
  | "complete"
  | "error";

export type ScoutProgressStatus =
  | "started"
  | "progress"
  | "completed"
  | "skipped"
  | "failed";

export type ScoutProgressEvent = {
  id: string;
  stage: ScoutProgressStage;
  status: ScoutProgressStatus;
  message: string;
  timestamp: string;
  elapsedMs: number;
  metadata?: Record<string, unknown>;
};

export type ScoutProgressSink = (
  event: ScoutProgressEvent,
) => void | Promise<void>;

export function createProgressEmitter(input?: {
  sink?: ScoutProgressSink;
  startTimeMs?: number;
}) {
  const events: ScoutProgressEvent[] = [];
  const startTimeMs = input?.startTimeMs ?? Date.now();

  async function emit(event: Omit<ScoutProgressEvent, "id" | "timestamp" | "elapsedMs">) {
    const fullEvent: ScoutProgressEvent = {
      id: `${event.stage}-${events.length + 1}`,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - startTimeMs,
      ...event,
    };

    events.push(fullEvent);

    if (input?.sink) {
      await input.sink(fullEvent);
    }

    return fullEvent;
  }

  return {
    events,
    emit,
    summary() {
      return {
        eventCount: events.length,
        stages: [...new Set(events.map((event) => event.stage))],
        lastStage: events.at(-1)?.stage,
        lastStatus: events.at(-1)?.status,
        durationMs: Date.now() - startTimeMs,
      };
    },
  };
}
