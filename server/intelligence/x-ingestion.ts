import { invokeLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import type { SocialSignal } from "../agent/types";

const X_RECENT_SEARCH_URL = "https://api.twitter.com/2/tweets/search/recent";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

interface XUser {
  id: string;
  username?: string;
  verified?: boolean;
  verified_type?: string;
}

interface XTweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
  };
}

interface XSearchResponse {
  data?: XTweet[];
  includes?: {
    users?: XUser[];
  };
}

interface CacheEntry {
  expiresAt: number;
  tweets: SocialSignal[];
}

const cache = new Map<string, CacheEntry>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cacheKey(query: string, lookbackHours: number): string {
  return `${query.trim().toLowerCase()}::${lookbackHours}`;
}

function userIsVerified(user: XUser | undefined): boolean {
  return Boolean(
    user?.verified || (user?.verified_type && user.verified_type !== "none")
  );
}

function engagement(signal: SocialSignal): number {
  return (
    signal.metrics.likes + signal.metrics.retweets * 2 + signal.metrics.replies
  );
}

function parseSocialSignals(body: XSearchResponse): SocialSignal[] {
  const users = new Map(
    (body.includes?.users ?? []).map(user => [user.id, user])
  );
  return (body.data ?? [])
    .map(tweet => {
      const user = users.get(tweet.author_id ?? "");
      const metrics = {
        likes: tweet.public_metrics?.like_count ?? 0,
        retweets: tweet.public_metrics?.retweet_count ?? 0,
        replies: tweet.public_metrics?.reply_count ?? 0,
      };
      return {
        id: tweet.id,
        text: tweet.text,
        author_id: tweet.author_id ?? "",
        author_username: user?.username ?? tweet.author_id ?? "unknown",
        created_at: tweet.created_at ?? new Date(0).toISOString(),
        metrics,
        verified: userIsVerified(user),
      };
    })
    .filter(tweet => tweet.metrics.likes > 10 || tweet.verified)
    .map(({ verified: _verified, ...tweet }) => tweet)
    .sort((a, b) => engagement(b) - engagement(a));
}

function parseLLMText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const content = result.choices[0]?.message.content;
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text"
    )
    .map(part => part.text)
    .join("");
}

async function annotateSentiment(
  tweets: SocialSignal[]
): Promise<SocialSignal[]> {
  if (tweets.length === 0) return tweets;
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "Score each tweet's sentiment toward the YES outcome of the related prediction market. Return JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            tweets: tweets.slice(0, 20).map(tweet => ({
              id: tweet.id,
              text: tweet.text,
            })),
          }),
        },
      ],
      outputSchema: {
        name: "tweet_sentiment_scores",
        schema: {
          type: "object",
          properties: {
            scores: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  sentiment_score: { type: "number" },
                },
                required: ["id", "sentiment_score"],
                additionalProperties: false,
              },
            },
          },
          required: ["scores"],
          additionalProperties: false,
        },
        strict: true,
      },
    });
    const parsed = JSON.parse(parseLLMText(result)) as {
      scores?: Array<{ id: string; sentiment_score: number }>;
    };
    const scores = new Map(
      (parsed.scores ?? []).map(score => [score.id, score.sentiment_score])
    );
    return tweets.map(tweet => ({
      ...tweet,
      sentiment_score: scores.get(tweet.id),
    }));
  } catch (error) {
    console.warn("[XIngestion] Tweet sentiment annotation failed:", error);
    return tweets;
  }
}

export async function searchTweets(
  query: string,
  lookbackHours: number
): Promise<SocialSignal[]> {
  const bearerToken = ENV.xBearerToken;
  if (!bearerToken) {
    console.warn("[XIngestion] X_BEARER_TOKEN missing; returning no tweets");
    return [];
  }

  const key = cacheKey(query, lookbackHours);
  const nowMs = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > nowMs) return cached.tweets;

  const startTime = new Date(
    nowMs - Math.max(1, lookbackHours) * 60 * 60 * 1000
  ).toISOString();
  const params = new URLSearchParams({
    query,
    max_results: "100",
    start_time: startTime,
    "tweet.fields": "author_id,created_at,public_metrics",
    expansions: "author_id",
    "user.fields": "username,verified,verified_type",
  });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${X_RECENT_SEARCH_URL}?${params}`, {
        headers: { authorization: `Bearer ${bearerToken}` },
      });
      if (response.status === 429 && attempt < MAX_ATTEMPTS - 1) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        throw new Error(`X recent search failed: ${response.status}`);
      }
      const tweets = parseSocialSignals(
        (await response.json()) as XSearchResponse
      );
      const annotated = await annotateSentiment(tweets);
      cache.set(key, {
        expiresAt: nowMs + CACHE_TTL_MS,
        tweets: annotated,
      });
      console.log(
        `[XIngestion] query="${query}" lookbackHours=${lookbackHours} tweets=${annotated.length}`
      );
      return annotated;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS - 1) {
        console.warn(
          "[XIngestion] X search failed; returning no tweets:",
          error
        );
        return [];
      }
      await sleep(500 * 2 ** attempt);
    }
  }

  return [];
}
