"use client";

// Main app shell with tab navigation, CRUD flows, and calculator state.
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type {
  CadenceType,
  FxRate,
  SettingsMap,
  Subscription,
  SubscriptionWritePayload,
} from "@/lib/types";
import { ModalSheet } from "./modal-sheet";
import { Toggle } from "./toggle";

type TabKey = "subscriptions" | "partners";

type PartnerInputs = {
  incomeA: number;
  incomeB: number;
  sharedBills: number;
};

type SubscriptionForm = {
  name: string;
  amount: string;
  currency: string;
  cadenceType: CadenceType;
  customMonths: string;
  nextChargeDate: string;
  remindCancel: boolean;
  cancelUrl: string;
  notes: string;
};

type FxForm = {
  currency: string;
  rateToEur: string;
};

type NotificationsForm = {
  ntfyUrl: string;
  topic: string;
  token: string;
};

type SubscriptionsResponse = {
  subscriptions: Subscription[];
};

type FxRatesResponse = {
  rates: FxRate[];
};

type SettingsResponse = {
  settings: SettingsMap;
};

type TestNotificationResponse = {
  ok: boolean;
  message: string;
};

type ReminderRunResult = {
  runAt: string;
  timeZone: string;
  windowsChecked: number;
  candidatesChecked: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  warnings: string[];
};

type ReminderRunResponse = {
  result: ReminderRunResult;
};

type SubscriptionResponse = {
  subscription: Subscription;
};

type FxRateResponse = {
  rate: FxRate;
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "subscriptions", label: "Subscriptions" },
  { key: "partners", label: "Partners" },
];

const NTFY_URL_KEY = "ntfy_url";
const NTFY_TOPIC_KEY = "ntfy_topic";
const NTFY_BEARER_TOKEN_KEY = "ntfy_bearer_token";
const PARTNERS_INCOME_A_KEY = "partners_income_a";
const PARTNERS_INCOME_B_KEY = "partners_income_b";
const PARTNERS_SHARED_BILLS_KEY = "partners_shared_bills";
const PARTNER_SETTINGS_DEBOUNCE_MS = 450;

const defaultPartnerInputs: PartnerInputs = {
  incomeA: 4100,
  incomeB: 2600,
  sharedBills: 2300,
};

const emptyForm: SubscriptionForm = {
  name: "",
  amount: "",
  currency: "EUR",
  cadenceType: "monthly",
  customMonths: "2",
  nextChargeDate: "",
  remindCancel: false,
  cancelUrl: "",
  notes: "",
};

const emptyFxForm: FxForm = {
  currency: "",
  rateToEur: "",
};

