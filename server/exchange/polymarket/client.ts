import { ENV } from "../../_core/env";
import { PolymarketConfigurationError } from "./errors";
import type {
  PolymarketApiCredentials,
  PolymarketClientConfig,
  PolymarketClientLike,
} from "./types";

let singletonClient: PolymarketClientLike | null = null;

export async function initializePolymarketSdkClient(
  config: Partial<PolymarketClientConfig> = {}
): Promise<PolymarketClientLike> {
  if (
    config.privateKey === "" ||
    (!config.privateKey && !ENV.polymarketPrivateKey)
  ) {
    throw new PolymarketConfigurationError(
      "POLYMARKET_PRIVATE_KEY is required for live CLOB signing"
    );
  }

  const moduleName =
    process.env.POLYMARKET_CLOB_SDK_MODULE ?? "@polymarket/clob-client-v2";
  let sdkModule: Record<string, unknown>;
  try {
    sdkModule = (await import(moduleName)) as Record<string, unknown>;
  } catch (error) {
    throw new PolymarketConfigurationError(
      `Unable to load Polymarket SDK module '${moduleName}'. Install it or inject a PolymarketClientLike.`,
      error
    );
  }

  const ClobClient = sdkModule.ClobClient ?? sdkModule.default;
  if (typeof ClobClient !== "function") {
    throw new PolymarketConfigurationError(
      `Module '${moduleName}' does not export ClobClient`
    );
  }

  let viem: Record<string, unknown>;
  let viemAccounts: Record<string, unknown>;
  try {
    viem = (await import("viem")) as Record<string, unknown>;
    viemAccounts = (await import("viem/accounts")) as Record<string, unknown>;
  } catch (error) {
    throw new PolymarketConfigurationError(
      "Unable to load viem signer dependencies. Install viem or inject a PolymarketClientLike.",
      error
    );
  }

  const createWalletClient = viem.createWalletClient;
  const http = viem.http;
  const privateKeyToAccount = viemAccounts.privateKeyToAccount;
  if (
    typeof createWalletClient !== "function" ||
    typeof http !== "function" ||
    typeof privateKeyToAccount !== "function"
  ) {
    throw new PolymarketConfigurationError(
      "Installed viem package does not expose createWalletClient/http/privateKeyToAccount"
    );
  }

  const host = config.host ?? ENV.polymarketClobHost;
  const chainId = config.chainId ?? ENV.polymarketChainId;
  const rawPrivateKey = config.privateKey ?? ENV.polymarketPrivateKey;
  const privateKey = rawPrivateKey.startsWith("0x")
    ? rawPrivateKey
    : `0x${rawPrivateKey}`;
  const account = privateKeyToAccount(privateKey);
  const signer = createWalletClient({
    account,
    transport: http(config.rpcUrl || ENV.polygonRpcUrl || undefined),
  });

  return new (ClobClient as new (
    options: Record<string, unknown>
  ) => PolymarketClientLike)({
    host,
    chain: chainId,
    signer,
    creds: config.credentials,
    signatureType: config.signatureType ?? ENV.polymarketSignatureType,
    funderAddress:
      config.funderAddress || ENV.polymarketFunderAddress || undefined,
    throwOnError: true,
  });
}

export async function getPolymarketClient(
  options: {
    forceNew?: boolean;
    credentials?: PolymarketApiCredentials;
    rawClient?: PolymarketClientLike;
  } = {}
): Promise<PolymarketClientLike> {
  if (options.rawClient) return options.rawClient;
  if (!singletonClient || options.forceNew) {
    singletonClient = await initializePolymarketSdkClient({
      credentials: options.credentials,
    });
  }
  return singletonClient;
}

export function resetPolymarketClientForTests(): void {
  singletonClient = null;
}
