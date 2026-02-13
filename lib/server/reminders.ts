// Handles reminder scheduling, reminder checks, and ntfy notification sending.
import { getDatabase } from "@/lib/db";
import { mapSettingsRows, type SettingRow } from "@/lib/server/settings";

const REMINDER_KIND = "charge";
const REMINDER_TITLE = "Charge Date Reminder";
const REMINDER_TIME_ZONE = process.env.QUIFIN_TIMEZONE ?? "Europe/Dublin";
const SCHEDULE_HOUR = 5;
const SCHEDULE_MINUTE = 30;

type ReminderOffsetDays = 1 | 2;

type ReminderSubscriptionRow = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  cadence_months: number;
  next_charge_date: string;
  remind_cancel: number;
  archived: number;
  cancel_url: string | null;
};

type FxRateRow = {
  currency: string;
  rate_to_eur: number;
};

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type NtfySettings = {
  ntfyUrl: string;
  ntfyTopic: string;
  ntfyBearerToken: string;
};

type ResolvedNtfySettings = {
  topicUrl: string;
  bearerToken: string;
};

export type ReminderRunResult = {
  runAt: string;
  timeZone: string;
  windowsChecked: number;
  candidatesChecked: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  warnings: string[];
};

type ReminderSchedulerState = {
  started: boolean;
  timer: NodeJS.Timeout | null;
  inFlight: Promise<ReminderRunResult> | null;
};

declare global {
  var __quifinReminderScheduler: ReminderSchedulerState | undefined;
}

function getSchedulerState(): ReminderSchedulerState {
  if (!globalThis.__quifinReminderScheduler) {
    globalThis.__quifinReminderScheduler = {
      started: false,
      timer: null,
      inFlight: null,
    };
  }

  return globalThis.__quifinReminderScheduler;
}

function getDateTimeParts(date: Date, timeZone: string): DateTimeParts {
  // Read date parts in the target time zone so scheduling is stable.
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const found = parts.find((item) => item.type === type)?.value;
    return found ? Number(found) : 0;
  };

  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function toIsoDate(parts: Pick<DateTimeParts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );

  return toIsoDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function getTimeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = getDateTimeParts(new Date(instantMs), timeZone);
  const localAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return localAsUtcMs - instantMs;
}

function zonedDateTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  // Convert a local wall-clock time to UTC.
  // We re-check offset a few times to handle DST transitions.
  const targetAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetAsUtcMs;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const offsetMs = getTimeZoneOffsetMs(guess, timeZone);
    const corrected = targetAsUtcMs - offsetMs;
    if (Math.abs(corrected - guess) < 1000) {
      return corrected;
    }
    guess = corrected;
  }

  return guess;
}

