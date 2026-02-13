// API handlers for updating and deleting one subscription by id.
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";
import {
  mapSubscriptionRow,
  parseSubscriptionPatchPayload,
} from "@/lib/server/subscriptions";

export const runtime = "nodejs";

type SubscriptionRow = Parameters<typeof mapSubscriptionRow>[0];

type Context = {
  params: Promise<{ id: string }>;
};

/**
 * Applies partial updates to one subscription.
 * Only validated fields are written to SQLite.
 */
export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const { fields, error } = parseSubscriptionPatchPayload(payload);

    if (!fields) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided for update." },
        { status: 400 },
      );
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    // Build a safe dynamic SET clause from validated field names.
    const assignments = [...keys, "updated_at"].map((key) => `${key} = ?`).join(", ");
    const values = [...keys.map((key) => fields[key]), now, id];

    const result = db
      .prepare(`UPDATE subscriptions SET ${assignments} WHERE id = ?`)
      .run(...values);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Subscription not found." }, { status: 404 });
    }

    const updatedRow = db
      .prepare("SELECT * FROM subscriptions WHERE id = ? LIMIT 1")
      .get(id) as SubscriptionRow | undefined;

    if (!updatedRow) {
      return NextResponse.json(
        { error: "Subscription updated but could not be reloaded." },
        { status: 500 },
      );
    }

    return NextResponse.json({ subscription: mapSubscriptionRow(updatedRow) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to update subscription: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * Deletes one subscription by id.
 * Returns 204 when delete succeeds.
 */
export async function DELETE(_: Request, context: Context) {
  try {
    const { id } = await context.params;
    const db = getDatabase();
    const result = db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Subscription not found." }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to delete subscription: ${message}` },
      { status: 500 },
    );
  }
}
