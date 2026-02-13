"use client";

// Small reusable on/off switch button.
type ToggleProps = {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
};

/**
 * Displays an accessible switch control.
 * Clicking toggles the current boolean value.
 */
export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full border transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
        checked
          ? "border-white/30 bg-white/30 shadow-[0_0_0_8px_rgba(255,255,255,0.08)]"
          : "border-[var(--ui-border)] bg-[rgba(38,38,38,0.72)]"
      }`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-[#f3f4f6] shadow-sm transition-all duration-300 ease-out ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}
