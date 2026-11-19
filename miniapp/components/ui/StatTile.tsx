import type { ReactNode } from "react";

export function StatTile({ label, value, delta }: { label: string; value: ReactNode; delta?: ReactNode }) {
  return (
    <div className="stat">
      <span className="t-micro label">{label}</span>
      <span className="t-h2 num ellipsis">{value}</span>
      {delta && <span className="t-caption c-success num">{delta}</span>}
    </div>
  );
}
