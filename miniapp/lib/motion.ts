"use client";

import { useEffect, useRef, useState } from "react";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Animates a number towards `target` over 600ms (ease-out). Disabled under reduced motion. */
export function useCountUp(target: number): number {
  const [reduced] = useState(prefersReducedMotion);
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 600);
      const val = Math.round(a + (target - a) * (1 - Math.pow(1 - p, 3)));
      from.current = val;
      setShown(val);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return reduced ? target : shown;
}