function addDaysToYmd(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function computeNextDailyRunAtMs(now: Date, timeZone: string): number {
  // If today's schedule time already passed, move to tomorrow.
  const localNow = getDateTimeParts(now, timeZone);
  const hasPassedTodayRun =
    localNow.hour > SCHEDULE_HOUR ||
    (localNow.hour === SCHEDULE_HOUR && localNow.minute >= SCHEDULE_MINUTE);

  const targetDate = hasPassedTodayRun
    ? addDaysToYmd(localNow.year, localNow.month, localNow.day, 1)
    : {
        year: localNow.year,
        month: localNow.month,
        day: localNow.day,
      };

  return zonedDateTimeToUtcMs(
    targetDate.year,
    targetDate.month,
    targetDate.day,
    SCHEDULE_HOUR,
    SCHEDULE_MINUTE,
    timeZone,
  );
}

function formatIsoDateForDisplay(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function resolveNtfySettings(settings: NtfySettings): {
  config: ResolvedNtfySettings | null;
  warning: string | null;
} {
  const trimmedUrl = settings.ntfyUrl.trim();
  const trimmedTopic = settings.ntfyTopic.trim().replace(/^\/+|\/+$/g, "");
  const trimmedToken = settings.ntfyBearerToken.trim();

  if (!trimmedUrl) {
    return {
      config: null,
      warning:
        "ntfy configuration is missing: ntfy_url is required. Reminder send skipped.",
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return {
      config: null,
      warning: `ntfy_url is not a valid URL (${trimmedUrl}). Reminder send skipped.`,
    };
  }

  const hasTopicInUrl = parsedUrl.pathname.split("/").some((segment) => segment.length > 0);

  if (!trimmedTopic && !hasTopicInUrl) {
    return {
      config: null,
      warning:
        "ntfy configuration is incomplete: provide ntfy_topic or include topic in ntfy_url. Reminder send skipped.",
    };
  }

  if (trimmedTopic) {
    parsedUrl.pathname = `/${trimmedTopic
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/")}`;
  }

  return {
    config: {
      topicUrl: parsedUrl.toString(),
      bearerToken: trimmedToken,
    },
    warning: null,
  };
}

function getNtfySettingsFromDatabase(): NtfySettings {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM settings").all() as SettingRow[];
  const settings = mapSettingsRows(rows);

  return {
    ntfyUrl: settings.ntfy_url ?? "",
    ntfyTopic: settings.ntfy_topic ?? "",
    ntfyBearerToken: settings.ntfy_bearer_token ?? settings.ntfy_token ?? "",
  };
}

async function postNtfyNotification(
  config: ResolvedNtfySettings,
  title: string,
  message: string,
): Promise<void> {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    Title: title,
    "X-Title": title,
  });

  if (config.bearerToken) {
    headers.set("Authorization", `Bearer ${config.bearerToken}`);
  }

  const response = await fetch(config.topicUrl, {
    method: "POST",
    headers,
    body: message,
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(
      `ntfy request failed (${response.status} ${response.statusText})${
        payload ? `: ${payload}` : ""
      }`,
    );
  }
}

function buildChargeReminderBody(
  subscription: ReminderSubscriptionRow,
  offsetDays: ReminderOffsetDays,
  fxRates: Record<string, number>,
): string {
  const chargeDateDisplay = formatIsoDateForDisplay(subscription.next_charge_date);
  const duePhrase =
    offsetDays === 1
      ? `due tomorrow (${chargeDateDisplay})`
      : `due in 2 days (${chargeDateDisplay})`;

  const cadenceMonths = Math.max(1, Number(subscription.cadence_months) || 1);
  const originalMonthly = subscription.amount / cadenceMonths;
  const originalAnnualized = originalMonthly * 12;
  const currency = subscription.currency.toUpperCase();

  let monthlyLine = "";
  let annualizedLine = "";

  if (currency === "EUR") {
    monthlyLine = `Effective monthly EUR: ${formatEur(originalMonthly)}`;
    annualizedLine = `Annualized EUR: ${formatEur(originalAnnualized)}`;
  } else {
    // For non-EUR subscriptions we show EUR values only when FX exists.
    const fxRate = fxRates[currency];
    if (Number.isFinite(fxRate) && fxRate > 0) {
      const monthlyEur = originalMonthly * fxRate;
      const annualizedEur = originalAnnualized * fxRate;

      monthlyLine = `Effective monthly EUR: ${formatEur(monthlyEur)} (${formatAmount(originalMonthly)} ${currency})`;
      annualizedLine = `Annualized EUR: ${formatEur(annualizedEur)} (${formatAmount(originalAnnualized)} ${currency})`;
    } else {
      monthlyLine = `Effective monthly EUR: n/a (${formatAmount(originalMonthly)} ${currency})`;
      annualizedLine = `Annualized EUR: n/a (${formatAmount(originalAnnualized)} ${currency})`;
    }
  }

  const lines = [
    `Your subscription ${subscription.name} is ${duePhrase}.`,
    "",
    `Original amount: ${formatAmount(subscription.amount)} ${currency}`,
    monthlyLine,
    annualizedLine,
  ];

  const cancelUrl = subscription.cancel_url?.trim();
  if (cancelUrl) {
    lines.push("", cancelUrl);
  }

  return lines.join("\n");
}

function loadFxRateMap(): Record<string, number> {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT currency, rate_to_eur FROM fx_rates")
    .all() as FxRateRow[];

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.currency.toUpperCase()] = Number(row.rate_to_eur);
    return acc;
  }, {});
}

function getTodayIsoInReminderTimeZone(now: Date): string {
  const parts = getDateTimeParts(now, REMINDER_TIME_ZONE);
  return toIsoDate(parts);
}

