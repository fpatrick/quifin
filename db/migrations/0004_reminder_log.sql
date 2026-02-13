CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  reminder_kind TEXT NOT NULL CHECK (reminder_kind = 'charge'),
  target_charge_date TEXT NOT NULL,
  offset_days INTEGER NOT NULL CHECK (offset_days IN (1, 2)),
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_log_unique
  ON reminder_log (subscription_id, reminder_kind, target_charge_date, offset_days);

CREATE INDEX IF NOT EXISTS idx_reminder_log_sent_at
  ON reminder_log (sent_at);
