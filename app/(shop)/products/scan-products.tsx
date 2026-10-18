"use client";

import { useMemo, useState, useTransition } from "react";
import { addProducts } from "@/app/actions";
import type { ScannedProduct } from "@/lib/assistant/scan";
import { Spinner, useReportBusy } from "@/components/busy";
import { useI18n } from "@/components/i18n";
import Sheet from "@/components/sheet";
import { useToast } from "@/components/toast";
import { photoFrames, videoFrames } from "@/lib/frames";
import { toAsciiDigits } from "@/lib/format";
import { normalize } from "@/lib/search";
import { UNITS, type Product, type Unit } from "@/lib/types";

const PER_REQUEST = 12;

type Row = {
  key: string;
  checked: boolean;
  exists: boolean;
  name: string;
  name_bn: string;
  category: string;
  unit: Unit;
  price: string;
  unsure: boolean;
};

/** Same product as one already in the shop? Compares spelling-insensitive names. */
function alreadyIn(existing: Product[], p: { name: string; name_bn: string }) {
  const a = normalize(p.name);
  const b = p.name_bn ? normalize(p.name_bn) : "";
  return existing.some((e) => {
    const en = normalize(e.name);
    const bn = e.name_bn ? normalize(e.name_bn) : "";
    return en === a || (b && (bn === b || en === b)) || (a.length >= 5 && en.length >= 5 && (en.includes(a) || a.includes(en)));
  });
}

/** Shelf video or photos → the AI lists the products → check them → add all at once. */
export default function ScanProducts({ existing, onClose }: { existing: Product[]; onClose: () => void }) {
  const { t, f } = useI18n();
  const toast = useToast();
  const [phase, setPhase] = useState<"pick" | "reading" | "review">("pick");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, startSaving] = useTransition();
  useReportBusy(phase === "reading" || saving);

  async function read(frames: string[]) {
    const found = new Map<string, ScannedProduct>();
    const batches = Math.ceil(frames.length / PER_REQUEST);
    for (let i = 0; i < batches; i++) {
      setProgress(t.scanReading(f.num(i + 1), f.num(batches)));
      const res = await fetch("/api/products/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images: frames.slice(i * PER_REQUEST, (i + 1) * PER_REQUEST) }),
      });
      const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
      if (!res.ok || !data) throw new Error(data?.error ?? t.aiFailed);
      // The same product seen in several batches is kept once; a price found later fills a gap
      for (const p of data.products as ScannedProduct[]) {
        const key = normalize(p.name);
        const seen = found.get(key);
        if (!seen) found.set(key, p);
        else if (seen.price === null && p.price !== null) seen.price = p.price;
      }
    }
    return [...found.values()];
  }

  async function start(files: FileList | null, kind: "video" | "photos") {
    if (!files?.length) return;
    setError(null);
    setPhase("reading");
    try {
      setProgress(t.scanPreparing);
      const frames =
        kind === "video"
          ? await videoFrames(files[0], (d, n) => setProgress(t.scanFrames(f.num(d), f.num(n))))
          : await photoFrames([...files]);
      const products = await read(frames);
      if (!products.length) {
        setError(t.scanNone);
        setPhase("pick");
        return;
      }
      setRows(
        products.map((p, i) => {
          const exists = alreadyIn(existing, p);
          return {
            key: `${i}-${p.name}`,
            checked: !exists,
            exists,
            name: p.name,
            name_bn: p.name_bn,
            category: p.category,
            unit: p.unit,
            price: p.price === null ? "" : String(p.price),
            unsure: p.confidence === "low",
          };
        }),
      );
      setPhase("review");
    } catch (e) {
      setError((e as Error).message === "video" ? t.videoFailed : (e as Error).message);
      setPhase("pick");
    }
  }

  const update = (key: string, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const chosen = useMemo(() => rows.filter((r) => r.checked), [rows]);
  const missingPrice = chosen.some((r) => !(Number(r.price) > 0));

  const add = () =>
    startSaving(async () => {
      const r = await addProducts(
        chosen.map((x) => ({
          name: x.name,
          name_bn: x.name_bn || null,
          category: x.category || null,
          unit: x.unit,
          sell_price: Number(x.price),
        })),
      );
      if (r.error) return toast(r.error, true);
      toast(r.message ?? "");
      onClose();
    });

  return (
    <Sheet title={t.scanTitle} onClose={onClose}>
      {phase === "pick" && (
        <>
          <p className="sub">{t.scanIntro}</p>
          <ul className="scan-tips">
            {t.scanTips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
          <label className="primary file-button">
            {t.pickVideo}
            <input type="file" accept="video/*" onChange={(e) => start(e.target.files, "video")} hidden />
          </label>
          <label className="secondary file-button">
            {t.pickPhotos}
            <input type="file" accept="image/*" multiple onChange={(e) => start(e.target.files, "photos")} hidden />
          </label>
          {error && <p className="error">{error}</p>}
        </>
      )}

      {phase === "reading" && (
        <div className="scan-progress" role="status">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {progress}
        </div>
      )}

      {phase === "review" && (
        <>
          <p className="sub">{t.scanFound(f.num(rows.length))}</p>
          <ul className="rows scan-list">
            {rows.map((r) => (
              <li key={r.key} className={"scan-row" + (r.checked ? "" : " off")}>
                <input
                  type="checkbox"
                  checked={r.checked}
                  onChange={(e) => update(r.key, { checked: e.target.checked })}
                  aria-label={r.name}
                />
                <div className="scan-fields">
                  <input
                    className="input"
                    value={r.name_bn}
                    onChange={(e) => update(r.key, { name_bn: e.target.value })}
                    placeholder={t.fNameBn}
                    aria-label={t.fNameBn}
                  />
                  <input
                    className="input small"
                    value={r.name}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    aria-label={t.fName}
                  />
                  <div className="scan-line">
                    <select value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value as Unit })} aria-label={t.fUnit}>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {t.units[u]}
                        </option>
                      ))}
                    </select>
                    <input
                      className={"input price" + (r.checked && !(Number(r.price) > 0) ? " missing" : "")}
                      inputMode="decimal"
                      value={r.price}
                      placeholder={t.fSell}
                      aria-label={t.fSell}
                      onChange={(e) => update(r.key, { price: toAsciiDigits(e.target.value).replace(/[^\d.]/g, "") })}
                    />
                  </div>
                  <div>
                    {r.exists && <span className="tag">{t.alreadyInShop}</span>}
                    {r.unsure && <span className="tag void">{t.unsure}</span>}
                    {r.category && <span className="tag">{r.category}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {chosen.length > 0 && missingPrice && <p className="error">{t.needPrices}</p>}
          <button className="primary" disabled={!chosen.length || missingPrice || saving} onClick={add}>
            {saving ? (
              <>
                <Spinner />
                {t.saving}
              </>
            ) : (
              t.addSelected(f.num(chosen.length))
            )}
          </button>
          <button className="secondary" onClick={() => setPhase("pick")}>
            {t.scanAgain}
          </button>
        </>
      )}
    </Sheet>
  );
}
