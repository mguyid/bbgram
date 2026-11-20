"use client";

// "Credit buyers" panel of the Presale page: sends frozen allocations from the connected (treasury) wallet in
// batches through the multisend contract. Loaded with next/dynamic so the wallet libraries stay out of other pages.

import { useCallback, useEffect, useMemo, useState } from "react";
import { isAddress, type Abi, type Address, type Hex } from "viem";
import { api } from "@/lib/api";
import { formatNumber, formatWei } from "@/lib/format";
import type { Settings } from "@/lib/types";
import { Addr, ErrorBox } from "@/components/ui";
import { erc20Abi, multisendAbi } from "./abi";
import { chainFor, explorerTx, initWallet, makePublicClient, plainError, projectId, sendTx } from "./wallet";

/** Wallets per multisend transaction. */
const BATCH = 150;

/**
 * A batch that was started but not yet marked as credited. Saved before the wallet is asked to sign and
 * cleared only once the API has recorded it, so a failed API call, a closed tab or a crash can never lead
 * to the same buyers being paid twice: no new batch can be sent from this browser until it is resolved.
 */
type Pending = { recipients: string[]; hash?: string; at: string };
const PENDING_KEY = "bg-presale-credit-pending";

function loadPending(): Pending | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}

function savePending(p: Pending | null) {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {}
}

export type CreditItem = { wallet_address: string; tokens_wei: string };

type Tx =
  | { phase: "idle" }
  | { phase: "wallet"; what: string }
  | { phase: "pending"; what: string; hash: string }
  | { phase: "done"; what: string; hash: string; warn?: string }
  | { phase: "failed"; reason: string; hash?: string };

