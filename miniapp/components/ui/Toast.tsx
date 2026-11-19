"use client";

import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Kind = "success" | "error" | "info";
type ToastState = { id: number; text: string; kind: Kind } | null;

const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((text: string, kind: Kind = "info") => {
    clearTimeout(timer.current);
    setToast({ id: Date.now(), text, kind });
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  const icon = { size: 20, strokeWidth: 1.75 };
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div key={toast.id} className="toast" role="status" aria-live="polite">
          {toast.kind === "success" && <CircleCheck className="ok" {...icon} />}
          {toast.kind === "error" && <CircleAlert className="bad" {...icon} />}
          {toast.kind === "info" && <Info {...icon} />}
          <span>{toast.text}</span>
        </div>
      )}
    </Ctx.Provider>
  );
}
