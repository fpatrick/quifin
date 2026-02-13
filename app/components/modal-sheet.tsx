"use client";

// Reusable centered modal component with overlay and close behavior.
import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

type ModalSheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Renders a modal in a portal with keyboard and backdrop close support.
 * Body scroll is locked while the modal is open.
 */
export function ModalSheet({ open, title, onClose, children }: ModalSheetProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        open ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      <button
        type="button"
        aria-label={`Close ${title} dialog`}
        onClick={onClose}
        className={`absolute inset-0 appearance-none border-0 bg-black/55 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className="absolute inset-0 flex justify-center overflow-y-auto px-4 sm:px-6"
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`my-auto max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-3xl ui-panel p-6 transition-all duration-300 ${
            open ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-95 opacity-0"
          }`}
        >
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight text-[var(--ui-text)]">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--ui-border)] px-3 py-1.5 text-sm text-[var(--ui-text-muted)] transition hover:border-white/35 hover:text-[var(--ui-text)]"
            >
              Close
            </button>
          </div>
          {children}
        </section>
      </div>
    </div>,
    document.body,
  );
}
