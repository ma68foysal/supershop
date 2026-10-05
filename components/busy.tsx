"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * App-wide "something is happening" signal. Any component with a pending
 * action reports it with useReportBusy(pending); the ink line at the top of
 * the screen runs while anything is pending.
 */
const BusyCtx = createContext<(delta: number) => void>(() => {});

export function BusyProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  const change = useCallback((delta: number) => setCount((c) => Math.max(0, c + delta)), []);
  return (
    <BusyCtx.Provider value={change}>
      <div className={"inkbar" + (count > 0 ? " on" : "")} aria-hidden="true" />
      {children}
    </BusyCtx.Provider>
  );
}

export function useReportBusy(pending: boolean) {
  const change = useContext(BusyCtx);
  useEffect(() => {
    if (!pending) return;
    change(1);
    return () => change(-1);
  }, [pending, change]);
}

export function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}
