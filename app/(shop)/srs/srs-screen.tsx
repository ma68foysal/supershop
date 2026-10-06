"use client";

import { useActionState, useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { deleteSr, saveSr } from "@/app/actions";
import { Spinner, useReportBusy } from "@/components/busy";
import ConfirmDialog from "@/components/confirm-dialog";
import { useI18n } from "@/components/i18n";
import Sheet from "@/components/sheet";
import { useToast } from "@/components/toast";
import { telHref, toAsciiDigits, waHref, WEEK_ORDER } from "@/lib/format";
import type { Sr } from "@/lib/types";

export type SrStats = { products: number; low: number };

export default function SrsScreen({
  srs,
  stats,
  today,
  canEdit,
}: {
  srs: Sr[];
  stats: Record<string, SrStats>;
  today: number;
  canEdit: boolean;
}) {
  const { t, f } = useI18n();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Sr | "new" | null>(null);
  const companies = useMemo(
    () => [...new Set(srs.map((s) => s.company).filter(Boolean) as string[])].sort(),
    [srs],
  );

  const s = toAsciiDigits(q.trim().toLowerCase());
  const list = srs.filter(
    (r) => !s || [r.name, r.company, toAsciiDigits(r.phone)].some((v) => v?.toLowerCase().includes(s)),
  );
  const comingToday = s ? [] : srs.filter((r) => r.visit_days.includes(today));

  const row = (r: Sr) => (
    <SrRow
      key={r.id}
      sr={r}
      stats={stats[r.id]}
      today={today}
      canEdit={canEdit}
      onEdit={() => setEditing(r)}
    />
  );

  return (
    <main className="main">
      <h2 className="h2">{t.srsTitle}</h2>
      <p className="sub">{t.srsSub}</p>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input
          className="search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.searchSrs}
          aria-label={t.searchSrs}
        />
        {canEdit && (
          <button className="btn-small" onClick={() => setEditing("new")}>
            {t.addSr}
          </button>
        )}
      </div>

      {comingToday.length > 0 && (
        <>
          <div className="section-head">
            <h3>{t.comingToday}</h3>
          </div>
          <ul className="rows sr-today">{comingToday.map(row)}</ul>
        </>
      )}

      <div className="section-head">
        <h3>{t.allSrs}</h3>
        <span className="sub">{srs.length ? t.srCount(f.num(srs.length)) : ""}</span>
      </div>
      <ul className="rows">
        {list.map(row)}
        {!list.length && (
          <li className="row">
            <div className="row-main">
              <div className="row-name">{srs.length ? t.nothingMatches(q) : t.noSrs}</div>
              <div className="row-meta">{canEdit ? t.noSrsHintOwner : t.noSrsHintStaff}</div>
            </div>
          </li>
        )}
      </ul>

      {editing && (
        <SrForm sr={editing === "new" ? null : editing} companies={companies} onClose={() => setEditing(null)} />
      )}
    </main>
  );
}

function SrRow({
  sr,
  stats,
  today,
  canEdit,
  onEdit,
}: {
  sr: Sr;
  stats?: SrStats;
  today: number;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { t, f } = useI18n();
  const days = WEEK_ORDER.filter((d) => sr.visit_days.includes(d)).map((d) => t.weekdays[d]);
  return (
    <li className="sr-row">
      <button className="sr-main" onClick={onEdit} disabled={!canEdit}>
        <span className="sr-avatar" aria-hidden="true">
          {(sr.company || sr.name).trim().charAt(0).toUpperCase()}
        </span>
        <span className="row-main">
          <span className="row-name">
            {sr.name}
            {sr.company && <span className="tag">{sr.company}</span>}
            {sr.visit_days.includes(today) && <span className="tag today">{t.visitsToday}</span>}
          </span>
          <span className="row-meta">
            <span className="num" style={{ fontSize: 15, color: "var(--ink-2)" }}>
              {f.digits(sr.phone)}
            </span>
            {days.length > 0 && <>, {days.join(", ")}</>}
          </span>
          {(stats || sr.note) && (
            <span className="row-meta">
              {stats && t.srProducts(f.num(stats.products))}
              {stats && stats.low > 0 && (
                <>
                  , <span className="low">{t.runningLow(f.num(stats.low))}</span>
                </>
              )}
              {stats && sr.note ? ", " : ""}
              {sr.note}
            </span>
          )}
        </span>
      </button>
      <a className="round-btn call" href={telHref(sr.phone)} aria-label={t.callName(sr.name)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
        </svg>
      </a>
      <a
        className="round-btn wa"
        href={waHref(sr.phone)}
        target="_blank"
        rel="noopener"
        aria-label={t.whatsappName(sr.name)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z" />
          <path d="M9 9.5c.3 2 2.2 4.2 4.5 4.8l1-1.3 2 .9-.4 1.6c-3.5.4-7.6-3.5-7.6-7l1.6-.4.9 2z" />
        </svg>
      </a>
    </li>
  );
}

/* Contact Picker exists on Android Chrome only */
const noSubscribe = () => () => {};
const contactsSupported = () => "contacts" in navigator && "ContactsManager" in window;
type ContactsApi = { select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[] }[]> };

function SrForm({ sr, companies, onClose }: { sr: Sr | null; companies: string[]; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [state, action, pending] = useActionState(saveSr, {});
  useReportBusy(pending);
  const [name, setName] = useState(sr?.name ?? "");
  const [phone, setPhone] = useState(sr?.phone ?? "");
  const canPick = useSyncExternalStore(noSubscribe, contactsSupported, () => false);

  const [asking, setAsking] = useState(false);
  const stopAsking = useCallback(() => setAsking(false), []);
  const [deleting, startDelete] = useTransition();
  useReportBusy(deleting);

  useEffect(() => {
    if (state.message) {
      toast(state.message);
      onClose();
    }
  }, [state, toast, onClose]);

  async function pick() {
    try {
      const [c] = await (navigator as unknown as { contacts: ContactsApi }).contacts.select(["name", "tel"], {
        multiple: false,
      });
      if (!c) return;
      if (c.name?.[0] && !name) setName(c.name[0]);
      if (c.tel?.[0]) setPhone(c.tel[0]);
    } catch {
      // The person closed the contact list
    }
  }

  const remove = () =>
    startDelete(async () => {
      const r = await deleteSr(sr!.id, sr!.name);
      if (r.error) return toast(r.error, true);
      toast(r.message ?? "");
      setAsking(false);
      onClose();
    });

  return (
    <Sheet title={sr ? t.editSr : t.addSr} onClose={onClose}>
      <form action={action}>
        {sr && <input type="hidden" name="id" value={sr.id} />}
        {canPick && (
          <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={pick}>
            {t.pickContact}
          </button>
        )}
        <label className="field">
          <span>{t.srName}</span>
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.srNamePh} required />
        </label>
        <label className="field">
          <span>{t.srPhone}</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t.srPhonePh}
            required
          />
        </label>
        <label className="field">
          <span>{t.company}</span>
          <input name="company" list="companies" defaultValue={sr?.company ?? ""} placeholder={t.companyPh} />
          <datalist id="companies">
            {companies.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          <legend style={{ fontSize: 14, color: "var(--ink-2)", marginBottom: 6 }}>{t.visitDays}</legend>
          <div className="chips">
            {WEEK_ORDER.map((d) => (
              <label key={d} className="chip day-chip">
                <input type="checkbox" name="visit_days" value={d} defaultChecked={sr?.visit_days.includes(d)} />
                {t.weekdays[d]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>{t.note}</span>
          <input name="note" defaultValue={sr?.note ?? ""} placeholder={t.srNotePh} />
        </label>
        {state.error && <p className="error">{state.error}</p>}
        <button className="primary" disabled={pending}>
          {pending ? (
            <>
              <Spinner />
              {t.saving}
            </>
          ) : (
            t.saveSr
          )}
        </button>
        {sr && (
          <button type="button" className="secondary danger-outline" onClick={() => setAsking(true)}>
            {t.deleteSr}
          </button>
        )}
      </form>
      {asking && sr && (
        <ConfirmDialog
          tone="danger"
          title={t.deleteSrTitle}
          body={t.deleteSrBody}
          subject={{ label: sr.company ? `${sr.name}, ${sr.company}` : sr.name }}
          confirmLabel={t.yesDelete}
          pendingLabel={t.deleting}
          pending={deleting}
          onConfirm={remove}
          onCancel={stopAsking}
        />
      )}
    </Sheet>
  );
}
