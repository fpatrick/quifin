// API handlers for manual FX rates used in EUR conversions.
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";
import type { FxRate } from "@/lib/types";

export const runtime = "nodejs";

type FxRateRow = {
  currency: string;
  rate_to_eur: number;
  created_at: string;
  updated_at: string;
};

function mapFxRateRow(row: FxRateRow): FxRate {
  return {
    currency: row.currency,
    rateToEur: Number(row.rate_to_eur),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validates the FX rate payload for create/update.
 * Currency is normalized to upper-case.
 */
function parseFxPayload(payload: unknown) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { data: null, error: "Invalid payload format." };
  }

  const record = payload as Record<string, unknown>;
  const currency =
    typeof record.currency === "string" ? record.currency.trim().toUpperCase() : "";
  if (!currency) {
    return { data: null, error: "Currency is required." };
  }

  const rateToEur = Number(record.rateToEur);
  if (!Number.isFinite(rateToEur) || rateToEur <= 0) {
    return { data: null, error: "rateToEur must be a positive number." };
  }

  return { data: { currency, rateToEur }, error: null };
}

/**
 * Returns all FX rates sorted by currency code.
 * The UI uses this list for conversion displays.
 */
export async function GET() {
  try {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT * FROM fx_rates ORDER BY currency ASC")
      .all() as FxRateRow[];

    return NextResponse.json({ rates: rows.map(mapFxRateRow) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to load FX rates: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * Upserts one FX rate by currency code.
 * Existing rows are updated in place.
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { data, error } = parseFxPayload(payload);
    if (!data) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    // Use upsert so one endpoint handles both create and update.
    db.prepare(
      `
      INSERT INTO fx_rates (currency, rate_to_eur, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(currency) DO UPDATE SET
        rate_to_eur = excluded.rate_to_eur,
        updated_at = excluded.updated_at
      `,
    ).run(data.currency, data.rateToEur, now, now);

    const row = db
      .prepare("SELECT * FROM fx_rates WHERE currency = ? LIMIT 1")
      .get(data.currency) as FxRateRow | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "FX rate saved but could not be reloaded." },
        { status: 500 },
      );
    }

    return NextResponse.json({ rate: mapFxRateRow(row) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to save FX rate: ${message}` },
      { status: 500 },
    );
  }
}
