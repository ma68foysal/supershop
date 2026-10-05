"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "./busy";
import { useI18n } from "./i18n";

type Tone = "danger" | "warn";

/**
 * Centered confirmation popup for actions that remove money or records.
 * `subject` shows what is affected as a ledger line, e.g. "Sale #4 — ৳50".
 */
export default function ConfirmDialog({
  tone,
  title,
  body,
  subject,
  confirmLabel,
  pendingLabel,
  pending,
  onConfirm,
  onCancel,
  children,
}: {
  tone: Tone;
  title: string;
  body: string;
  subject?: { label: string; amount?: string };
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Capture phase + stopPropagation: Escape closes only this popup, not a sheet behind it
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!pending) onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    ref.current?.querySelector<HTMLElement>("input, .modal-cancel")?.focus();
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel, pending]);

  return createPortal(
    <div className="modal-wrap" onClick={() => !pending && onCancel()}>
      <div
        className={`modal ${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-icon" aria-hidden="true">
          {tone === "danger" ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
            </svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="m5.6 5.6 12.8 12.8" />
            </svg>
          )}
        </div>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-body">{body}</p>
        {subject && (
          <div className="modal-subject">
            <span>{subject.label}</span>
            {subject.amount && <span className="num">{subject.amount}</span>}
          </div>
        )}
        {children}
        <div className="modal-actions">
          <button className="modal-confirm" disabled={pending} onClick={onConfirm}>
            {pending ? (
              <>
                <Spinner />
                {pendingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </button>
          <button className="modal-cancel" disabled={pending} onClick={onCancel}>
            {t.cancel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
