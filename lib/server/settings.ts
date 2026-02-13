// Validates and normalizes settings data from API and DB.
export type SettingRow = {
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
};

const settingKeyPattern = /^[a-z0-9_]{1,64}$/;

/**
 * Normalizes a setting key to lower-case safe format.
 * Returns null when the key is not allowed.
 */
export function normalizeSettingKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return settingKeyPattern.test(normalized) ? normalized : null;
}

/**
 * Converts DB rows into a key/value object for API responses.
 * Known keys are normalized to keep a stable format.
 */
export function mapSettingsRows(rows: SettingRow[]) {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const key = normalizeSettingKey(row.key) ?? row.key;
    acc[key] = row.value;
    return acc;
  }, {});
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses bulk settings updates.
 * Empty string values become null so callers can delete keys.
 */
export function parseSettingsPutPayload(payload: unknown) {
  if (!isPlainObject(payload)) {
    return { settings: null, error: "Invalid payload format." };
  }

  const record =
    "settings" in payload && isPlainObject(payload.settings)
      ? payload.settings
      : payload;

  const entries: Array<{ key: string; value: string | null }> = [];

  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = normalizeSettingKey(rawKey);
    if (!key) {
      return { settings: null, error: `Invalid setting key: ${rawKey}` };
    }

    if (rawValue === null || rawValue === undefined) {
      entries.push({ key, value: null });
      continue;
    }

    if (typeof rawValue !== "string") {
      return { settings: null, error: `Setting ${key} must be a string or null.` };
    }

    const value = rawValue.trim();
    entries.push({ key, value: value.length > 0 ? value : null });
  }

  return { settings: entries, error: null };
}

/**
 * Parses the single-setting payload used by /api/settings/[key].
 * It requires a non-empty string value.
 */
export function parseSettingValuePayload(payload: unknown) {
  if (!isPlainObject(payload)) {
    return { value: null, error: "Invalid payload format." };
  }

  if (!("value" in payload)) {
    return { value: null, error: "value is required." };
  }

  if (payload.value === null) {
    return { value: null, error: "value must be a non-empty string." };
  }

  if (typeof payload.value !== "string") {
    return { value: null, error: "value must be a string." };
  }

  const value = payload.value.trim();
  if (!value) {
    return { value: null, error: "value must be a non-empty string." };
  }

  return { value, error: null };
}
