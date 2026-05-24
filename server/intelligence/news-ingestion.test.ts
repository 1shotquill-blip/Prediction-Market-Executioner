import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNewsCache,
  ingestNewsForQueries,
  NEWS_CACHE_TTL_MS,
  type NewsSignal,
} from "./news-ingestion";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("news ingestion", () => {
  beforeEach(() => {
    clearNewsCache();
    vi.restoreAllMocks();
  });

  it("merges X and NewsAPI results and caches per query", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("api.x.com")) {
        return jsonResponse({
          data: [
            {
              text: "BTC rallies on strong ETF inflows",
              created_at: "2026-05-09T00:00:00Z",
            },
          ],
        });
      }
      if (url.includes("newsapi.org")) {
        return jsonResponse({
          articles: [
            {
              title: "Bitcoin surges",
              description: "ETF demand remains strong",
              publishedAt: "2026-05-09T01:00:00Z",
            },
          ],
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const first = await ingestNewsForQueries(["BTC price today"], {
      fetchImpl: fetchImpl as typeof fetch,
      xBearerToken: "x-token",
      newsApiKey: "news-token",
      now: new Date("2026-05-09T02:00:00Z"),
    });
    const second = await ingestNewsForQueries(["BTC price today"], {
      fetchImpl: fetchImpl as typeof fetch,
      xBearerToken: "x-token",
      newsApiKey: "news-token",
      now: new Date("2026-05-09T02:00:00Z"),
    });

    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      first.every(
        (item: NewsSignal) => item.sentiment >= -1 && item.sentiment <= 1
      )
    ).toBe(true);
  });

  it("warns and falls back to an empty result when both APIs fail", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await ingestNewsForQueries(["fed decision"], {
      fetchImpl: fetchImpl as typeof fetch,
      xBearerToken: "x-token",
      newsApiKey: "news-token",
      now: new Date("2026-05-09T02:00:00Z"),
    });

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("uses the five minute cache window", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("api.x.com")) {
        return jsonResponse({
          data: [
            {
              text: "Jobs print looks strong",
              created_at: "2026-05-09T00:00:00Z",
            },
          ],
        });
      }
      return jsonResponse({ articles: [] });
    });

    const now = new Date("2026-05-09T02:00:00Z");
    await ingestNewsForQueries(["jobs report"], {
      fetchImpl: fetchImpl as typeof fetch,
      xBearerToken: "x-token",
      newsApiKey: "news-token",
      now,
    });
    await ingestNewsForQueries(["jobs report"], {
      fetchImpl: fetchImpl as typeof fetch,
      xBearerToken: "x-token",
      newsApiKey: "news-token",
      now: new Date(now.getTime() + NEWS_CACHE_TTL_MS - 1),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
