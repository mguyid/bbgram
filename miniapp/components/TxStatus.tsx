"use client";

import { CircleAlert, CircleCheck, ExternalLink, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { explorerTx, loadWallet, walletErrorMessage, type WalletModule } from "@/lib/loadWallet";
import { haptic, openLink } from "@/lib/telegram";
import { ic } from "./Common";

export type Tx =
  | { phase: "idle" }
  | { phase: "wallet" }
  | { phase: "pending"; hash: string }
  | { phase: "success"; hash: string }
  | { phase: "failed"; error: string };

/** Transaction states per telegram.md §4.5: waiting for wallet, pending on chain, success, failed. */
export function TxStatus({ tx, chainId, success }: { tx: Tx; chainId: number; success?: ReactNode }) {
  if (tx.phase === "idle") return null;
  const explorer =
    "hash" in tx ? (
      <button type="button" className="btn btn-ghost btn-compact" onClick={() => openLink(explorerTx(chainId, tx.hash))}>
        <span className="btn-label">
          View on BscScan <ExternalLink size={16} strokeWidth={1.75} />
        </span>
      </button>
    ) : null;
  return (
    <div className="message-box stack-8" role="status" aria-live="polite" style={{ wordBreak: "normal" }}>
      {tx.phase === "wallet" && (
        <div className="hrow">
          <LoaderCircle {...ic} className="spinner c-accent" />
          <div className="grow">
            <div className="t-strong">Waiting for wallet</div>
            <div className="t-caption muted">Confirm the request in your wallet app.</div>
          </div>
        </div>
      )}
      {tx.phase === "pending" && (
        <>
          <div className="hrow">
            <LoaderCircle {...ic} className="spinner c-accent" />
            <div className="grow">
              <div className="t-strong">Pending on chain</div>
              <div className="t-caption muted">This usually takes a few seconds.</div>
            </div>
          </div>
          {explorer}
        </>
      )}
      {tx.phase === "success" && (
        <>
          <div className="hrow c-success">
            <CircleCheck {...ic} />
            <span className="t-strong">{success || "Done"}</span>
          </div>
          {explorer}
        </>
      )}
      {tx.phase === "failed" && (
        <div className="hrow c-danger">
          <CircleAlert {...ic} />
          <span className="t-caption">{tx.error}</span>
        </div>
      )}
    </div>
  );
}

/** Sends a transaction through the lazily loaded wallet and tracks its state. Resolves true on success. */
export async function runTx(
  chainId: number,
  send: (w: WalletModule) => Promise<`0x${string}`>,
  setTx: (tx: Tx) => void,
): Promise<boolean> {
  setTx({ phase: "wallet" });
  try {
    const w = await loadWallet(chainId);
    const hash = await send(w);
    setTx({ phase: "pending", hash });
    await w.waitFor(hash, chainId);
    setTx({ phase: "success", hash });
    haptic.success();
    return true;
  } catch (e) {
    haptic.error();
    setTx({ phase: "failed", error: e instanceof ApiError ? e.message : await walletErrorMessage(e) });
    return false;
  }
}
