// Converts subscription rows and validates subscription payloads.
import type { CadenceType, Subscription, SubscriptionWritePayload } from "@/lib/types";

type SubscriptionRow = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  cadence_type: CadenceType;
  cadence_months: number;
  next_charge_date: string;
  remind_cancel: number;
  remind_lead_days: number | null;
  archived: number;
  notes: string | null;
  cancel_url: string | null;
  created_at: string;
  updated_at: string;
};

const cadenceTypes: CadenceType[] = [
  "monthly",
  "quarterly",
  "semiannual",
  "yearly",
  "custom",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks strict ISO date format (YYYY-MM-DD) and calendar validity.
 * This prevents invalid days like 2026-02-30.
 */
export function isIsoDateString(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12) return false;

  const maxDay = new Date(year, month, 0).getDate();
  return day >= 1 && day <= maxDay;
}

function toCadenceType(value: unknown): CadenceType | null {
  if (typeof value !== "string") return null;
  return cadenceTypes.includes(value as CadenceType) ? (value as CadenceType) : null;
}

function toNullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Maps one SQLite row to the app subscription type.
 * Numeric flags in SQLite are converted to booleans here.
 */
export function mapSubscriptionRow(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    currency: row.currency,
    cadenceType: row.cadence_type,
    cadenceMonths: Number(row.cadence_months),
    nextChargeDate: row.next_charge_date,
    remindCancel: Boolean(row.remind_cancel),
    remindLeadDays:
      row.remind_lead_days === null ? null : Number(row.remind_lead_days),
    archived: Boolean(row.archived),
    notes: row.notes,
    cancelUrl: row.cancel_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validates payload for creating a subscription.
 * Returns parsed data or one clear validation error.
 */
export function parseCreateSubscriptionPayload(
  payload: unknown,
): { data: SubscriptionWritePayload | null; error: string | null } {
  if (!isPlainObject(payload)) {
    return { data: null, error: "Invalid payload format." };
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) return { data: null, error: "Name is required." };

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { data: null, error: "Amount must be a non-negative number." };
  }

  const currency = typeof payload.currency === "string" ? payload.currency.trim().toUpperCase() : "";
  if (!currency) return { data: null, error: "Currency is required." };

  const cadenceType = toCadenceType(payload.cadenceType);
  if (!cadenceType) return { data: null, error: "Invalid cadence type." };

  const cadenceMonths = Number(payload.cadenceMonths);
  if (!Number.isInteger(cadenceMonths) || cadenceMonths <= 0) {
    return { data: null, error: "Cadence months must be a positive integer." };
  }

  const nextChargeDate =
    typeof payload.nextChargeDate === "string" ? payload.nextChargeDate : "";
  if (!isIsoDateString(nextChargeDate)) {
    return { data: null, error: "Next charge date must be ISO YYYY-MM-DD." };
  }

  const remindCancel = Boolean(payload.remindCancel);
  const archived = Boolean(payload.archived);

  let remindLeadDays: number | null = null;
  if (payload.remindLeadDays !== undefined && payload.remindLeadDays !== null) {
    const parsedLead = Number(payload.remindLeadDays);
    if (!Number.isInteger(parsedLead) || parsedLead <= 0) {
      return { data: null, error: "Reminder lead days must be a positive integer." };
    }
    remindLeadDays = parsedLead;
  }

  const data: SubscriptionWritePayload = {
    name,
    amount,
    currency,
    cadenceType,
    cadenceMonths,
    nextChargeDate,
    remindCancel,
    remindLeadDays,
    archived,
    notes: toNullableText(payload.notes),
    cancelUrl: toNullableText(payload.cancelUrl),
  };

  return { data, error: null };
}

/**
 * Validates partial updates for subscription PATCH calls.
 * Only provided fields are returned in DB column format.
 */
export function parseSubscriptionPatchPayload(
  payload: unknown,
): { fields: Record<string, unknown> | null; error: string | null } {
  if (!isPlainObject(payload)) {
    return { fields: null, error: "Invalid payload format." };
  }

  const fields: Record<string, unknown> = {};

  if ("name" in payload) {
    if (typeof payload.name !== "string" || !payload.name.trim()) {
      return { fields: null, error: "Name must be a non-empty string." };
    }
    fields.name = payload.name.trim();
  }

  if ("amount" in payload) {
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return { fields: null, error: "Amount must be a non-negative number." };
    }
    fields.amount = amount;
  }

  if ("currency" in payload) {
    if (typeof payload.currency !== "string" || !payload.currency.trim()) {
      return { fields: null, error: "Currency must be a non-empty string." };
    }
    fields.currency = payload.currency.trim().toUpperCase();
  }

  if ("cadenceType" in payload) {
    const cadenceType = toCadenceType(payload.cadenceType);
    if (!cadenceType) {
      return { fields: null, error: "Invalid cadence type." };
    }
    fields.cadence_type = cadenceType;
  }

  if ("cadenceMonths" in payload) {
    const cadenceMonths = Number(payload.cadenceMonths);
    if (!Number.isInteger(cadenceMonths) || cadenceMonths <= 0) {
      return { fields: null, error: "Cadence months must be a positive integer." };
    }
    fields.cadence_months = cadenceMonths;
  }

  if ("nextChargeDate" in payload) {
    if (
      typeof payload.nextChargeDate !== "string" ||
      !isIsoDateString(payload.nextChargeDate)
    ) {
      return { fields: null, error: "Next charge date must be ISO YYYY-MM-DD." };
    }
    fields.next_charge_date = payload.nextChargeDate;
  }

  if ("remindCancel" in payload) {
    fields.remind_cancel = payload.remindCancel ? 1 : 0;
  }

  if ("archived" in payload) {
    fields.archived = payload.archived ? 1 : 0;
  }

  if ("remindLeadDays" in payload) {
    if (payload.remindLeadDays === null) {
      fields.remind_lead_days = null;
    } else {
      const remindLeadDays = Number(payload.remindLeadDays);
      if (!Number.isInteger(remindLeadDays) || remindLeadDays <= 0) {
        return {
          fields: null,
          error: "Reminder lead days must be a positive integer.",
        };
      }
      fields.remind_lead_days = remindLeadDays;
    }
  }

  if ("notes" in payload) {
    fields.notes = toNullableText(payload.notes);
  }

  if ("cancelUrl" in payload) {
    fields.cancel_url = toNullableText(payload.cancelUrl);
  }

  return { fields, error: null };
}