async function runReminderCheckInternal(now: Date): Promise<ReminderRunResult> {
  const db = getDatabase();
  const runAt = new Date().toISOString();
  const warnings: string[] = [];
  const fxRateMap = loadFxRateMap();

  const ntfySettings = getNtfySettingsFromDatabase();
  const { config: ntfyConfig, warning } = resolveNtfySettings(ntfySettings);
  if (warning) {
    warnings.push(warning);
    console.warn(`[reminders] ${warning}`);
  }

  // Prepare SQL once so each candidate check is fast and consistent.
  const selectSubscriptionsByDate = db.prepare(
    `
    SELECT id, name, amount, currency, cadence_months, next_charge_date, remind_cancel, archived, cancel_url
    FROM subscriptions
    WHERE archived = 0
      AND remind_cancel = 1
      AND next_charge_date = ?
    ORDER BY next_charge_date ASC, created_at ASC
    `,
  );

  const hasReminderLog = db.prepare(
    `
    SELECT 1
    FROM reminder_log
    WHERE subscription_id = ?
      AND reminder_kind = ?
      AND target_charge_date = ?
      AND offset_days = ?
    LIMIT 1
    `,
  );

  const insertReminderLog = db.prepare(
    `
    INSERT INTO reminder_log (
      subscription_id,
      reminder_kind,
      target_charge_date,
      offset_days,
      sent_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  );

  const windows: ReminderOffsetDays[] = [1, 2];
  const todayIso = getTodayIsoInReminderTimeZone(now);

  let candidatesChecked = 0;
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const offsetDays of windows) {
    // For each reminder window, find subscriptions with that target charge date.
    const targetChargeDate = addDaysToIsoDate(todayIso, offsetDays);
    const candidates = selectSubscriptionsByDate.all(
      targetChargeDate,
    ) as ReminderSubscriptionRow[];

    for (const candidate of candidates) {
      candidatesChecked += 1;

      const alreadyLogged = hasReminderLog.get(
        candidate.id,
        REMINDER_KIND,
        candidate.next_charge_date,
        offsetDays,
      );
      if (alreadyLogged) {
        skippedCount += 1;
        continue;
      }

      if (!ntfyConfig) {
        skippedCount += 1;
        continue;
      }

      const body = buildChargeReminderBody(candidate, offsetDays, fxRateMap);

      try {
        await postNtfyNotification(ntfyConfig, REMINDER_TITLE, body);
        const sentAt = new Date().toISOString();

        insertReminderLog.run(
          candidate.id,
          REMINDER_KIND,
          candidate.next_charge_date,
          offsetDays,
          sentAt,
          sentAt,
        );

        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : "Unknown error";
        const warningMessage =
          `Failed to send reminder for ${candidate.name} ` +
          `(${candidate.next_charge_date}, offset ${offsetDays}): ${message}`;
        warnings.push(warningMessage);
        console.warn(`[reminders] ${warningMessage}`);
      }
    }
  }

  return {
    runAt,
    timeZone: REMINDER_TIME_ZONE,
    windowsChecked: windows.length,
    candidatesChecked,
    sentCount,
    skippedCount,
    failedCount,
    warnings,
  };
}

function scheduleNextDailyReminderRun(): void {
  const schedulerState = getSchedulerState();
  if (schedulerState.timer) {
    clearTimeout(schedulerState.timer);
    schedulerState.timer = null;
  }

  // Keep one active timer and always schedule the next daily run.
  const now = new Date();
  const nextRunAtMs = computeNextDailyRunAtMs(now, REMINDER_TIME_ZONE);
  const delayMs = Math.max(1000, nextRunAtMs - Date.now());

  schedulerState.timer = setTimeout(() => {
    void runReminderCheck({ now: new Date() })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn(`[reminders] Scheduled run failed: ${message}`);
      })
      .finally(() => {
        scheduleNextDailyReminderRun();
      });
  }, delayMs);
}

/**
 * Starts the reminder scheduler once per process.
 * It also triggers one immediate background check on startup.
 */
export function ensureReminderSchedulerStarted(): void {
  const schedulerState = getSchedulerState();
  if (schedulerState.started) return;

  schedulerState.started = true;
  scheduleNextDailyReminderRun();

  void runReminderCheck({ now: new Date() }).catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`[reminders] Startup run failed: ${message}`);
  });
}

/**
 * Runs one reminder check.
 * If another check is already running, it returns the same promise.
 */
export async function runReminderCheck(options?: {
  now?: Date;
}): Promise<ReminderRunResult> {
  const schedulerState = getSchedulerState();
  if (schedulerState.inFlight) {
    return schedulerState.inFlight;
  }

  const now = options?.now ?? new Date();

  schedulerState.inFlight = runReminderCheckInternal(now).finally(() => {
    schedulerState.inFlight = null;
  });

  return schedulerState.inFlight;
}

/**
 * Sends a manual test notification to ntfy.
 * Optional override values let API callers test unsaved settings.
 */
export async function sendTestNotification(override?:
  | Partial<NtfySettings>
  | null): Promise<{ targetUrl: string }> {
  const settings = override
    ? {
        ntfyUrl: override.ntfyUrl?.trim() ?? "",
        ntfyTopic: override.ntfyTopic?.trim() ?? "",
        ntfyBearerToken: override.ntfyBearerToken?.trim() ?? "",
      }
    : getNtfySettingsFromDatabase();

  const { config, warning } = resolveNtfySettings(settings);
  if (!config || warning) {
    throw new Error(warning ?? "ntfy settings are incomplete.");
  }

  const now = new Date();
  const nowDisplay = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(now);

  const body = [
    "This is a QuiFin test notification.",
    `Sent at: ${nowDisplay}`,
  ].join("\n");

  await postNtfyNotification(config, "QuiFin Test Notification", body);

  return {
    targetUrl: config.topicUrl,
  };
}