export default function PresaleCredit({
  settings,
  items,
  canEdit,
  onCredited,
}: {
  settings: Settings;
  /** Allocations not credited yet. */
  items: CreditItem[];
  canEdit: boolean;
  onCredited: () => void;
}) {
  const chainId = Number(settings.chain_id) || 0;
  const rpc = settings.rpc_url ?? "";
  const token = settings.token_address;
  const multisend = settings.multisend_address;
  const ready = !!chainId && !!rpc && !!token && isAddress(token) && !!multisend && isAddress(multisend);

  const chain = useMemo(() => (chainId && rpc ? chainFor(chainId, rpc) : null), [chainId, rpc]);
  const client = useMemo(() => (chain ? makePublicClient(chain) : null), [chain]);
  const [kit] = useState(() => (canEdit && chain ? initWallet(chain) : null));
  const [account, setAccount] = useState<Address | undefined>();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [tx, setTx] = useState<Tx>({ phase: "idle" });
  // Client-only component (next/dynamic with ssr: false), so localStorage is available here.
  const [pending, setPendingState] = useState<Pending | null>(loadPending);
  const [manualHash, setManualHash] = useState("");
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null);
  const setPending = (p: Pending | null) => {
    savePending(p);
    setPendingState(p);
  };

  useEffect(() => {
    if (!kit) return;
    return kit.subscribeAccount((s) => setAccount(s.isConnected && s.address ? (s.address as Address) : undefined));
  }, [kit]);

  const refresh = useCallback(() => {
    if (!client || !ready || !account) return;
    const read = (functionName: string, args: unknown[]) =>
      client.readContract({ address: token as Address, abi: erc20Abi as Abi, functionName, args }) as Promise<bigint>;
    Promise.all([read("balanceOf", [account]), read("allowance", [account, multisend])]).then(
      ([b, a]) => {
        setBalance(b);
        setAllowance(a);
        setReadError(null);
      },
      (e) => setReadError(`Could not read the chain: ${plainError(e)}`),
    );
  }, [client, ready, account, token, multisend]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const payable = useMemo(() => items.filter((i) => BigInt(i.tokens_wei) > 0n), [items]);
  const remaining = useMemo(() => payable.reduce((sum, i) => sum + BigInt(i.tokens_wei), 0n), [payable]);
  const batch = payable.slice(0, BATCH);
  const batchTotal = batch.reduce((sum, i) => sum + BigInt(i.tokens_wei), 0n);
  const busy = tx.phase === "wallet" || tx.phase === "pending";

  /** Sends one transaction and waits for it. Returns the hash, or null when it failed (state is set). */
  const send = async (
    what: string,
    address: string,
    abi: Abi,
    method: string,
    args: readonly unknown[],
    onHash?: (hash: Hex) => void,
  ) => {
    if (!client || !account) return null;
    setTx({ phase: "wallet", what });
    let hash: Hex | undefined;
    try {
      hash = await sendTx(client, account, address as Address, abi, method, args);
      onHash?.(hash);
      setTx({ phase: "pending", what, hash });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== "success") {
        setTx({ phase: "failed", hash, reason: "The transaction reverted on chain." });
        return null;
      }
      return hash;
    } catch (e) {
      setTx({ phase: "failed", hash, reason: plainError(e) });
      return null;
    }
  };

  const log = (contract: "token" | "multisend", method: string, args: unknown[], hash: string) =>
    api("/contracts/log", { method: "POST", body: { contract, method, args, tx_hash: hash } }).then(
      () => undefined,
      (e: Error) => `Audit log failed: ${e.message}`,
    );

  const approve = async () => {
    const hash = await send("Approval", token!, erc20Abi as Abi, "approve", [multisend, remaining]);
    if (!hash) return;
    const warn = await log("token", "approve", [multisend, remaining.toString()], hash);
    setTx({ phase: "done", what: "Approval confirmed.", hash, warn });
    refresh();
  };

  /** Records a confirmed batch with the API. On failure the pending record stays, blocking new batches. */
  const markCredited = async (p: Pending & { hash: string }): Promise<string | undefined> => {
    try {
      await api("/presale/credited", { method: "POST", body: { tx_hash: p.hash, wallet_addresses: p.recipients } });
      setPending(null);
      return undefined;
    } catch (e) {
      return `Tokens were sent, but marking them as credited failed: ${(e as Error).message} Use "Check and finish" below to retry. Do not send again.`;
    }
  };

  const sendBatch = async () => {
    const recipients = batch.map((i) => i.wallet_address);
    const amounts = batch.map((i) => BigInt(i.tokens_wei));
    const started: Pending = { recipients, at: new Date().toISOString() };
    setPending(started); // before the wallet signs: a crash after this point still blocks a second send
    const hash = await send("Batch", multisend!, multisendAbi as Abi, "send", [token, recipients, amounts], (h) =>
      setPending({ ...started, hash: h }),
    );
    if (!hash) {
      // Rejected in the wallet: nothing was sent. Reverted on chain: nothing moved. Either way it is safe to clear.
      setPending(null);
      return;
    }
    const warn = await markCredited({ ...started, hash });
    const logWarn = await log("multisend", "send", [token, recipients, amounts.map(String)], hash);
    setTx({ phase: "done", what: `Sent to ${recipients.length} wallets.`, hash, warn: warn ?? logWarn });
    refresh();
    if (!warn) onCredited();
  };

  /** Resolves a batch left over from an earlier attempt (failed API call, closed tab, crash). */
  const checkPending = async () => {
    if (!pending?.hash || !client) return;
    setRecoverMsg(null);
    try {
      const r = await client.getTransactionReceipt({ hash: pending.hash as Hex });
      if (r.status !== "success") {
        setPending(null);
        setRecoverMsg("That transaction reverted, so nothing was sent. You can send the batch again.");
        return;
      }
    } catch {
      setRecoverMsg("The transaction is not confirmed yet (or was dropped). Check BscScan and try again in a minute.");
      return;
    }
    const warn = await markCredited({ ...pending, hash: pending.hash });
    setRecoverMsg(warn ?? "Batch recorded as credited.");
    if (!warn) onCredited();
  };

  const markManually = async () => {
    if (!pending || !/^0x[0-9a-fA-F]{64}$/.test(manualHash.trim())) {
      setRecoverMsg("Enter the full transaction hash (0x followed by 64 hex characters).");
      return;
    }
    const warn = await markCredited({ ...pending, hash: manualHash.trim() });
    setRecoverMsg(warn ?? "Batch recorded as credited.");
    if (!warn) {
      setManualHash("");
      onCredited();
    }
  };

  const discardPending = () => {
    if (!window.confirm("Discard this batch? Only do this if you checked BscScan and no tokens were sent for it.")) return;
    setPending(null);
    setRecoverMsg("Discarded. You can send the batch again.");
  };

  const link = (hash: string) => {
    const url = explorerTx(chainId, hash);
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        view on BscScan
      </a>
    ) : (
      <code>{hash}</code>
    );
  };

  const needsApproval = allowance !== null && allowance < batchTotal;
  const short = balance !== null && balance < batchTotal;

  return (
    <div className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h3>Credit buyers</h3>
          <p>
            Sends each buyer&apos;s allocation from the connected wallet, {BATCH} wallets per transaction. Buyers do nothing
            and pay no gas.
          </p>
        </div>
      </div>
      <dl className="kv">
        <dt>Wallets left to credit</dt>
        <dd>{formatNumber(payable.length)}</dd>
        <dt>Tokens left to send</dt>
        <dd>{formatWei(remaining.toString())}</dd>
        <dt>Token</dt>
        <dd>
          <Addr value={token} full />
        </dd>
        <dt>Multisend</dt>
        <dd>
          <Addr value={multisend} full />
        </dd>
        {account && (
          <>
            <dt>Connected wallet</dt>
            <dd>
              <Addr value={account} full />
            </dd>
            <dt>Its token balance</dt>
            <dd>
              {balance === null ? "…" : formatWei(balance.toString())}{" "}
              {balance !== null && balance < remaining && <span className="badge amber">less than the total left</span>}
            </dd>
            <dt>Approved for multisend</dt>
            <dd>{allowance === null ? "…" : formatWei(allowance.toString())}</dd>
          </>
        )}
      </dl>
      <ErrorBox error={readError} />
      {!ready ? (
        <div className="notice small">
          Set the chain, RPC URL, token address and multisend address on the Settings page first.
        </div>
      ) : !payable.length ? (
        <div className="success small">Every buyer has been credited.</div>
      ) : !canEdit ? (
        <div className="muted small">Viewers cannot send tokens.</div>
      ) : !kit ? (
        <div className="muted small">
          {projectId ? "Wallet unavailable." : "Wallet connect is not configured (NEXT_PUBLIC_REOWN_PROJECT_ID)."}
        </div>
      ) : (
        <>
          <div className="row">
            <button type="button" className="btn" onClick={() => kit.open()}>
              {account ? "Wallet" : "Connect wallet"}
            </button>
            {account && (
              <button type="button" className="btn ghost" onClick={() => kit.disconnect()} disabled={busy}>
                Disconnect
              </button>
            )}
            <button
              type="button"
              className={needsApproval ? "btn primary" : "btn"}
              disabled={!account || busy || allowance === null || allowance >= remaining}
              onClick={approve}
            >
              1. Approve {formatWei(remaining.toString())} tokens
            </button>
            <button
              type="button"
              className={needsApproval ? "btn" : "btn primary"}
              disabled={!account || busy || !!pending || allowance === null || needsApproval || short}
              onClick={sendBatch}
            >
              2. Send next batch ({formatNumber(batch.length)} wallets · {formatWei(batchTotal.toString())} tokens)
            </button>
          </div>
          {account && short && (
            <div className="muted small">The connected wallet does not hold enough tokens for the next batch.</div>
          )}
          {account && !short && needsApproval && (
            <div className="muted small">Approve first: the multisend may not move enough tokens for the next batch.</div>
          )}
        </>
      )}
      {pending && !busy && (
        <div className="notice small stack">
          <div>
            <strong>Unfinished batch from {new Date(pending.at).toLocaleString()}</strong> ({pending.recipients.length}{" "}
            wallets). New batches are blocked until it is resolved, so nobody is paid twice.{" "}
            {pending.hash ? <>Transaction: {link(pending.hash)}</> : "No transaction hash was recorded."}
          </div>
          {pending.hash ? (
            <div className="row">
              <button type="button" className="btn primary" onClick={checkPending} disabled={!canEdit}>
                Check and finish
              </button>
            </div>
          ) : (
            <div className="row">
              <input
                placeholder="0x… hash of the multisend transaction, if one was sent"
                value={manualHash}
                onChange={(e) => setManualHash(e.target.value)}
                disabled={!canEdit}
              />
              <button type="button" className="btn primary" onClick={markManually} disabled={!canEdit}>
                Mark as sent
              </button>
            </div>
          )}
          <div className="row">
            <button type="button" className="btn ghost" onClick={discardPending} disabled={!canEdit}>
              Nothing was sent, discard
            </button>
          </div>
        </div>
      )}
      {recoverMsg && <div className="small">{recoverMsg}</div>}
      {tx.phase === "wallet" && <div className="notice small">{tx.what}: waiting for wallet confirmation…</div>}
      {tx.phase === "pending" && (
        <div className="notice small">
          {tx.what}: pending… {link(tx.hash)}
        </div>
      )}
      {tx.phase === "done" && (
        <div className="small">
          <span className="ok">{tx.what}</span> {link(tx.hash)}
          {tx.warn && <div className="error small">{tx.warn}</div>}
        </div>
      )}
      {tx.phase === "failed" && (
        <div className="error small">
          Failed: {tx.reason} {tx.hash && link(tx.hash)}
        </div>
      )}
    </div>
  );
}
