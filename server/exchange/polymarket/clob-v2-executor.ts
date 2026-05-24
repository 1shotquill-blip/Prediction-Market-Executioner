import { ClobClient, OrderSide, OrderType } from "@polymarket/clob-client-v2";
import { Wallet } from "ethers";
import { ENV } from "../../_core/env";
import { updateOrderSyncState } from "../../db";

export class PolymarketAtomicExecutor {
  private client: ClobClient;
  private wallet: Wallet;

  constructor() {
    this.wallet = new Wallet(ENV.polymarketPrivateKey);
    this.client = new ClobClient(
      ENV.polymarketClobHost,
      ENV.polymarketChainId,
      this.wallet
    );
  }

  async placeOrder(
    marketId: string,
    side: "buy" | "sell",
    price: number,
    size: number
  ) {
    // 1. Nonce and Auth handled by CLOB Client SDK internally
    // 2. Atomic Order Placement
    const order = await this.client.createOrder({
      marketId,
      side: side === "buy" ? OrderSide.BUY : OrderSide.SELL,
      price: price.toString(),
      size: size.toString(),
      type: OrderType.GTC,
    });

    // 3. Persist Sync State to DB immediately
    await updateOrderSyncState(order.orderId, {
      status: "pending",
      nonce: order.orderId, // Polymarket v2 uses orderId as primary tracking
      placedAt: new Date(),
    });

    return order;
  }
}
