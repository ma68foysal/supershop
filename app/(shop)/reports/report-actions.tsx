"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";

export default function ReportActions({ dayId, fileName }: { dayId: string; fileName: string }) {
  const url = `/api/reports/${dayId}/pdf`;
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Share the PDF file itself (WhatsApp, email…) where the phone supports it, else download it.
  async function share() {
    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Could not make the PDF. Check your connection and try again.");
      const file = new File([await res.blob()], fileName, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
        toast("This browser can't share files, so the PDF was downloaded instead");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      <a className="mini" href={url} target="_blank" rel="noopener">
        View PDF
      </a>
      <a className="mini" href={`${url}?download=1`} download={fileName}>
        Download
      </a>
      <button className="mini" onClick={share} disabled={busy}>
        {busy ? "Preparing…" : "Share"}
      </button>
    </div>
  );
}
