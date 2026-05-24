/**
 * scripts/db-check.ts
 *
 * Checks DB connectivity, schema completeness, and basic read/write.
 * Run: pnpm run db:check
 *
 * Exits 0 on pass, 1 on failure.
 * NEVER prints secrets.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const REQUIRED_TABLES = [
  "users",
  "bot_config",
  "equity_snapshots",
  "markets",
  "signals",
  "orders",
  "trades",
  "decision_audits",
  "bayesian_priors",
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    console.log("db_connected: false");
    console.log("error: DATABASE_URL not set");
    process.exit(1);
  }

  let connection: mysql.Connection | null = null;
  let dbConnected = false;
  let tablesFound: string[] = [];
  let tablesMissing: string[] = [];
  let auditResult: "pass" | "fail" = "fail";
  let openOrderCount = 0;
  let lastEquitySnapshot: { balance: string; timestamp: string } | "none" =
    "none";

  try {
    connection = await mysql.createConnection(databaseUrl);
    dbConnected = true;

    // Check which tables exist
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = DATABASE()`
    );
    const existing = new Set(
      rows.map(r => String(r.table_name ?? r.TABLE_NAME ?? "").toLowerCase())
    );

    tablesFound = REQUIRED_TABLES.filter(t => existing.has(t));
    tablesMissing = REQUIRED_TABLES.filter(t => !existing.has(t));

    // Audit insert/read/delete test
    if (existing.has("decision_audits")) {
      const testId = `db-check-test-${Date.now()}`;
      try {
        await connection.execute(
          `INSERT INTO decision_audits
             (tickId, marketId, action, question, createdAt)
           VALUES (?, ?, ?, ?, NOW())`,
          [testId, "test", "skipped", "DB connectivity test"]
        );

        const [readRows] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT tickId FROM decision_audits WHERE tickId = ?`,
          [testId]
        );

        if (readRows.length > 0) {
          await connection.execute(
            `DELETE FROM decision_audits WHERE tickId = ?`,
            [testId]
          );
          auditResult = "pass";
        }
      } catch {
        auditResult = "fail";
      }
    }

    // Open order count
    if (existing.has("orders")) {
      try {
        const [countRows] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) as cnt FROM orders WHERE status IN ('pending', 'partially_filled')`
        );
        openOrderCount = Number(countRows[0]?.cnt ?? 0);
      } catch {
        openOrderCount = -1;
      }
    }

    // Last equity snapshot
    if (existing.has("equity_snapshots")) {
      try {
        const [snapRows] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT bankrollUsd, snapshotAt FROM equity_snapshots ORDER BY snapshotAt DESC LIMIT 1`
        );
        if (snapRows.length > 0) {
          lastEquitySnapshot = {
            balance: String(snapRows[0].bankrollUsd ?? snapRows[0].balance ?? "?"),
            timestamp: String(snapRows[0].snapshotAt ?? snapRows[0].createdAt ?? "?"),
          };
        }
      } catch {
        lastEquitySnapshot = "none";
      }
    }
  } catch (err) {
    dbConnected = false;
    console.log("db_connected: false");
    console.log(`error: ${String(err)}`);
    process.exit(1);
  } finally {
    try {
      await connection?.end();
    } catch {}
  }

  // Print results (no secrets)
  console.log(`db_connected: ${dbConnected}`);
  console.log(`tables_found: [${tablesFound.join(", ")}]`);
  console.log(`tables_missing: [${tablesMissing.join(", ")}]`);
  console.log(`audit_insert_read_delete: ${auditResult}`);
  console.log(`open_order_count: ${openOrderCount}`);
  if (lastEquitySnapshot === "none") {
    console.log("last_equity_snapshot: none");
  } else {
    console.log(
      `last_equity_snapshot: { balance: ${lastEquitySnapshot.balance}, timestamp: ${lastEquitySnapshot.timestamp} }`
    );
  }

  const allPassed =
    dbConnected &&
    tablesMissing.length === 0 &&
    auditResult === "pass";

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error("db:check error:", String(err));
  process.exit(1);
});
