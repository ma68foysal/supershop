"use client";

import { useState, useTransition } from "react";
import { voidSale } from "@/app/actions";
import { Spinner, useReportBusy } from "@/components/busy";
import { useToast } from "@/components/toast";

export default function VoidSale({ saleId, receiptNo }: { saleId: string; receiptNo: number }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  useReportBusy(pending);
  const toast = useToast();

  if (!asking)
    return (
      <button className="mini" style={{ marginTop: 8 }} onClick={() => setAsking(true)}>
        Void sale #{receiptNo}
      </button>
    );

  return (
    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
      <input
        className="input"
        style={{ padding: "8px 12px" }}
        placeholder="Reason, e.g. entered twice"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Reason for voiding"
        autoFocus
      />
      <button
        className="btn-small"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await voidSale(saleId, reason);
            toast(r.error ?? r.message ?? "Sale voided", Boolean(r.error));
          })
        }
      >
        {pending ? (
          <>
            <Spinner />
            Voiding…
          </>
        ) : (
          "Void"
        )}
      </button>
    </div>
  );
}
