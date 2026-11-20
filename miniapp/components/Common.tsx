"use client";

import { Settings, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { shortAddress } from "@/lib/format";
import { Button, Card, EmptyState } from "./ui";
import { useApp } from "./AppContext";

export const ic = { size: 20, strokeWidth: 1.75 } as const;

/** Screen title on the left; wallet pill and settings on the right. `brand` adds the logo mark (Home). */
export function ScreenHeader({ title, brand = false }: { title: string; brand?: boolean }) {
  const { me, openSettings, openWallet } = useApp();
  return (
    <header className="header">
      <div className="hrow" style={{ gap: 10, minWidth: 0 }}>
        {brand && (
          <span className="brand-mark" aria-hidden>
            BG
          </span>
        )}
        <h1 className="t-h1 ellipsis">{title}</h1>
      </div>
      <div className="hrow" style={{ gap: 4, flex: "none" }}>
        {me.wallet_address ? (
          <button type="button" className="wallet-pill" aria-label="Linked wallet" onClick={openSettings}>
            <span className="wallet-dot" aria-hidden />
            <span className="mono">{shortAddress(me.wallet_address)}</span>
          </button>
        ) : (
          <button type="button" className="wallet-pill connect" onClick={openWallet}>
            <Wallet size={16} strokeWidth={2} aria-hidden />
            Connect
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Settings" onClick={openSettings}>
          <Settings {...ic} />
        </button>
      </div>
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
