"use client";

import { useState, useTransition } from "react";
import { voidSale } from "@/app/actions";
import { Spinner, useReportBusy } from "@/components/busy";
import { useI18n } from "@/components/i18n";
import { useToast } from "@/components/toast";

export default function VoidSale({ saleId, receiptNo }: { saleId: string; receiptNo: number }) {
  const { t, f } = useI18n();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  useReportBusy(pending);
  const toast = useToast();

  if (!asking)
    return (
      <button className="mini" style={{ marginTop: 8 }} onClick={() => setAsking(true)}>
        {t.voidSale(f.digits(receiptNo))}
      </button>
    );

  return (
    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
      <input
        className="input"
        style={{ padding: "8px 12px" }}
        placeholder={t.voidReasonPh}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label={t.voidReasonAria}
        autoFocus
      />
      <button
        className="btn-small"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await voidSale(saleId, reason);
            toast(r.error ?? r.message ?? t.saleVoided, Boolean(r.error));
          })
        }
      >
        {pending ? (
          <>
            <Spinner />
            {t.voiding}
          </>
        ) : (
          t.voidBtn
        )}
      </button>
    </div>
  );
}
