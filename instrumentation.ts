// Starts server-only background tasks when the app boots.
/**
 * Runs once on server startup.
 * It starts the reminder scheduler in Node runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const { ensureReminderSchedulerStarted } = await import("@/lib/server/reminders");
  ensureReminderSchedulerStarted();
}
