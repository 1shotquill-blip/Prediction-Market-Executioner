import { nanoid } from "nanoid";
import { insertDecisionAudits } from "../db";
import type { InsertDecisionAudit } from "../../drizzle/schema";
import type { AgentDecisionAudit } from "./orchestrator";

export function createTickId(now = new Date()): string {
  return `tick-${now.getTime()}-${nanoid(8)}`;
}

export function mapDecisionAuditToInsert(
  tickId: string,
  audit: AgentDecisionAudit
): InsertDecisionAudit {
  const riskIntent = audit.risk?.intent;

  return {
    tickId,
    marketId: audit.marketId,
    question: audit.question,
    action: audit.action,
    reasons: audit.reasons,
    estimatedProbability: riskIntent?.estimatedProbability?.toString(),
    confidence: riskIntent?.confidence?.toString(),
    edge:
      riskIntent?.edge?.toString() ??
      audit.risk?.diagnostics.selectedEdge.toString(),
    bestBid: audit.market?.bestBid.toString(),
    bestAsk: audit.market?.bestAsk.toString(),
    spread: audit.market?.spread.toString(),
    selectionScore: audit.selectionScore?.total.toString(),
    orderNonce: audit.receipt?.localOrderId,
    exchangeOrderId: audit.receipt?.exchangeOrderId,
    lifecycleStatus: audit.lifecycleUpdate?.status,
    diagnostics: {
      risk: audit.risk,
      ensemble: audit.ensemble,
      deepEdge: audit.deepEdge,
      selectionScore: audit.selectionScore,
      ranking: audit.ranking,
      receipt: audit.receipt,
      lifecycleUpdate: audit.lifecycleUpdate,
    },
  };
}

export async function persistDecisionAudits(
  tickId: string,
  audits: AgentDecisionAudit[]
): Promise<void> {
  await insertDecisionAudits(
    audits.map(audit => mapDecisionAuditToInsert(tickId, audit))
  );
}
