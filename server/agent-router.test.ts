import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getRecentDecisionAudits: vi.fn(async () => [
      {
        id: 1,
        tickId: "tick-1",
        marketId: "market-1",
        question: "Will this happen?",
        action: "skipped",
        reasons: ["test"],
        estimatedProbability: null,
        confidence: null,
        edge: null,
        bestBid: "0.5",
        bestAsk: "0.52",
        spread: "0.02",
        orderNonce: null,
        exchangeOrderId: null,
        lifecycleStatus: null,
        diagnostics: null,
        createdAt: new Date(),
      },
    ]),
  };
});

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      role: "admin",
      email: null,
      name: null,
      loginMethod: "test",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("agent router", () => {
  it("validates candidate scan inputs before hitting external APIs", async () => {
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.agent.scanCandidates({ limit: 0 })).rejects.toThrow();
  });

  it("returns recent decision audits", async () => {
    const caller = appRouter.createCaller(createAdminContext());

    const audits = await caller.agent.recentDecisionAudits({ limit: 10 });

    expect(audits).toHaveLength(1);
    expect(audits[0]?.tickId).toBe("tick-1");
  });
});
