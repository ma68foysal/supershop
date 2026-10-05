"use client";

import { useFormStatus } from "react-dom";
import { Spinner, useReportBusy } from "@/components/busy";

export default function SignOutButton() {
  const { pending } = useFormStatus();
  useReportBusy(pending);
  return (
    <button className="secondary" disabled={pending}>
      {pending ? (
        <>
          <Spinner />
          Signing out…
        </>
      ) : (
        "Sign out"
      )}
    </button>
  );
}
