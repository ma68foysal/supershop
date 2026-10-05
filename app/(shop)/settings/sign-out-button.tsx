"use client";

import { useFormStatus } from "react-dom";
import { Spinner, useReportBusy } from "@/components/busy";
import { useI18n } from "@/components/i18n";

export default function SignOutButton() {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  useReportBusy(pending);
  return (
    <button className="secondary" disabled={pending}>
      {pending ? (
        <>
          <Spinner />
          {t.signingOut}
        </>
      ) : (
        t.signOut
      )}
    </button>
  );
}
