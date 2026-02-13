// API handler for sending a manual ntfy test notification.
import { NextResponse } from "next/server";
import { ensureReminderSchedulerStarted, sendTestNotification } from "@/lib/server/reminders";

export const runtime = "nodejs";

type TestPayload = {
  ntfyUrl?: string;
  ntfyTopic?: string;
  ntfyBearerToken?: string;
};

function parsePayload(payload: unknown): TestPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return {};
  }

  const record = payload as Record<string, unknown>;

  return {
    ntfyUrl: typeof record.ntfyUrl === "string" ? record.ntfyUrl : undefined,
    ntfyTopic: typeof record.ntfyTopic === "string" ? record.ntfyTopic : undefined,
    ntfyBearerToken:
      typeof record.ntfyBearerToken === "string"
        ? record.ntfyBearerToken
        : undefined,
  };
}

/**
 * Sends a test notification using optional request overrides.
 * This helps users verify ntfy settings from the UI.
 */
export async function POST(request: Request) {
  try {
    ensureReminderSchedulerStarted();
    let payload: TestPayload | undefined;

    // Read raw text first so empty body is allowed.
    const raw = await request.text();
    if (raw.trim().length > 0) {
      payload = parsePayload(JSON.parse(raw));
    }

    const result = await sendTestNotification(payload);

    return NextResponse.json({
      ok: true,
      message: `Test notification sent to ${result.targetUrl}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to send test notification: ${message}` },
      { status: 400 },
    );
  }
}
