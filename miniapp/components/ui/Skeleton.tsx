import type { CSSProperties } from "react";

export function Skeleton({ height, width = "100%", radius, style }: { height: number; width?: number | string; radius?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" aria-hidden style={{ height, width, borderRadius: radius, ...style }} />;
}
