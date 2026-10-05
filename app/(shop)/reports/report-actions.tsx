"use client";

import { useState } from "react";
import { Spinner, useReportBusy } from "@/components/busy";
import { useToast } from "@/components/toast";

export default function ReportActions({ dayId, fileName }: { dayId: string; fileName: string }) {
  const url = `/api/reports/${dayId}/pdf`;
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  useReportBusy(busy !== null);
  const toast = useToast();

  async function getFile() {
    const res = await fetch(url);
    if (!res.ok || res.headers.get("content-type") !== "application/pdf")
      throw new Error("Could not make the PDF. Check your connection and try again.");
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
        toast("Report downloaded");
      } else if (navigator.canShare?.({ files: [file] })) {
        // Phone share menu: WhatsApp, Messenger, email…
        await navigator.share({ files: [file], title: fileName });
      } else {
        save(file);
        toast("This browser can't share files, so the PDF was downloaded instead");
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
        Preparing…
      </>
    ) : (
      text
    );

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      <a className="mini" href={url} target="_blank" rel="noopener">
        View PDF
      </a>
      <button className="mini" onClick={() => run("download")} disabled={busy !== null}>
        {label("download", "Download")}
      </button>
      <button className="mini" onClick={() => run("share")} disabled={busy !== null}>
        {label("share", "Share")}
      </button>
    </div>
  );
}
