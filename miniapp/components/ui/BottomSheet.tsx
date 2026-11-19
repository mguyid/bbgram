"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { pushBack } from "@/lib/telegram";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
};

export function BottomSheet({ open, title, onClose, footer, children }: Props) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const pop = pushBack(() => closeRef.current());
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      pop();
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden />
        <h2 className="t-h2 sheet-title">{title}</h2>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  );
}
