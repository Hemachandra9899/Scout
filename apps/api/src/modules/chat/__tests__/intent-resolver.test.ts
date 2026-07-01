import { describe, expect, it, vi } from "vitest";
import { resolveIntent } from "../intent-resolver.js";

describe("resolveIntent", () => {
  it("honors an explicit frontend mode override before anything else", async () => {
    const classify = vi.fn();
    const decision = await resolveIntent(
      { query: "anything at all", mode: "github_repo" },
      { classify, escalate: vi.fn() },
    );
    expect(decision.flow).toBe("github_repo");
    expect(decision.confidence).toBe(1);
    expect(classify).not.toHaveBeenCalled();
  });

  it("maps deep_research mode to the agent flow", async () => {
    const decision = await resolveIntent({ query: "research X deeply", mode: "deep_research" });
    expect(decision.flow).toBe("agent");
  });

  it("routes greetings/capability to direct without calling the model", async () => {
    const classify = vi.fn();
    for (const q of ["hi", "hello there", "what can you do?", "who are you"]) {
      const d = await resolveIntent({ query: q }, { classify, escalate: vi.fn() });
      expect(d.flow).toBe("direct");
    }
    expect(classify).not.toHaveBeenCalled();
  });

  it("uses deterministic router signals for a github URL", async () => {
    const classify = vi.fn();
    const d = await resolveIntent(
      { query: "explain the architecture of https://github.com/foo/bar" },
      { classify, escalate: vi.fn() },
    );
    expect(d.flow).toBe("github_repo");
    expect(classify).not.toHaveBeenCalled();
  });

  it("routes to kb when a document is attached, even with API terms", async () => {
    const d = await resolveIntent({
      query: "what is the api rate limit in this report",
      context: { hasDocument: true },
    });
    expect(d.flow).toBe("kb");
  });

  it("falls to the flash classifier for genuinely unknown queries", async () => {
    const classify = vi.fn(async () => ({ flow: "web_research" as const, confidence: 0.9 }));
    const d = await resolveIntent(
      { query: "tell me an imaginative tale about two kingdoms" },
      { classify, escalate: vi.fn() },
    );
    expect(classify).toHaveBeenCalled();
    expect(d.flow).toBe("web_research");
    expect(d.escalated).toBe(false);
  });

  it("escalates to the reasoning model when flash confidence is low", async () => {
    const classify = vi.fn(async () => ({ flow: "direct" as const, confidence: 0.3 }));
    const escalate = vi.fn(async () => ({ flow: "agent" as const, confidence: 0.85 }));
    const d = await resolveIntent(
      { query: "tell me an imaginative tale about two kingdoms" },
      { classify, escalate },
    );
    expect(escalate).toHaveBeenCalled();
    expect(d.flow).toBe("agent");
    expect(d.escalated).toBe(true);
  });

  it("defaults to the agent loop when no classifier is available", async () => {
    const d = await resolveIntent(
      { query: "tell me an imaginative tale about two kingdoms" },
      { classify: async () => null, escalate: async () => null },
    );
    expect(d.flow).toBe("agent");
  });
});
