import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheClear } from "@rlm-forge/knowledge/cache/index.js";
import { callModelService } from "../deterministic-fastpaths.js";

function mockChatResponse(content: string) {
  return {
    ok: true,
    text: async () => JSON.stringify({ content }),
  } as Response;
}

describe("callModelService caching", () => {
  beforeEach(async () => {
    await cacheClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the cached result for an identical (mode, query) call", async () => {
    const fetchMock = vi.fn(async () => mockChatResponse("answer one"));
    vi.stubGlobal("fetch", fetchMock);

    const first = await callModelService("reasoning", "what is scout");
    const second = await callModelService("reasoning", "what is scout");

    expect(first).toBe("answer one");
    expect(second).toBe("answer one");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not share a cache entry across different queries", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => mockChatResponse(`answer ${++call}`));
    vi.stubGlobal("fetch", fetchMock);

    const a = await callModelService("reasoning", "query a");
    const b = await callModelService("reasoning", "query b");

    expect(a).toBe("answer 1");
    expect(b).toBe("answer 2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed call", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 400, text: async () => "bad request" } as Response;
      }
      return mockChatResponse("recovered");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(callModelService("coding", "broken query")).rejects.toThrow();

    const result = await callModelService("coding", "broken query");
    expect(result).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
