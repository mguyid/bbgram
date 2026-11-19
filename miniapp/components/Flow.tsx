"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { inTelegram, pushBack } from "@/lib/telegram";
import { ic } from "./Common";

/** Full-screen push for multi-step flows. Uses Telegram's BackButton; a close icon only outside Telegram. */
export function Flow({
  title,
  steps,
  current,
  onClose,
  children,
}: {
  title: string;
  steps: string[];
  current: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => pushBack(() => closeRef.current()), []);
  const showClose = !inTelegram();

  return (
    <div className="flow" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flow-inner">
        <header className="header">
          <h1 className="t-h1">{title}</h1>
          {showClose && (
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X {...ic} />
            </button>
          )}
        </header>
        <ol className="stepper" aria-label="Steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {steps.map((s, i) => (
            <li
              key={s}
              className={`step ${i < current ? "done" : ""} ${i === current ? "active" : ""}`}
              aria-current={i === current ? "step" : undefined}
            >
              <span className="bar" />
              <span className="t-caption hrow" style={{ gap: 4 }}>
                {i < current ? <Check size={14} strokeWidth={2} /> : <span className="num">{i + 1}</span>}
                <span className="ellipsis">{s}</span>
              </span>
            </li>
          ))}
        </ol>
        {children}
      </div>
    </div>
  );
}
