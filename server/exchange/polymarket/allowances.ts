import {
  AllowanceRequired,
  PolymarketConfigurationError,
  mapPolymarketError,
} from "./errors";
import type { PolymarketClientLike } from "./types";

export interface AllowanceTarget {
  token: "collateral" | "conditional";
  tokenId?: string;
  minimumAllowance: number;
}

interface PolymarketAllowanceParams {
  asset_type: "COLLATERAL" | "CONDITIONAL";
  token_id?: string;
  [key: string]: unknown;
}

function parseAllowance(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return Number(raw);
  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    return Number(
      value.allowance ?? value.balanceAllowance ?? value.amount ?? 0
    );
  }
  return 0;
}

export async function ensureAllowance(
  client: PolymarketClientLike,
  target: AllowanceTarget
): Promise<void> {
  if (!client.getBalanceAllowance || !client.updateBalanceAllowance) {
    throw new PolymarketConfigurationError(
      "Polymarket client does not expose allowance methods"
    );
  }

  try {
    const params: PolymarketAllowanceParams =
      target.token === "collateral"
        ? { asset_type: "COLLATERAL" }
        : { asset_type: "CONDITIONAL", token_id: target.tokenId };
    const current = parseAllowance(await client.getBalanceAllowance(params));
    if (current >= target.minimumAllowance) return;
    await client.updateBalanceAllowance(params);
    const updated = parseAllowance(await client.getBalanceAllowance(params));
    if (updated < target.minimumAllowance) {
      throw new AllowanceRequired(
        `Allowance ${updated} remains below required ${target.minimumAllowance}`
      );
    }
  } catch (error) {
    throw mapPolymarketError(error);
  }
}

// Alias used in the go-live runbook (spec §5 Step 3).
export async function checkAndApproveAllowance(
  client: PolymarketClientLike,
  requiredNotionalUsd = 1_000
): Promise<void> {
  await ensureTradingAllowances(client, requiredNotionalUsd, "");
}

export async function ensureTradingAllowances(
  client: PolymarketClientLike,
  requiredNotionalUsd: number,
  tokenId: string
): Promise<void> {
  await ensureAllowance(client, {
    token: "collateral",
    minimumAllowance: requiredNotionalUsd,
  });
  await ensureAllowance(client, {
    token: "conditional",
    tokenId,
    minimumAllowance: requiredNotionalUsd,
  });
}
