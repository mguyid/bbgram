"use client";

import { useEffect, useState } from "react";
import { countdown } from "@/lib/format";

/** Ticks every second; calls onDone once when the target is reached. */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function Countdown({ to, onDone, className = "" }: { to: string | number; onDone?: () => void; className?: string }) {
  const target = typeof to === "number" ? to : new Date(to).getTime();
  const now = useNow();
  const left = target - now;
  useEffect(() => {
    if (left <= 0 && onDone) onDone();
    // Fire once when crossing zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left <= 0]);
  return <span className={`t-caption num ${className}`}>{countdown(left)}</span>;
}
