import type { ReactNode } from "react";

type Tone = "default" | "accent" | "success" | "warning" | "danger" | "gold";

export function Chip({ tone = "default", className = "", children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={`chip ${tone === "default" ? "" : `chip-${tone}`} ${className}`}>{children}</span>;
}

/** Selectable chip used for filters and quick amounts. */
export function ChipButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="chip chip-select" aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  );
}
