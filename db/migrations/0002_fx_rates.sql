CREATE TABLE IF NOT EXISTS fx_rates (
  currency TEXT PRIMARY KEY,
  rate_to_eur REAL NOT NULL CHECK (rate_to_eur > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