function cadenceInfo(type: CadenceType, customMonths: string) {
  if (type === "monthly") return { label: "Monthly", months: 1 };
  if (type === "quarterly") return { label: "Every 3 months", months: 3 };
  if (type === "semiannual") return { label: "Every 6 months", months: 6 };
  if (type === "yearly") return { label: "Yearly", months: 12 };

  const parsed = Number(customMonths);
  const safeMonths = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return { label: `Every ${safeMonths} months`, months: safeMonths };
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function createLocalNoonDate(year: number, monthIndex: number, day: number) {
  // Use local noon to avoid DST edge cases around midnight shifts.
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function parseIsoDateParts(isoDate: string) {
  // Parse and validate a strict ISO date.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12) return null;

  const maxDay = daysInMonth(year, month - 1);
  if (day < 1 || day > maxDay) return null;

  return { year, month, day };
}

function formatDate(dateString: string) {
  const parts = parseIsoDateParts(dateString);
  if (!parts) return dateString;

  const localDate = createLocalNoonDate(parts.year, parts.month - 1, parts.day);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(localDate);
}

function parseDisplayDateToIso(displayDate: string) {
  const trimmed = displayDate.trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12) return null;

  const maxDay = daysInMonth(year, month - 1);
  if (day < 1 || day > maxDay) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonthsWithRollover(baseDate: Date, monthsToAdd: number) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const day = baseDate.getDate();

  const targetMonthIndex = month + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Keep the day in range when month lengths are different.
  const maxDayInTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();

  return createLocalNoonDate(
    targetYear,
    normalizedMonth,
    Math.min(day, maxDayInTargetMonth),
  );
}

function computeDefaultNextChargeDate(
  cadenceType: CadenceType,
  customMonths: string,
  baseDate: Date = new Date(),
) {
  const normalizedBase = createLocalNoonDate(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
  );
  const cadence = cadenceInfo(cadenceType, customMonths);
  return toIsoDate(addMonthsWithRollover(normalizedBase, cadence.months));
}

function formatCurrency(value: number, currency: string, locale: string = "en-US") {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatPrimaryEur(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function sortSubscriptions(items: Subscription[]) {
  return [...items].sort((a, b) => a.nextChargeDate.localeCompare(b.nextChargeDate));
}

function sortFxRates(items: FxRate[]) {
  return [...items].sort((a, b) => a.currency.localeCompare(b.currency));
}

function toNotificationsForm(settings: SettingsMap): NotificationsForm {
  return {
    ntfyUrl: settings[NTFY_URL_KEY] ?? settings.NTFY_URL ?? "",
    topic: settings[NTFY_TOPIC_KEY] ?? settings.NTFY_TOPIC ?? "",
    token:
      settings[NTFY_BEARER_TOKEN_KEY] ??
      settings.ntfy_token ??
      settings.NTFY_TOKEN ??
      "",
  };
}

function parsePartnerInputValue(value: string | undefined, fallback: number) {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function serializePartnerInputs(values: PartnerInputs) {
  return `${values.incomeA}|${values.incomeB}|${values.sharedBills}`;
}

async function parseError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return (await response.json()) as T;
}

function toFormState(item?: Subscription): SubscriptionForm {
  if (!item) return { ...emptyForm };
  return {
    name: item.name,
    amount: String(item.amount),
    currency: item.currency,
    cadenceType: item.cadenceType,
    customMonths: String(item.cadenceMonths),
    nextChargeDate: item.nextChargeDate,
    remindCancel: item.remindCancel,
    cancelUrl: item.cancelUrl ?? "",
    notes: item.notes ?? "",
  };
}

type SubscriptionsTabProps = {
  subscriptions: Subscription[];
  fxRates: FxRate[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onCreateSubscription: (payload: SubscriptionWritePayload) => Promise<void>;
  onUpdateSubscription: (
    id: string,
    payload: Partial<SubscriptionWritePayload>,
  ) => Promise<void>;
  onDeleteSubscription: (id: string) => Promise<void>;
};

function SubscriptionsTab({
  subscriptions,
  fxRates,
  isLoading,
  error,
  onRefresh,
  onCreateSubscription,
  onUpdateSubscription,
  onDeleteSubscription,
}: SubscriptionsTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SubscriptionForm>(emptyForm);
  const [dateFieldValue, setDateFieldValue] = useState("");
  const [isDateManuallyEdited, setIsDateManuallyEdited] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeSubscriptions = useMemo(
    () => sortSubscriptions(subscriptions.filter((item) => !item.archived)),
    [subscriptions],
  );

  const archivedSubscriptions = useMemo(
    () => sortSubscriptions(subscriptions.filter((item) => item.archived)),
    [subscriptions],
  );

  const fxRateMap = useMemo(
    () =>
      fxRates.reduce<Record<string, number>>((acc, rate) => {
        acc[rate.currency] = rate.rateToEur;
        return acc;
      }, {}),
    [fxRates],
  );

  function setFormField<K extends keyof SubscriptionForm>(
    key: K,
    value: SubscriptionForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openAddModal() {
    setEditingId(null);
    const nextDate = computeDefaultNextChargeDate(
      emptyForm.cadenceType,
      emptyForm.customMonths,
    );
    setForm({ ...toFormState(), nextChargeDate: nextDate });
    setDateFieldValue(formatDate(nextDate));
    setIsDateManuallyEdited(false);
    setSaveError(null);
    setModalOpen(true);
  }

  function openEditModal(item: Subscription) {
    setEditingId(item.id);
    setForm(toFormState(item));
    setDateFieldValue(formatDate(item.nextChargeDate));
    setIsDateManuallyEdited(true);
    setSaveError(null);
    setModalOpen(true);
    setOpenActionsFor(null);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setForm(toFormState());
    setDateFieldValue("");
    setIsDateManuallyEdited(false);
    setSaveError(null);
  }

  async function saveSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cadence = cadenceInfo(form.cadenceType, form.customMonths);
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setSaveError("Amount must be a non-negative number.");
      return;
    }

    const currency = form.currency.trim().toUpperCase();
    if (!currency) {
      setSaveError("Currency is required.");
      return;
    }

    const nextDate =
      form.nextChargeDate ||
      computeDefaultNextChargeDate(form.cadenceType, form.customMonths);

    const payload: SubscriptionWritePayload = {
      name: form.name.trim() || "Untitled subscription",
      amount,
      currency,
      cadenceType: form.cadenceType,
      cadenceMonths: cadence.months,
      nextChargeDate: nextDate,
      remindCancel: form.remindCancel,
      remindLeadDays: null,
      archived: false,
      notes: form.notes.trim() ? form.notes.trim() : null,
      cancelUrl: form.cancelUrl.trim() ? form.cancelUrl.trim() : null,
    };

    setIsSaving(true);
    setSaveError(null);
    try {
      if (editingId) {
        await onUpdateSubscription(editingId, payload);
      } else {
        await onCreateSubscription(payload);
      }
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed.";
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function runCardAction(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed.";
      setActionError(message);
    }
  }

  return (
    <>
      <section className="ui-panel rounded-3xl p-5 sm:p-8">
        {openActionsFor && (
          <button
            type="button"
            aria-label="Close actions menu"
            onClick={() => setOpenActionsFor(null)}
            className="fixed inset-0 z-10 bg-transparent"
          />
        )}

        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--ui-text)]">
              Active subscriptions
            </h2>
            <p className="mt-2 text-sm ui-muted">
              Track upcoming charges and costs in one place.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowArchived((prev) => !prev)}
              className="rounded-full border border-transparent px-3 py-1.5 text-sm text-[var(--ui-text-muted)] transition hover:border-[var(--ui-border)] hover:text-[var(--ui-text)] focus-visible:border-[var(--ui-border)] focus-visible:outline-none focus-visible:text-[var(--ui-text)]"
            >
              Archived
            </button>
            <button
              type="button"
              onClick={openAddModal}
              className="rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-medium text-[var(--ui-text)] transition hover:bg-white/15"
            >
              Add subscription
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {error}{" "}
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="ml-2 underline"
            >
              Retry
            </button>
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {actionError}
          </div>
        )}

        {isLoading ? (
          <div className="rounded-2xl ui-card p-6 text-sm ui-muted">
            Loading subscriptions...
          </div>
        ) : (
          <div className="space-y-4">
            {activeSubscriptions.map((item) => {
              const cadence = cadenceInfo(item.cadenceType, String(item.cadenceMonths));
              const actionsOpen = openActionsFor === item.id;
              const originalMonthly = item.amount / item.cadenceMonths;
              const originalAnnualized = originalMonthly * 12;
              // Convert only when we have a manual FX rate for non-EUR currencies.
              const fxRate = item.currency === "EUR" ? 1 : fxRateMap[item.currency];
              const monthlyEur =
                item.currency === "EUR"
                  ? originalMonthly
                  : fxRate
                    ? originalMonthly * fxRate
                    : null;
              const annualizedEur =
                item.currency === "EUR"
                  ? originalAnnualized
                  : fxRate
                    ? originalAnnualized * fxRate
                    : null;
              const showOriginalSecondary = item.currency !== "EUR";

              return (
                <article key={item.id} className="ui-card rounded-2xl p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-medium text-[var(--ui-text)]">
                        {item.name}
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm ui-muted">
                        <span>{cadence.label}</span>
                        <span>Next charge: {formatDate(item.nextChargeDate)}</span>
                        <span>
                          Original:{" "}
                          {formatCurrency(
                            item.amount,
                            item.currency,
                            item.currency === "EUR" ? "de-DE" : "en-US",
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="relative z-30">
                      <button
                        type="button"
                        aria-label={`Open actions for ${item.name}`}
                        onClick={() =>
                          setOpenActionsFor((prev) =>
                            prev === item.id ? null : item.id,
                          )
                        }
                        className="rounded-full border border-[var(--ui-border)] px-2.5 py-1 text-sm text-[var(--ui-text-muted)] transition hover:border-white/35 hover:text-[var(--ui-text)]"
                      >
                        ⋯
                      </button>
                      <div
                        className={`absolute right-full top-0 z-30 mr-2 transition-all duration-300 ${
                          actionsOpen
                            ? "pointer-events-auto translate-x-0 opacity-100"
                            : "pointer-events-none translate-x-2 opacity-0"
                        }`}
                      >
                        <div className="ui-card flex items-center gap-1 rounded-xl p-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-muted)] transition hover:bg-white/8 hover:text-[var(--ui-text)]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void runCardAction(async () => {
                                await onUpdateSubscription(item.id, { archived: true });
                                setOpenActionsFor(null);
                              });
                            }}
                            className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-muted)] transition hover:bg-white/8 hover:text-[var(--ui-text)]"
                          >
                            Archive
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void runCardAction(async () => {
                                await onDeleteSubscription(item.id);
                                setOpenActionsFor(null);
                              });
                            }}
                            className="rounded-lg px-2.5 py-1.5 text-xs text-red-200/80 transition hover:bg-red-300/12 hover:text-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <div className="ui-card rounded-xl p-4">
                      <p className="text-xs uppercase tracking-wide ui-muted">
                        Effective monthly
                      </p>
                      <p className="mt-1 text-lg font-semibold text-[var(--ui-text)]">
                        {monthlyEur === null ? "—" : formatPrimaryEur(monthlyEur)}
                      </p>
                      {showOriginalSecondary && (
                        <p className="mt-1 text-xs ui-muted">
                          ({formatCurrency(originalMonthly, item.currency)})
                        </p>
                      )}
                    </div>
                    <div className="ui-card rounded-xl p-4">
                      <p className="text-xs uppercase tracking-wide ui-muted">
                        Annualized
                      </p>
                      <p className="mt-1 text-lg font-semibold text-[var(--ui-text)]">
                        {annualizedEur === null ? "—" : formatPrimaryEur(annualizedEur)}
                      </p>
                      {showOriginalSecondary && (
                        <p className="mt-1 text-xs ui-muted">
                          ({formatCurrency(originalAnnualized, item.currency)})
                        </p>
                      )}
                    </div>
                    <div className="ui-card rounded-xl p-4">
                      <p className="text-xs uppercase tracking-wide ui-muted">
                        Charge reminders
                      </p>
                      <div className="mt-2">
                        <Toggle
                          checked={item.remindCancel}
                          onChange={(value) => {
                            void runCardAction(async () => {
                              await onUpdateSubscription(item.id, {
                                remindCancel: value,
                              });
                            });
                          }}
                          label={`Charge reminders for ${item.name}`}
                        />
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div
          className={`overflow-hidden transition-all duration-300 ${
            showArchived ? "mt-8 max-h-[1200px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="border-t border-white/10 pt-6">
            <h3 className="text-base font-medium text-[var(--ui-text)]">
              Archived subscriptions
            </h3>
            <div className="mt-4 space-y-3">
              {archivedSubscriptions.length === 0 && (
                <p className="text-sm ui-muted">No archived subscriptions.</p>
              )}
              {archivedSubscriptions.map((item) => {
                const cadence = cadenceInfo(item.cadenceType, String(item.cadenceMonths));

                return (
                  <article
                    key={item.id}
                    className="ui-card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium text-[var(--ui-text)]">{item.name}</p>
                      <p className="text-sm ui-muted">
                        {cadence.label} • {formatDate(item.nextChargeDate)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void runCardAction(() =>
                            onUpdateSubscription(item.id, { archived: false }),
                          );
                        }}
                        className="rounded-full border border-[var(--ui-border)] px-3 py-1.5 text-xs text-[var(--ui-text-muted)] transition hover:border-white/35 hover:text-[var(--ui-text)]"
                      >
                        Unarchive
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void runCardAction(() => onDeleteSubscription(item.id));
                        }}
                        className="rounded-full border border-red-300/25 px-3 py-1.5 text-xs text-red-200/80 transition hover:border-red-200/45 hover:text-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <ModalSheet
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? "Edit Subscription" : "Add Subscription"}
      >
        <form className="grid gap-4 pb-2 sm:grid-cols-2" onSubmit={saveSubscription}>
          <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)] sm:col-span-2">
            Name
            <input
              type="text"
              value={form.name}
              onChange={(event) => setFormField("name", event.target.value)}
              placeholder="e.g. Spotify Family"
              className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
            Amount
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.amount}
              onChange={(event) => setFormField("amount", event.target.value)}
              placeholder="0.00"
              className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
            Currency
            <input
              type="text"
              value={form.currency}
              onChange={(event) => setFormField("currency", event.target.value)}
              placeholder="EUR"
              className="ui-input rounded-xl px-3 py-2.5 uppercase focus:border-white/30 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
            Cadence
            <select
              value={form.cadenceType}
              onChange={(event) => {
                const nextCadence = event.target.value as CadenceType;
                setForm((prev) => {
                  const nextChargeDate =
                    !editingId && !isDateManuallyEdited
                      ? computeDefaultNextChargeDate(nextCadence, prev.customMonths)
                      : prev.nextChargeDate;

                  if (!editingId && !isDateManuallyEdited) {
                    setDateFieldValue(formatDate(nextChargeDate));
                  }

                  return {
                    ...prev,
                    cadenceType: nextCadence,
                    nextChargeDate,
                  };
                });
              }}
              className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Every 3 months</option>
              <option value="semiannual">Every 6 months</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom (every X months)</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
            Next charge date
            <input
              type="text"
              inputMode="numeric"
              placeholder="DD/MM/YYYY"
              value={dateFieldValue}
              onChange={(event) => {
                setIsDateManuallyEdited(true);
                const nextDisplayValue = event.target.value;
                setDateFieldValue(nextDisplayValue);

                const isoDate = parseDisplayDateToIso(nextDisplayValue);
                setFormField("nextChargeDate", isoDate ?? "");
              }}
              maxLength={10}
              className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
            />
          </label>
          {form.cadenceType === "custom" && (
            <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
              Custom cadence (months)
              <input
                type="number"
                min={1}
                value={form.customMonths}
                onChange={(event) => {
                  const customMonths = event.target.value;
                  setForm((prev) => {
                    const nextChargeDate =
                      !editingId &&
                      !isDateManuallyEdited &&
                      prev.cadenceType === "custom"
                        ? computeDefaultNextChargeDate("custom", customMonths)
                        : prev.nextChargeDate;

                    if (
                      !editingId &&
                      !isDateManuallyEdited &&
                      prev.cadenceType === "custom"
                    ) {
                      setDateFieldValue(formatDate(nextChargeDate));
                    }

                    return {
                      ...prev,
                      customMonths,
                      nextChargeDate,
                    };
                  });
                }}
                className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
              />
            </label>
          )}
          <div className="ui-card flex items-center justify-between rounded-xl px-4 py-3 sm:col-span-2">
            <span className="text-sm text-[var(--ui-text-muted)]">
              Charge date reminders
            </span>
            <Toggle
              checked={form.remindCancel}
              onChange={(value) => setFormField("remindCancel", value)}
              label="Charge date reminders"
            />
          </div>
          <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
            Cancel URL (optional)
            <input
              type="url"
              value={form.cancelUrl}
              onChange={(event) => setFormField("cancelUrl", event.target.value)}
              placeholder="https://..."
              className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)] sm:col-span-2">
            Notes (optional)
            <textarea
              value={form.notes}
              onChange={(event) => setFormField("notes", event.target.value)}
              rows={3}
              className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
            />
          </label>
          {saveError && (
            <p className="sm:col-span-2 text-sm text-red-200">{saveError}</p>
          )}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full rounded-full border border-white/20 bg-white/10 py-2.5 text-sm font-medium text-[var(--ui-text)] transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </ModalSheet>
    </>
  );
}

type FxRatesModalProps = {
  open: boolean;
  onClose: () => void;
  fxRates: FxRate[];
  onUpsertFxRate: (payload: { currency: string; rateToEur: number }) => Promise<void>;
  onDeleteFxRate: (currency: string) => Promise<void>;
};

function FxRatesModal({
  open,
  onClose,
  fxRates,
  onUpsertFxRate,
  onDeleteFxRate,
}: FxRatesModalProps) {
  const [fxForm, setFxForm] = useState<FxForm>(emptyFxForm);
  const [editingFxCurrency, setEditingFxCurrency] = useState<string | null>(null);
  const [fxSaveError, setFxSaveError] = useState<string | null>(null);
  const [fxActionError, setFxActionError] = useState<string | null>(null);
  const [isSavingFx, setIsSavingFx] = useState(false);
  const [deletingFxCurrency, setDeletingFxCurrency] = useState<string | null>(null);

  function startFxEdit(rate: FxRate) {
    setEditingFxCurrency(rate.currency);
    setFxForm({
      currency: rate.currency,
      rateToEur: String(rate.rateToEur),
    });
    setFxSaveError(null);
    setFxActionError(null);
  }

  function resetFxForm() {
    setEditingFxCurrency(null);
    setFxForm(emptyFxForm);
    setFxSaveError(null);
  }

  async function saveFxRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currency = (editingFxCurrency ?? fxForm.currency).trim().toUpperCase();
    const rateToEur = Number(fxForm.rateToEur);

    if (!currency) {
      setFxSaveError("Currency is required.");
      return;
    }
    if (!Number.isFinite(rateToEur) || rateToEur <= 0) {
      setFxSaveError("Rate to EUR must be a positive number.");
      return;
    }

    setIsSavingFx(true);
    setFxSaveError(null);
    setFxActionError(null);
    try {
      await onUpsertFxRate({ currency, rateToEur });
      setFxForm(emptyFxForm);
      setEditingFxCurrency(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FX rate save failed.";
      setFxSaveError(message);
    } finally {
      setIsSavingFx(false);
    }
  }

  async function deleteFxRate(currency: string) {
    setDeletingFxCurrency(currency);
    setFxActionError(null);
    setFxSaveError(null);
    try {
      await onDeleteFxRate(currency);
      if (editingFxCurrency === currency) {
        resetFxForm();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "FX rate delete failed.";
      setFxActionError(message);
    } finally {
      setDeletingFxCurrency(null);
    }
  }

  return (
    <ModalSheet open={open} onClose={onClose} title="FX Rates">
      <div className="space-y-5">
        <div className="ui-card rounded-xl p-4">
          <h3 className="text-sm font-medium text-[var(--ui-text)]">Current rates</h3>
          <p className="mt-1 text-xs ui-muted">
            All rates are manual and represent 1 unit of currency to EUR.
          </p>
          <div className="mt-3 space-y-2">
            {fxRates.length === 0 && (
              <p className="text-sm ui-muted">No FX rates yet.</p>
            )}
            {sortFxRates(fxRates).map((rate) => (
              <div
                key={rate.currency}
                className="ui-card flex items-center justify-between rounded-xl px-3 py-2 text-sm"
              >
                <div>
                  <span className="text-[var(--ui-text)]">{rate.currency}</span>
                  <p className="ui-muted">
                    1 {rate.currency} = {formatPrimaryEur(rate.rateToEur)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startFxEdit(rate)}
                    disabled={isSavingFx || deletingFxCurrency === rate.currency}
                    className="rounded-full border border-[var(--ui-border)] px-2.5 py-1 text-xs text-[var(--ui-text-muted)] transition hover:border-white/35 hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void deleteFxRate(rate.currency);
                    }}
                    disabled={isSavingFx || deletingFxCurrency === rate.currency}
                    className="rounded-full border border-red-300/25 px-2.5 py-1 text-xs text-red-200/80 transition hover:border-red-200/45 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingFxCurrency === rate.currency ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveFxRate}>
          {editingFxCurrency && (
            <div className="ui-card flex items-center justify-between rounded-xl px-4 py-3 text-sm sm:col-span-2">
              <p className="text-[var(--ui-text-muted)]">
                Editing <span className="text-[var(--ui-text)]">{editingFxCurrency}</span>
              </p>
              <button
                type="button"
                onClick={resetFxForm}
                className="rounded-full border border-[var(--ui-border)] px-3 py-1 text-xs text-[var(--ui-text-muted)] transition hover:border-white/35 hover:text-[var(--ui-text)]"
              >
                Cancel edit
              </button>
            </div>
          )}
          <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
            Currency
            <input
              type="text"
              placeholder="e.g. BRL"
              value={fxForm.currency}
              onChange={(event) =>
                setFxForm((prev) => ({ ...prev, currency: event.target.value }))
              }
              disabled={Boolean(editingFxCurrency)}
              className="ui-input rounded-xl px-3 py-2.5 uppercase focus:border-white/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
            Rate to EUR
            <input
              type="number"
              min="0.000001"
              step="0.000001"
              placeholder="e.g. 0.180000"
              value={fxForm.rateToEur}
              onChange={(event) =>
                setFxForm((prev) => ({ ...prev, rateToEur: event.target.value }))
              }
              className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
            />
          </label>
          {fxActionError && (
            <p className="sm:col-span-2 text-sm text-red-200">{fxActionError}</p>
          )}
          {fxSaveError && <p className="sm:col-span-2 text-sm text-red-200">{fxSaveError}</p>}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={isSavingFx}
              className="w-full rounded-full border border-white/20 bg-white/10 py-2.5 text-sm font-medium text-[var(--ui-text)] transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingFx ? "Saving..." : editingFxCurrency ? "Update rate" : "Save rate"}
            </button>
          </div>
        </form>
      </div>
    </ModalSheet>
  );
}

type NotificationsModalProps = {
  open: boolean;
  onClose: () => void;
  initialValues: NotificationsForm;
  onSave: (payload: NotificationsForm) => Promise<void>;
  onTestNotification: (payload: NotificationsForm) => Promise<string>;
  onRunReminderCheckNow: () => Promise<ReminderRunResult>;
  isDevMode: boolean;
};

function NotificationsModal({
  open,
  onClose,
  initialValues,
  onSave,
  onTestNotification,
  onRunReminderCheckNow,
  isDevMode,
}: NotificationsModalProps) {
  const [form, setForm] = useState<NotificationsForm>(initialValues);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingNotification, setIsTestingNotification] = useState(false);
  const [isRunningReminderCheck, setIsRunningReminderCheck] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initialValues);
    setSaveError(null);
    setFeedback(null);
    setFeedbackError(null);
  }, [initialValues, open]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setSaveError(null);

    try {
      await onSave({
        ntfyUrl: form.ntfyUrl.trim(),
        topic: form.topic.trim(),
        token: form.token.trim(),
      });
      setFeedback("Notification settings saved.");
      setFeedbackError(null);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed.";
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function runTestNotification() {
    setIsTestingNotification(true);
    setFeedback(null);
    setFeedbackError(null);
    try {
      const message = await onTestNotification({
        ntfyUrl: form.ntfyUrl.trim(),
        topic: form.topic.trim(),
        token: form.token.trim(),
      });
      setFeedback(message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Test notification failed.";
      setFeedbackError(message);
    } finally {
      setIsTestingNotification(false);
    }
  }

  async function runReminderCheckNow() {
    setIsRunningReminderCheck(true);
    setFeedback(null);
    setFeedbackError(null);
    try {
      const result = await onRunReminderCheckNow();
      const warningSuffix =
        result.warnings.length > 0 ? ` Warnings: ${result.warnings[0]}` : "";
      setFeedback(
        `Reminder check complete: sent ${result.sentCount}, skipped ${result.skippedCount}, failed ${result.failedCount}.${warningSuffix}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Reminder check failed.";
      setFeedbackError(message);
    } finally {
      setIsRunningReminderCheck(false);
    }
  }

  return (
    <ModalSheet open={open} onClose={onClose} title="Notifications">
      <form className="grid gap-4 pb-2" onSubmit={saveSettings}>
        <p className="text-sm ui-muted">
          Choose where charge reminders are sent.
        </p>
        <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
          ntfy URL
          <input
            type="text"
            value={form.ntfyUrl}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, ntfyUrl: event.target.value }))
            }
            placeholder="https://ntfy.sh or https://ntfy.example.com/topic"
            className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
          Topic (optional)
          <input
            type="text"
            value={form.topic}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, topic: event.target.value }))
            }
            placeholder="quifin-reminders"
            className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
          Authorization Bearer token (optional)
          <input
            type="password"
            value={form.token}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, token: event.target.value }))
            }
            placeholder="token"
            className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runTestNotification()}
            disabled={isTestingNotification || isSaving || isRunningReminderCheck}
            className="rounded-full border border-[var(--ui-border)] px-4 py-2 text-sm text-[var(--ui-text-muted)] transition hover:border-white/35 hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isTestingNotification ? "Sending..." : "Test notification"}
          </button>
          {isDevMode && (
            <button
              type="button"
              onClick={() => void runReminderCheckNow()}
              disabled={isTestingNotification || isSaving || isRunningReminderCheck}
              className="rounded-full border border-[var(--ui-border)] px-4 py-2 text-sm text-[var(--ui-text-muted)] transition hover:border-white/35 hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRunningReminderCheck ? "Running..." : "Check reminders now"}
            </button>
          )}
        </div>
        {feedback && <p className="text-sm text-emerald-200">{feedback}</p>}
        {feedbackError && <p className="text-sm text-red-200">{feedbackError}</p>}
        {saveError && <p className="text-sm text-red-200">{saveError}</p>}
        <button
          type="submit"
          disabled={isSaving}
          className="w-full rounded-full border border-white/20 bg-white/10 py-2.5 text-sm font-medium text-[var(--ui-text)] transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </form>
    </ModalSheet>
  );
}

