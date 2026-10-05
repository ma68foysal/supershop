"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addStaff, saveSettings, setStaffActive } from "@/app/actions";
import { Spinner, useReportBusy } from "@/components/busy";
import { useI18n } from "@/components/i18n";
import { useToast } from "@/components/toast";
import type { ActionResult, Settings, Staff } from "@/lib/types";

function useResultToast(state: ActionResult, onOk?: () => void) {
  const toast = useToast();
  useEffect(() => {
    if (state.message) {
      toast(state.message);
      onOk?.();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ShopForm({ settings: s, canEdit }: { settings: Settings; canEdit: boolean }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(saveSettings, {});
  useReportBusy(pending);
  useResultToast(state);
  return (
    <form action={action}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="section-head">
          <h3>{t.shop}</h3>
        </div>
        <label className="field">
          <span>{t.shopName}</span>
          <input name="shop_name" defaultValue={s.shop_name} required />
        </label>
        <label className="field">
          <span>{t.address}</span>
          <input name="address" defaultValue={s.address ?? ""} />
        </label>
        <label className="field">
          <span>{t.phone}</span>
          <input name="phone" inputMode="tel" defaultValue={s.phone ?? ""} />
        </label>

        <div className="section-head">
          <h3>{t.hours}</h3>
        </div>
        <p className="sub">{t.hoursHint}</p>
        <div className="two">
          <label className="field">
            <span>{t.openTime}</span>
            <input type="time" name="open_time" defaultValue={s.open_time.slice(0, 5)} />
          </label>
          <label className="field">
            <span>{t.closeTime}</span>
            <input type="time" name="close_time" defaultValue={s.close_time.slice(0, 5)} />
          </label>
        </div>
        <label className="check">
          <span>{t.autoOpen}</span>
          <input type="checkbox" name="auto_open" defaultChecked={s.auto_open} />
        </label>
        <label className="check">
          <span>{t.autoClose}</span>
          <input type="checkbox" name="auto_close" defaultChecked={s.auto_close} />
        </label>
        {state.error && <p className="error">{state.error}</p>}
        {canEdit ? (
          <button className="primary" disabled={pending}>
            {pending ? (
              <>
                <Spinner />
                {t.saving}
              </>
            ) : (
              t.saveSettings
            )}
          </button>
        ) : (
          <p className="sub" style={{ marginTop: 10 }}>
            {t.ownerOnlySettings}
          </p>
        )}
      </fieldset>
    </form>
  );
}

export function StaffSection({ staff, meId }: { staff: Staff[]; meId: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(addStaff, {});
  useReportBusy(pending);
  const form = useRef<HTMLFormElement>(null);
  useResultToast(state, () => form.current?.reset());
  const [busy, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  useReportBusy(busy);
  const toast = useToast();

  return (
    <>
      <div className="section-head">
        <h3>{t.staffHeading}</h3>
      </div>
      <ul className="rows">
        {staff.map((p) => (
          <li className="row" key={p.id} style={{ opacity: p.active ? 1 : 0.55 }}>
            <div className="row-main">
              <div className="row-name">{p.name}</div>
              <div className="row-meta">
                {p.role === "owner" ? t.ownerCap : t.staffCap}
                {!p.active && `, ${t.cantSignIn}`}
              </div>
            </div>
            {p.id !== meId && (
              <button
                className="mini"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    setBusyId(p.id);
                    const r = await setStaffActive(p.id, !p.active);
                    toast(r.error ?? r.message ?? "", Boolean(r.error));
                  })
                }
              >
                {busy && busyId === p.id ? (
                  <>
                    <Spinner />
                    {t.saving}
                  </>
                ) : p.active ? (
                  t.turnOffLogin
                ) : (
                  t.turnOnLogin
                )}
              </button>
            )}
          </li>
        ))}
      </ul>

      <form action={action} ref={form}>
        <p className="sub" style={{ marginTop: 14 }}>
          {t.addStaffHint}
        </p>
        <label className="field">
          <span>{t.name}</span>
          <input name="name" placeholder={t.namePh} required />
        </label>
        <div className="two">
          <label className="field">
            <span>{t.username}</span>
            <input name="username" placeholder="rahim" autoCapitalize="none" required />
          </label>
          <label className="field">
            <span>{t.password}</span>
            <input name="password" type="text" placeholder={t.passwordPh} autoComplete="new-password" required />
          </label>
        </div>
        {state.error && <p className="error">{state.error}</p>}
        <button className="primary" disabled={pending}>
          {pending ? (
            <>
              <Spinner />
              {t.adding}
            </>
          ) : (
            t.addStaff
          )}
        </button>
      </form>
    </>
  );
}
