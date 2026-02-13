// Dev-only API handler to run reminder checks on demand.
import { NextResponse } from "next/server";
import { ensureReminderSchedulerStarted, runReminderCheck } from "@/lib/server/reminders";

export const runtime = "nodejs";

/**
 * Runs the reminder check immediately in development mode.
 * Production returns 404 to avoid public trigger access.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    ensureReminderSchedulerStarted();
    const result = await runReminderCheck();
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to run reminder check: ${message}` },
      { status: 500 },
    );
  }
}
