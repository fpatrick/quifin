// API handlers for listing and creating subscriptions.
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";
import {
  mapSubscriptionRow,
  parseCreateSubscriptionPayload,
} from "@/lib/server/subscriptions";

export const runtime = "nodejs";

type SubscriptionRow = Parameters<typeof mapSubscriptionRow>[0];

/**
 * Returns all subscriptions sorted by next charge date.
 * This is the main list endpoint for the Subscriptions tab.
 */
export async function GET() {
  try {
    const db = getDatabase();
    // Query raw rows and map them to API-friendly field names.
    const rows = db
      .prepare("SELECT * FROM subscriptions ORDER BY next_charge_date ASC")
      .all() as SubscriptionRow[];

    return NextResponse.json({
      subscriptions: rows.map(mapSubscriptionRow),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to load subscriptions: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * Creates one subscription after payload validation.
 * Returns the inserted row reloaded from SQLite.
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { data, error } = parseCreateSubscriptionPayload(payload);
    if (!data) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const db = getDatabase();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    db.prepare(
      `
      INSERT INTO subscriptions (
        id,
        name,
        amount,
        currency,
        cadence_type,
        cadence_months,
        next_charge_date,
        remind_cancel,
        remind_lead_days,
        archived,
        notes,
        cancel_url,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      data.name,
      data.amount,
      data.currency,
      data.cadenceType,
      data.cadenceMonths,
      data.nextChargeDate,
      data.remindCancel ? 1 : 0,
      data.remindLeadDays,
      data.archived ? 1 : 0,
      data.notes,
      data.cancelUrl,
      now,
      now,
    );

    const row = db
      .prepare("SELECT * FROM subscriptions WHERE id = ? LIMIT 1")
      .get(id) as SubscriptionRow | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "Subscription created but could not be reloaded." },
        { status: 500 },
      );
    }

    return NextResponse.json({ subscription: mapSubscriptionRow(row) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create subscription: ${message}` },
      { status: 500 },
    );
  }
}
