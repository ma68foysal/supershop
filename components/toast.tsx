"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type Toast = { text: string; bad?: boolean } | null;
const Ctx = createContext<(text: string, bad?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string, bad?: boolean) => {
    clearTimeout(timer.current);
    setToast({ text, bad });
    timer.current = setTimeout(() => setToast(null), bad ? 4000 : 2400);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div role="status" aria-live="polite">
        {toast && <div className={"toast" + (toast.bad ? " bad" : "")}>{toast.text}</div>}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
