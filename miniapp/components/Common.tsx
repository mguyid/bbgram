"use client";

import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Card, EmptyState } from "./ui";
import { useApp } from "./AppContext";

export const ic = { size: 20, strokeWidth: 1.75 } as const;

export function ScreenHeader({ title }: { title: string }) {
  const { openSettings } = useApp();
  return (
    <header className="header">
      <h1 className="t-h1">{title}</h1>
      <button type="button" className="icon-btn" aria-label="Settings" onClick={openSettings}>
        <Settings {...ic} />
      </button>
    </header>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <EmptyState
        text={message}
        action={
          <Button variant="secondary" size="compact" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </Card>
  );
}

export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`screen ${className}`}>{children}</main>;
}
