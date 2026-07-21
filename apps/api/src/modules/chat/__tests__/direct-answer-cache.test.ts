import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheClear } from "@rlm-forge/knowledge/cache/index.js";
import { streamDirectAnswerCached } from "../chat.router.js";

function mockChatResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ content }),
  } as Response;
}

describe("streamDirectAnswerCached", () => {
  beforeEach(async () => {
    await cacheClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls model-service once and replays the second identical query from cache", async () => {
    // The stream endpoint fails so streamDirectAnswer falls back to the
    // non-streaming /chat endpoint, which is simpler to mock deterministically.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/chat/stream")) {
        return { ok: false, status: 500, body: null } as unknown as Response;
      }
      return mockChatResponse("Hi! I'm Scout.");
    });
    vi.stubGlobal("fetch", fetchMock);

    const events: Array<{ event: string; data: unknown }> = [];
    const send = (event: string, data: Record<string, unknown>) => {
      events.push({ event, data });
    };

    const first = await streamDirectAnswerCached("hi", send);
    const chatCallsAfterFirst = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/chat"),
    ).length;

    const second = await streamDirectAnswerCached("hi", send);
    const chatCallsAfterSecond = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/chat"),
    ).length;

    expect(first.content).toBe("Hi! I'm Scout.");
    expect(first.cacheHit).toBe(false);
    expect(second.content).toBe("Hi! I'm Scout.");
    expect(second.cacheHit).toBe(true);
    expect(chatCallsAfterFirst).toBe(1);
    expect(chatCallsAfterSecond).toBe(1); // no new call on the cached second run
    expect(events.some((e) => e.event === "token")).toBe(true);
  });

  it("treats different queries as separate cache entries", async () => {
    let call = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/chat/stream")) {
        return { ok: false, status: 500, body: null } as unknown as Response;
      }
      call += 1;
      return mockChatResponse(`answer ${call}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const send = () => {};
    const a = await streamDirectAnswerCached("hi", send);
    const b = await streamDirectAnswerCached("hello", send);

    expect(a.content).toBe("answer 1");
    expect(b.content).toBe("answer 2");
  });
});
