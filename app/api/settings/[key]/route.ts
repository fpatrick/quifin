// API handlers for one setting key: read, write, and delete.
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";
import {
  normalizeSettingKey,
  parseSettingValuePayload,
  type SettingRow,
} from "@/lib/server/settings";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ key: string }>;
};

function mapSettingRow(row: SettingRow) {
  return {
    key: row.key,
    value: row.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveKey(context: Context) {
  const { key: rawKey } = await context.params;
  return normalizeSettingKey(rawKey);
}

/**
 * Returns one setting row by key.
 * The key is validated before DB access.
 */
export async function GET(_: Request, context: Context) {
  try {
    const key = await resolveKey(context);
    if (!key) {
      return NextResponse.json({ error: "Invalid setting key." }, { status: 400 });
    }

    const db = getDatabase();
    const row = db
      .prepare("SELECT * FROM settings WHERE key = ? LIMIT 1")
      .get(key) as SettingRow | undefined;

    if (!row) {
      return NextResponse.json({ error: "Setting not found." }, { status: 404 });
    }

    return NextResponse.json({ setting: mapSettingRow(row) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to load setting: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * Upserts one setting key with a non-empty string value.
 * Returns the saved row after write.
 */
export async function PUT(request: Request, context: Context) {
  try {
    const key = await resolveKey(context);
    if (!key) {
      return NextResponse.json({ error: "Invalid setting key." }, { status: 400 });
    }

    const payload = await request.json();
    const { value, error } = parseSettingValuePayload(payload);
    if (!value) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO settings (key, value, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      `,
    ).run(key, value, now, now);

    const row = db
      .prepare("SELECT * FROM settings WHERE key = ? LIMIT 1")
      .get(key) as SettingRow | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "Setting saved but could not be reloaded." },
        { status: 500 },
      );
    }

    return NextResponse.json({ setting: mapSettingRow(row) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to save setting: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * Deletes one setting key.
 * Returns 204 when the row existed and was removed.
 */
export async function DELETE(_: Request, context: Context) {
  try {
    const key = await resolveKey(context);
    if (!key) {
      return NextResponse.json({ error: "Invalid setting key." }, { status: 400 });
    }

    const db = getDatabase();
    const result = db.prepare("DELETE FROM settings WHERE key = ?").run(key);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Setting not found." }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to delete setting: ${message}` },
      { status: 500 },
    );
  }
}
