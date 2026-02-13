// API handlers for reading and saving multiple settings keys.
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";
import { ensureReminderSchedulerStarted } from "@/lib/server/reminders";
import {
  mapSettingsRows,
  parseSettingsPutPayload,
  type SettingRow,
} from "@/lib/server/settings";

export const runtime = "nodejs";

/**
 * Returns all settings as one key/value object.
 * The UI uses this for notifications and partner values.
 */
export async function GET() {
  try {
    ensureReminderSchedulerStarted();
    const db = getDatabase();
    const rows = db
      .prepare("SELECT * FROM settings ORDER BY key ASC")
      .all() as SettingRow[];

    return NextResponse.json({ settings: mapSettingsRows(rows) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to load settings: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * Saves many settings in one request.
 * Null values delete keys; non-empty strings are upserted.
 */
export async function PUT(request: Request) {
  try {
    ensureReminderSchedulerStarted();
    const payload = await request.json();
    const { settings, error } = parseSettingsPutPayload(payload);

    if (!settings) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    const upsertSetting = db.prepare(
      `
      INSERT INTO settings (key, value, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      `,
    );
    const deleteSetting = db.prepare("DELETE FROM settings WHERE key = ?");

    // Keep all setting changes in one transaction for consistency.
    db.exec("BEGIN");
    try {
      for (const setting of settings) {
        if (setting.value === null) {
          deleteSetting.run(setting.key);
          continue;
        }

        upsertSetting.run(setting.key, setting.value, now, now);
      }
      db.exec("COMMIT");
    } catch (errorInTransaction) {
      db.exec("ROLLBACK");
      throw errorInTransaction;
    }

    const rows = db
      .prepare("SELECT * FROM settings ORDER BY key ASC")
      .all() as SettingRow[];

    return NextResponse.json({ settings: mapSettingsRows(rows) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to save settings: ${message}` },
      { status: 500 },
    );
  }
}