type PartnersTabProps = {
  values: PartnerInputs;
  onChange: (next: PartnerInputs) => void;
};

function PartnersTab({ values, onChange }: PartnersTabProps) {
  const totalIncome = values.incomeA + values.incomeB;
  const ratio = totalIncome > 0 ? values.sharedBills / totalIncome : 0;
  const paysA =
    values.sharedBills * (totalIncome > 0 ? values.incomeA / totalIncome : 0);
  const paysB =
    values.sharedBills * (totalIncome > 0 ? values.incomeB / totalIncome : 0);

  return (
    <section className="ui-panel rounded-3xl p-5 sm:p-8">
      <h2 className="text-2xl font-semibold tracking-tight text-[var(--ui-text)]">
        Partners fairness calculator
      </h2>
      <p className="mt-2 text-sm ui-muted">
        Split shared bills fairly based on each partner income.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
          Partner A net monthly income
          <input
            type="number"
            min={0}
            value={values.incomeA}
            onChange={(event) => {
              const incomeA = Number(event.target.value);
              onChange({
                ...values,
                incomeA: Number.isFinite(incomeA) ? incomeA : 0,
              });
            }}
            className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
          Partner B net monthly income
          <input
            type="number"
            min={0}
            value={values.incomeB}
            onChange={(event) => {
              const incomeB = Number(event.target.value);
              onChange({
                ...values,
                incomeB: Number.isFinite(incomeB) ? incomeB : 0,
              });
            }}
            className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-[var(--ui-text-muted)]">
          Monthly shared bills total
          <input
            type="number"
            min={0}
            value={values.sharedBills}
            onChange={(event) => {
              const sharedBills = Number(event.target.value);
              onChange({
                ...values,
                sharedBills: Number.isFinite(sharedBills) ? sharedBills : 0,
              });
            }}
            className="ui-input rounded-xl px-3 py-2.5 focus:border-white/30 focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ResultCard label="Partner A pays" value={formatPrimaryEur(paysA)} />
        <ResultCard label="Partner B pays" value={formatPrimaryEur(paysB)} />
        <ResultCard
          label="Contribution rate"
          value={`${(ratio * 100).toFixed(1)}% each`}
        />
        <ResultCard
          label="Remaining incomes"
          value={`${formatPrimaryEur(values.incomeA - paysA)} / ${formatPrimaryEur(
            values.incomeB - paysB,
          )}`}
        />
      </div>
    </section>
  );
}

function ResultCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="ui-card rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide ui-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--ui-text)]">{value}</p>
    </div>
  );
}

/**
 * Renders the full QuiFin interface with tabs, modals, and data wiring.
 * It loads data once, then keeps local UI state in sync with API updates.
 */
export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabKey>("subscriptions");
  const [partnerInputs, setPartnerInputs] =
    useState<PartnerInputs>(defaultPartnerInputs);
  const [partnersHydrated, setPartnersHydrated] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [fxRates, setFxRates] = useState<FxRate[]>([]);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [fxModalOpen, setFxModalOpen] = useState(false);
  const [notificationsModalOpen, setNotificationsModalOpen] = useState(false);
  const partnerSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPartnerInputsRef = useRef<string | null>(null);
  const isDevMode = process.env.NODE_ENV !== "production";

  const notificationSettings = useMemo(
    () => toNotificationsForm(settings),
    [settings],
  );

  async function refreshData() {
    setDataError(null);
    setIsLoadingData(true);
    try {
      const [subscriptionsPayload, fxPayload, settingsPayload] = await Promise.all([
        requestJson<SubscriptionsResponse>("/api/subscriptions", { cache: "no-store" }),
        requestJson<FxRatesResponse>("/api/fx-rates", { cache: "no-store" }),
        requestJson<SettingsResponse>("/api/settings", { cache: "no-store" }),
      ]);

      setSubscriptions(sortSubscriptions(subscriptionsPayload.subscriptions));
      setFxRates(sortFxRates(fxPayload.rates));
      setSettings(settingsPayload.settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load data.";
      setDataError(message);
    } finally {
      setIsLoadingData(false);
    }
  }

  useEffect(() => {
    void refreshData();
  }, []);

  useEffect(() => {
    if (partnersHydrated || isLoadingData) return;

    // Hydrate partner inputs once from settings after initial data load.
    const nextPartnerInputs: PartnerInputs = {
      incomeA: parsePartnerInputValue(
        settings[PARTNERS_INCOME_A_KEY],
        defaultPartnerInputs.incomeA,
      ),
      incomeB: parsePartnerInputValue(
        settings[PARTNERS_INCOME_B_KEY],
        defaultPartnerInputs.incomeB,
      ),
      sharedBills: parsePartnerInputValue(
        settings[PARTNERS_SHARED_BILLS_KEY],
        defaultPartnerInputs.sharedBills,
      ),
    };

    lastSavedPartnerInputsRef.current = serializePartnerInputs(nextPartnerInputs);
    setPartnerInputs(nextPartnerInputs);
    setPartnersHydrated(true);
  }, [isLoadingData, partnersHydrated, settings]);

  useEffect(() => {
    if (!partnersHydrated) return;

    // Debounce writes so typing does not hit SQLite on every keystroke.
    const serializedInputs = serializePartnerInputs(partnerInputs);
    if (lastSavedPartnerInputsRef.current === serializedInputs) return;

    if (partnerSaveTimeoutRef.current) {
      clearTimeout(partnerSaveTimeoutRef.current);
      partnerSaveTimeoutRef.current = null;
    }

    partnerSaveTimeoutRef.current = setTimeout(() => {
      void (async () => {
        try {
          await savePartnerSettings(partnerInputs);
          lastSavedPartnerInputsRef.current = serializedInputs;
        } catch {
          // Ignore autosave errors; input values remain in local state.
        }
      })();
    }, PARTNER_SETTINGS_DEBOUNCE_MS);

    return () => {
      if (!partnerSaveTimeoutRef.current) return;
      clearTimeout(partnerSaveTimeoutRef.current);
      partnerSaveTimeoutRef.current = null;
    };
  }, [partnerInputs, partnersHydrated]);

  async function createSubscription(payload: SubscriptionWritePayload) {
    const created = await requestJson<SubscriptionResponse>("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSubscriptions((prev) => sortSubscriptions([...prev, created.subscription]));
  }

  async function updateSubscription(
    id: string,
    payload: Partial<SubscriptionWritePayload>,
  ) {
    const updated = await requestJson<SubscriptionResponse>(
      `/api/subscriptions/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    setSubscriptions((prev) =>
      sortSubscriptions(
        prev.map((item) => (item.id === id ? updated.subscription : item)),
      ),
    );
  }

  async function deleteSubscription(id: string) {
    const response = await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    setSubscriptions((prev) => prev.filter((item) => item.id !== id));
  }

  async function upsertFxRate(payload: { currency: string; rateToEur: number }) {
    const saved = await requestJson<FxRateResponse>("/api/fx-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setFxRates((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.currency === saved.rate.currency,
      );
      if (existingIndex === -1) return sortFxRates([...prev, saved.rate]);

      const updated = [...prev];
      updated[existingIndex] = saved.rate;
      return sortFxRates(updated);
    });
  }

  async function deleteFxRate(currency: string) {
    const response = await fetch(`/api/fx-rates/${encodeURIComponent(currency)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    setFxRates((prev) => prev.filter((item) => item.currency !== currency));
  }

  async function saveNotificationSettings(payload: NotificationsForm) {
    const saved = await requestJson<SettingsResponse>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [NTFY_URL_KEY]: payload.ntfyUrl,
          [NTFY_TOPIC_KEY]: payload.topic,
          [NTFY_BEARER_TOKEN_KEY]: payload.token,
        },
      }),
    });

    setSettings(saved.settings);
  }

  async function savePartnerSettings(payload: PartnerInputs) {
    await requestJson<SettingsResponse>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [PARTNERS_INCOME_A_KEY]: String(payload.incomeA),
          [PARTNERS_INCOME_B_KEY]: String(payload.incomeB),
          [PARTNERS_SHARED_BILLS_KEY]: String(payload.sharedBills),
        },
      }),
    });
  }

  async function testNotification(payload: NotificationsForm) {
    const response = await requestJson<TestNotificationResponse>(
      "/api/notifications/test",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ntfyUrl: payload.ntfyUrl,
          ntfyTopic: payload.topic,
          ntfyBearerToken: payload.token,
        }),
      },
    );

    return response.message;
  }

  async function runReminderCheckNow() {
    const response = await requestJson<ReminderRunResponse>("/api/reminders/run", {
      method: "POST",
    });

    return response.result;
  }

  return (
    <main className="ui-app-bg min-h-screen px-4 py-8 sm:px-8">
      <div className="ui-frame mx-auto w-full max-w-6xl rounded-[2rem] px-4 py-5 sm:px-7 sm:py-8">
        <header className="mb-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative h-24 w-[300px] flex-none overflow-hidden sm:h-28 sm:w-[360px] md:h-32 md:w-[420px]">
              <Image
                src="/logo-gray.png"
                alt="QuiFin"
                fill
                className="object-cover object-center"
                priority
              />
            </div>
            <p className="text-sm ui-muted sm:text-right">
              quifin v1.0.0
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav>
              <div className="ui-card relative inline-flex rounded-full p-1">
                <div
                  className={`absolute bottom-1 top-1 rounded-full bg-white/16 transition-all duration-300 ${
                    activeTab === "subscriptions"
                      ? "left-1 w-[132px]"
                      : "left-[133px] w-[95px]"
                  }`}
                />
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative z-10 rounded-full px-5 py-2 text-sm transition-colors ${
                      activeTab === tab.key
                        ? "text-[var(--ui-text)]"
                        : "text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </nav>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFxModalOpen(true)}
                className="rounded-full border border-transparent px-3 py-1.5 text-sm text-[var(--ui-text-muted)] transition hover:border-[var(--ui-border)] hover:text-[var(--ui-text)] focus-visible:border-[var(--ui-border)] focus-visible:outline-none focus-visible:text-[var(--ui-text)]"
              >
                FX Rates
              </button>
              <button
                type="button"
                onClick={() => setNotificationsModalOpen(true)}
                className="rounded-full border border-transparent px-3 py-1.5 text-sm text-[var(--ui-text-muted)] transition hover:border-[var(--ui-border)] hover:text-[var(--ui-text)] focus-visible:border-[var(--ui-border)] focus-visible:outline-none focus-visible:text-[var(--ui-text)]"
              >
                Notifications
              </button>
            </div>
          </div>
        </header>

        <div className="transition-all duration-300">
          {activeTab === "subscriptions" ? (
            <SubscriptionsTab
              subscriptions={subscriptions}
              fxRates={fxRates}
              isLoading={isLoadingData}
              error={dataError}
              onRefresh={refreshData}
              onCreateSubscription={createSubscription}
              onUpdateSubscription={updateSubscription}
              onDeleteSubscription={deleteSubscription}
            />
          ) : (
            <PartnersTab values={partnerInputs} onChange={setPartnerInputs} />
          )}
        </div>
      </div>

      <FxRatesModal
        open={fxModalOpen}
        onClose={() => setFxModalOpen(false)}
        fxRates={fxRates}
        onUpsertFxRate={upsertFxRate}
        onDeleteFxRate={deleteFxRate}
      />

      <NotificationsModal
        open={notificationsModalOpen}
        onClose={() => setNotificationsModalOpen(false)}
        initialValues={notificationSettings}
        onSave={saveNotificationSettings}
        onTestNotification={testNotification}
        onRunReminderCheckNow={runReminderCheckNow}
        isDevMode={isDevMode}
      />
    </main>
  );
}
