"use client";

import { useActionState } from "react";
import { signIn } from "@/app/actions";
import { Spinner, useReportBusy } from "@/components/busy";
import { useI18n } from "@/components/i18n";

export default function LoginForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(signIn, {});
  useReportBusy(pending);
  return (
    <form action={action}>
      <label className="field">
        <span>{t.loginField}</span>
        <input name="login" autoComplete="username" autoCapitalize="none" required />
      </label>
      <label className="field">
        <span>{t.password}</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button className="primary" disabled={pending}>
        {pending ? (
          <>
            <Spinner />
            {t.signingIn}
          </>
        ) : (
          t.signIn
        )}
      </button>
      <p className="sub" style={{ marginTop: 16 }}>
        {t.loginHint}
      </p>
    </form>
  );
}
