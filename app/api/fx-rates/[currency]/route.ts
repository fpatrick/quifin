// API handler for deleting one FX rate by currency.
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ currency: string }>;
};

/**
 * Deletes one FX rate using the currency path param.
 * Currency input is normalized before query.
 */
export async function DELETE(_: Request, context: Context) {
  try {
    const { currency: rawCurrency } = await context.params;
    const currency = rawCurrency.trim().toUpperCase();

    if (!currency) {
      return NextResponse.json({ error: "Currency is required." }, { status: 400 });
    }

    const db = getDatabase();
    const result = db.prepare("DELETE FROM fx_rates WHERE currency = ?").run(currency);

    if (result.changes === 0) {
      return NextResponse.json({ error: "FX rate not found." }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to delete FX rate: ${message}` },
      { status: 500 },
    );
  }
}
