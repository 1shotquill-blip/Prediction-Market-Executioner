import { ENV } from "../_core/env";

export type NewsSource = "x" | "newsapi";

export interface NewsSignal {
  source: NewsSource;
  content: string;
  timestamp: Date;
  sentiment: number;
}

export interface NewsIngestionOptions {
  fetchImpl?: typeof fetch;
  xBearerToken?: string;
  newsApiKey?: string;
  lookbackHours?: number;
  now?: Date;
}

interface CacheEntry {
  expiresAt: number;
  items?: NewsSignal[];
  pending?: Promise<NewsSignal[]>;
}

interface XRecentSearchResponse {
  data?: Array<{
    text?: string;
    created_at?: string;
  }>;
}

interface NewsApiResponse {
  articles?: Array<{
    title?: string;
    description?: string;
    content?: string;
    publishedAt?: string;
  }>;
}

export const NEWS_CACHE_TTL_MS = 5 * 60_000;

const cache = new Map<string, CacheEntry>();

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function cacheKey(query: string, lookbackHours: number): string {
  return `${lookbackHours}|${normalizeQuery(query)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreSentiment(text: string): number {
  const positiveWords = [
    "beat",
    "surge",
    "strong",
    "growth",
    "gain",
    "win",
    "record",
    "rally",
    "approve",
    "approval",
    "launch",
    "progress",
    "improve",
  ];
  const negativeWords = [
    "miss",
    "drop",
    "weak",
    "decline",
    "loss",
    "fail",
    "delay",
    "reject",
    "lawsuit",
    "probe",
    "ban",
    "cut",
    "risk",
  ];
  const normalized = text.toLowerCase();
  const positive = positiveWords.reduce(
    (sum, word) => sum + (normalized.includes(word) ? 1 : 0),
    0
  );
  const negative = negativeWords.reduce(
    (sum, word) => sum + (normalized.includes(word) ? 1 : 0),
    0
  );
  return clamp((positive - negative) / 5, -1, 1);
}

function buildNewsSignal(
  source: NewsSource,
  content: string,
  timestamp: string | undefined,
  now: Date
): NewsSignal {
  const parsed = timestamp ? new Date(timestamp) : now;
  return {
    source,
    content: content.trim(),
    timestamp: Number.isNaN(parsed.getTime()) ? now : parsed,
    sentiment: scoreSentiment(content),
  };
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  input: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetchImpl(input, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${input}`);
  }
  return (await response.json()) as T;
}

async function searchX(
  query: string,
  options: Required<
    Pick<
      NewsIngestionOptions,
      "fetchImpl" | "xBearerToken" | "lookbackHours" | "now"
    >
  >
): Promise<NewsSignal[]> {
  if (!options.xBearerToken) return [];

  const startTime = new Date(
    options.now.getTime() - options.lookbackHours * 3_600_000
  ).toISOString();
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "created_at");
  url.searchParams.set("start_time", startTime);

  const payload = await fetchJson<XRecentSearchResponse>(
    options.fetchImpl,
    url.toString(),
    {
      headers: {
        Authorization: `Bearer ${options.xBearerToken}`,
      },
    }
  );

  return (payload.data ?? [])
    .map(tweet => {
      const text = tweet.text?.trim();
      if (!text) return null;
      return buildNewsSignal("x", text, tweet.created_at, options.now);
    })
    .filter((item): item is NewsSignal => item !== null);
}

async function searchNewsApi(
  query: string,
  options: Required<
    Pick<
      NewsIngestionOptions,
      "fetchImpl" | "newsApiKey" | "lookbackHours" | "now"
    >
  >
): Promise<NewsSignal[]> {
  if (!options.newsApiKey) return [];

  const from = new Date(
    options.now.getTime() - options.lookbackHours * 3_600_000
  ).toISOString();
  const url = new URL("https://newsapi.org/v2/everything");
  url.searchParams.set("q", query);
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("sortBy", "publishedAt");
  url.searchParams.set("language", "en");
  url.searchParams.set("from", from);

  const payload = await fetchJson<NewsApiResponse>(
    options.fetchImpl,
    url.toString(),
    {
      headers: {
        "X-Api-Key": options.newsApiKey,
      },
    }
  );

  return (payload.articles ?? [])
    .map(article => {
      const content = [
        article.title?.trim(),
        article.description?.trim(),
        article.content?.trim(),
      ]
        .filter(Boolean)
        .join(" - ");
      if (!content) return null;
      return buildNewsSignal(
        "newsapi",
        content,
        article.publishedAt,
        options.now
      );
    })
    .filter((item): item is NewsSignal => item !== null);
}

async function fetchQueryNews(
  query: string,
  options: NewsIngestionOptions = {}
): Promise<NewsSignal[]> {
  const now = options.now ?? new Date();
  const lookbackHours = options.lookbackHours ?? ENV.newsLookbackHours;
  const fetchImpl = options.fetchImpl ?? fetch;
  const xBearerToken = options.xBearerToken ?? ENV.xBearerToken;
  const newsApiKey = options.newsApiKey ?? ENV.newsApiKey;
  const key = cacheKey(query, lookbackHours);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now.getTime()) {
    if (cached.items) return cached.items;
    if (cached.pending) return cached.pending;
  }

  const pending = (async () => {
    const [xResults, newsResults] = await Promise.allSettled([
      searchX(query, {
        fetchImpl,
        xBearerToken,
        lookbackHours,
        now,
      }),
      searchNewsApi(query, {
        fetchImpl,
        newsApiKey,
        lookbackHours,
        now,
      }),
    ]);

    const items: NewsSignal[] = [];
    if (xResults.status === "fulfilled") items.push(...xResults.value);
    if (newsResults.status === "fulfilled") items.push(...newsResults.value);

    if (items.length === 0) {
      console.warn(
        `[News] No news results for query "${query}" from X or NewsAPI; continuing with LLM-only reasoning`
      );
    }

    const deduped = Array.from(
      new Map(
        items.map(item => [
          `${item.source}|${item.timestamp.toISOString()}|${item.content}`,
          item,
        ])
      ).values()
    ).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    cache.set(key, {
      expiresAt: now.getTime() + NEWS_CACHE_TTL_MS,
      items: deduped,
    });

    return deduped;
  })();

  cache.set(key, {
    expiresAt: now.getTime() + NEWS_CACHE_TTL_MS,
    pending,
  });

  // Evict the poisoned pending entry on rejection so the next caller retries
  pending.catch(() => {
    const current = cache.get(key);
    if (current?.pending === pending) cache.delete(key);
  });

  return pending;
}

export async function ingestNewsForQueries(
  queries: string[],
  options: NewsIngestionOptions = {}
): Promise<NewsSignal[]> {
  const dedupedQueries = Array.from(
    new Set(queries.map(query => normalizeQuery(query)).filter(Boolean))
  );
  if (dedupedQueries.length === 0) return [];

  const results = await Promise.all(
    dedupedQueries.map(query => fetchQueryNews(query, options))
  );

  return Array.from(
    new Map(
      results
        .flat()
        .map(item => [
          `${item.source}|${item.timestamp.toISOString()}|${item.content}`,
          item,
        ])
    ).values()
  ).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

export function clearNewsCache(): void {
  cache.clear();
}
