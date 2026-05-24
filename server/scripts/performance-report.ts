import { getEquityHistory } from '../db';

async function generateReport() {
  const history = await getEquityHistory(24 * 30);
  if (history.length === 0) {
    console.error("No historical data to report.");
    return;
  }

  const pnl = history[history.length - 1].bankrollUsd - history[0].bankrollUsd;
  const maxDrawdown = Math.max(...history.map(h => h.drawdownPct));

  console.info("--- PERFORMANCE REPORT (30 Days) ---");
  console.info(`Net P&L: ${pnl.toFixed(2)}`);
  console.info(`Max Drawdown: ${maxDrawdown.toFixed(2)}%`);
  console.info("------------------------------------");
}

generateReport().catch(console.error);
