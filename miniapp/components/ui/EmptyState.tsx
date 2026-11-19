import type { ReactNode } from "react";

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="t-body" style={{ margin: 0 }}>
        {text}
      </p>
      {action}
    </div>
  );
}
