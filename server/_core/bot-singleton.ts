import type { BotEngine } from "../bot-engine";

let _bot: BotEngine | null = null;

export function registerBot(bot: BotEngine): void {
  _bot = bot;
}

export function getBot(): BotEngine | null {
  return _bot;
}
