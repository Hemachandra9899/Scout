import { cacheWrap, fetchUrlCacheKey, CACHE_FETCH_TTL_MS } from "../cache/index.js";

export async function fetchUrlText(url: string): Promise<{
  ok: boolean;
  url: string;
  status?: number;
  title?: string;
  text?: string;
  error?: string;
  cacheHit?: boolean;
}> {
  const key = fetchUrlCacheKey(url);
  const { value, cacheHit } = await cacheWrap(
    key,
    async (): Promise<{
      ok: boolean;
      url: string;
      status?: number;
      title?: string;
      text?: string;
      error?: string;
    }> => {
      try {
        const res = await fetch(url, {
          headers: {
            "user-agent": "ScoutResearchBot/0.1",
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(15000),
        });

        const status = res.status;
        const html = await res.text();

        if (!res.ok) {
          return { ok: false, url, status, error: `HTTP ${status}` };
        }

        const title = html
          .match(/<title[^>]*>(.*?)<\/title>/is)?.[1]
          ?.replace(/\s+/g, " ")
          ?.trim();

        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim();

        return {
          ok: true,
          url,
          status,
          title,
          text: text.slice(0, 40000),
        };
      } catch (error) {
        return {
          ok: false,
          url,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    CACHE_FETCH_TTL_MS,
  );
  return { ...value, cacheHit };
}
