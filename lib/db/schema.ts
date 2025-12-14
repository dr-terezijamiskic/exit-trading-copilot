import Database from 'better-sqlite3';

export function createTables(db: Database.Database) {
  // Trades table
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAt TEXT NOT NULL,
      ticker TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
      setup TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      invalidationPrice REAL NOT NULL,
      entryTime TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'EXIT_NOW', 'CLOSED')),
      closedAt TEXT,
      notes TEXT,
      exitNowTriggeredAt TEXT,
      is0DTE INTEGER NOT NULL DEFAULT 0 CHECK(is0DTE IN (0, 1))
    )
  `);

  // Price updates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tradeId INTEGER NOT NULL,
      time TEXT NOT NULL,
      price REAL NOT NULL,
      chop INTEGER NOT NULL CHECK(chop IN (0, 1)),
      unsure INTEGER NOT NULL CHECK(unsure IN (0, 1)),
      inProfit INTEGER NOT NULL CHECK(inProfit IN (0, 1)),
      statusAfter TEXT NOT NULL CHECK(statusAfter IN ('ACTIVE', 'EXIT_NOW', 'CLOSED')),
      reason TEXT,
      FOREIGN KEY (tradeId) REFERENCES trades(id) ON DELETE CASCADE
    )
  `);

  // Actions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tradeId INTEGER NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('EXIT', 'REDUCE', 'NOTE', 'OVERRIDE', 'RULE_VIOLATION', 'MULTI_TRADE_ACK')),
      payload TEXT NOT NULL,
      FOREIGN KEY (tradeId) REFERENCES trades(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_price_updates_tradeId ON price_updates(tradeId);
    CREATE INDEX IF NOT EXISTS idx_actions_tradeId ON actions(tradeId);
  `);
}
