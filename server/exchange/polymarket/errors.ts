export class PolymarketAdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class SignatureRejected extends PolymarketAdapterError {
  constructor(
    message = "Polymarket rejected the order signature",
    cause?: unknown
  ) {
    super(message, "SIGNATURE_REJECTED", cause);
  }
}

export class InsufficientBalance extends PolymarketAdapterError {
  constructor(message = "Insufficient USDC or token balance", cause?: unknown) {
    super(message, "INSUFFICIENT_BALANCE", cause);
  }
}

export class RateLimited extends PolymarketAdapterError {
  constructor(message = "Polymarket API rate limit reached", cause?: unknown) {
    super(message, "RATE_LIMITED", cause);
  }
}

export class MarketHalted extends PolymarketAdapterError {
  constructor(
    message = "Polymarket market is halted or not accepting orders",
    cause?: unknown
  ) {
    super(message, "MARKET_HALTED", cause);
  }
}

export class AllowanceRequired extends PolymarketAdapterError {
  constructor(
    message = "Required Polymarket token allowance is missing",
    cause?: unknown
  ) {
    super(message, "ALLOWANCE_REQUIRED", cause);
  }
}

export class KillswitchBlocked extends PolymarketAdapterError {
  constructor(
    message = "Polymarket kill switch blocked execution",
    cause?: unknown
  ) {
    super(message, "KILLSWITCH_BLOCKED", cause);
  }
}

export class PolymarketConfigurationError extends PolymarketAdapterError {
  constructor(message: string, cause?: unknown) {
    super(message, "POLYMARKET_CONFIGURATION_ERROR", cause);
  }
}

export function mapPolymarketError(error: unknown): PolymarketAdapterError {
  if (error instanceof PolymarketAdapterError) return error;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown Polymarket error";
  const lower = message.toLowerCase();

  if (lower.includes("signature")) return new SignatureRejected(message, error);
  if (lower.includes("balance") || lower.includes("collateral"))
    return new InsufficientBalance(message, error);
  if (lower.includes("rate") || lower.includes("429"))
    return new RateLimited(message, error);
  if (
    lower.includes("halt") ||
    lower.includes("closed") ||
    lower.includes("not accepting")
  ) {
    return new MarketHalted(message, error);
  }
  if (lower.includes("allowance") || lower.includes("approval"))
    return new AllowanceRequired(message, error);
  return new PolymarketAdapterError(message, "POLYMARKET_API_ERROR", error);
}
