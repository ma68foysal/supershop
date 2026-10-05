"use client";

import Link from "next/link";
import { useState } from "react";
import { Spinner, useReportBusy } from "@/components/busy";
import { useI18n } from "@/components/i18n";
import { useToast } from "@/components/toast";

export default function ReportActions({
  dayId,
  fileName,
  showDetails,
}: {
  dayId: string;
  fileName: string;
  showDetails?: boolean;
}) {
  const { t } = useI18n();
  const url = `/api/reports/${dayId}/pdf`;
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  useReportBusy(busy !== null);
  const toast = useToast();

  async function getFile() {
    const res = await fetch(url);
    if (!res.ok || res.headers.get("content-type") !== "application/pdf")
      throw new Error(t.pdfFailed);
    return new File([await res.blob()], fileName, { type: "application/pdf" });
  }

  function save(file: File) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  async function run(kind: "download" | "share") {
    setBusy(kind);
    try {
      const file = await getFile();
      if (kind === "download") {
        save(file);
        toast(t.downloaded);
      } else if (navigator.canShare?.({ files: [file] })) {
        // Phone share menu: WhatsApp, Messenger, email…
        await navigator.share({ files: [file], title: fileName });
      } else {
        save(file);
        toast(t.cantShare);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const label = (kind: "download" | "share", text: string) =>
    busy === kind ? (
      <>
        <Spinner />
        {t.preparing}
      </>
    ) : (
      text
    );

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      {showDetails && (
        <Link className="mini" href={`/reports/${dayId}`}>
          {t.details}
        </Link>
      )}
      <a className="mini" href={url} target="_blank" rel="noopener">
        {t.viewPdf}
      </a>
      <button className="mini" onClick={() => run("download")} disabled={busy !== null}>
        {label("download", t.download)}
      </button>
      <button className="mini" onClick={() => run("share")} disabled={busy !== null}>
        {label("share", t.share)}
      </button>
    </div>
  );
}
