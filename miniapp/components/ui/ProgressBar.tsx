import type { ReactNode } from "react";

export function ProgressBar({ value, label, right }: { value: number; label?: ReactNode; right?: ReactNode }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="stack-8">
      {(label || right) && (
        <div className="between t-caption">
          <span className="muted">{label}</span>
          <span className="num">{right}</span>
        </div>
      )}
      <div className="progress" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
