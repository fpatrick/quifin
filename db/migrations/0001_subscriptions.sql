CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  cadence_type TEXT NOT NULL CHECK (
    cadence_type IN ('monthly', 'quarterly', 'semiannual', 'yearly', 'custom')
  ),
  cadence_months INTEGER NOT NULL CHECK (cadence_months > 0),
  next_charge_date TEXT NOT NULL,
  remind_cancel INTEGER NOT NULL DEFAULT 0 CHECK (remind_cancel IN (0, 1)),
  remind_lead_days INTEGER,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  notes TEXT,
  cancel_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_archived
  ON subscriptions (archived);

CREATE INDEX IF NOT EXISTS idx_subscriptions_next_charge_date
  ON subscriptions (next_charge_date);
