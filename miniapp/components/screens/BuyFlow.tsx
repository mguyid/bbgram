"use client";

import { CircleCheck, Share2, Wallet } from "lucide-react";
import { useState } from "react";
import { api, ApiError, presaleReady, type Presale } from "@/lib/api";
import { fromWei, shortAddress, tokens, tokensFor, toWei, unlockTerms, usdt } from "@/lib/format";
import { loadWallet, walletErrorMessage } from "@/lib/loadWallet";
import { haptic, shareUrl } from "@/lib/telegram";
import { useApi } from "@/lib/useApi";
import { useApp } from "../AppContext";
import { ErrorCard, ic } from "../Common";
import { Flow } from "../Flow";
import { HandoffActions } from "../Handoff";
import { runTx, TxStatus, type Tx } from "../TxStatus";
import { Button, Card, ChipButton, Skeleton } from "../ui";

type Signature = { wallet: string; max_allocation_wei: string; signature: string };

const QUICK = [25, 100, 500, 1000];
const ZERO = BigInt(0);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export function BuyFlow({ onClose }: { onClose: () => void }) {
  const presale = useApi<Presale>("/api/presale");
  const p = presale.data;
  return p && presaleReady(p) && p.status === "live" ? (
    <BuySteps p={p} onClose={onClose} />
  ) : (
    <Flow title="Buy tokens" steps={STEPS} current={0} onClose={onClose}>
      {p ? (
        <ErrorCard
          message={p.status === "paused" ? "The presale is paused. Try again later." : "The presale is not open right now."}
          onRetry={presale.reload}
        />
      ) : presale.error ? (
        <ErrorCard message={presale.error.message} onRetry={presale.reload} />
      ) : (
        <Skeleton height={240} />
      )}
    </Flow>
  );
}

const STEPS = ["Connect", "Amount", "Approve", "Confirm"];

function BuySteps({ p, onClose }: { p: Presale; onClose: () => void }) {
  const { me } = useApp();
  const chainId = p.chain_id ?? 56;
  const usdtAddr = p.usdt_address || "";
  const presaleAddr = p.presale_address || "";
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState("");
  const [sig, setSig] = useState<Signature | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approveTx, setApproveTx] = useState<Tx>({ phase: "idle" });
  const [buyTx, setBuyTx] = useState<Tx>({ phase: "idle" });

  const amount = toWei(input) ?? ZERO;
  const contributed = BigInt(p.contributed_wei || "0");
  const cap = min(BigInt(p.max_wei), sig ? BigInt(sig.max_allocation_wei) : BigInt(p.max_wei));
  const walletLeft = cap > contributed ? cap - contributed : ZERO;
  const saleLeft = BigInt(p.hard_cap_wei) > BigInt(p.raised_wei) ? BigInt(p.hard_cap_wei) - BigInt(p.raised_wei) : ZERO;
  const limit = min(walletLeft, saleLeft);
  const minWei = BigInt(p.min_wei);

  const amountError = (() => {
    if (!input.trim()) return "";
    if (toWei(input) === null || amount === ZERO) return "Enter a valid amount.";
    if (amount > limit) return `You can buy up to ${usdt(limit)}.`;
    if (amount < minWei && amount !== walletLeft) return `Minimum is ${usdt(minWei)}.`;
    if (balance !== null && amount > balance) return "Not enough USDT in this wallet.";
    return "";
  })();

  const fail = async (e: unknown) => {
    haptic.error();
    setError(e instanceof ApiError ? e.message : await walletErrorMessage(e));
  };

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const w = await loadWallet(chainId);
      const a = await w.connect();
      if (me.wallet_address && a.toLowerCase() !== me.wallet_address.toLowerCase()) {
        setAddress(a);
        setError(`Connect the wallet you linked (${shortAddress(me.wallet_address)}).`);
        haptic.error();
        return;
      }
      const s = await api.get<Signature>("/api/presale/signature");
      setSig(s);
      setAddress(a);
      setBalance(await w.usdtBalance(usdtAddr, a, chainId).catch(() => null));
      setStep(1);
      haptic.light();
    } catch (e) {
      await fail(e);
    } finally {
      setBusy(false);
    }
  };

  const useOther = async () => {
    try {
      const w = await loadWallet(chainId);
      await w.disconnect();
    } catch {}
    setAddress("");
    setError("");
  };

  const toApprove = async () => {
    setBusy(true);
    setError("");
    try {
      const w = await loadWallet(chainId);
      const allowed = await w.allowance(usdtAddr, address, presaleAddr, chainId);
      setApproveTx({ phase: "idle" });
      setStep(allowed >= amount ? 3 : 2);
      haptic.light();
    } catch (e) {
      await fail(e);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    const ok = await runTx(chainId, (w) => w.approve(usdtAddr, presaleAddr, amount, chainId), setApproveTx);
    if (ok) setTimeout(() => setStep(3), 600);
  };

  const buy = async () => {
    if (!sig) return;
    await runTx(
      chainId,
      (w) => w.buy(presaleAddr, amount, BigInt(sig.max_allocation_wei), sig.signature, chainId),
      setBuyTx,
    );
  };

  const preview = tokens(tokensFor(amount, p.tokens_per_usdt_wei));
  const terms = unlockTerms(p.unlock_bps, p.vesting_seconds);
  const txBusy = (t: Tx) => t.phase === "wallet" || t.phase === "pending";

  return (
    <Flow title="Buy tokens" steps={STEPS} current={buyTx.phase === "success" ? 4 : step} onClose={onClose}>
      {step === 0 && (
        <>
          <Card>
            <div className="stack">
              <div className="hrow">
                <div className="row-icon">
                  <Wallet {...ic} />
                </div>
                <div className="grow">
                  <div className="t-strong">Connect your linked wallet</div>
                  <div className="t-caption muted">
                    {me.wallet_address ? (
                      <>
                        Use <span className="mono">{shortAddress(me.wallet_address)}</span>. You pay in USDT on BNB
                        Smart Chain.
                      </>
                    ) : (
                      "You pay in USDT on BNB Smart Chain."
                    )}
                  </div>
                </div>
              </div>
              {address ? (
                <Button variant="secondary" block onClick={useOther}>
                  Use a different wallet
                </Button>
              ) : (
                <Button block loading={busy} onClick={connect}>
                  Connect wallet
                </Button>
              )}
              {error && <span className="field-error">{error}</span>}
            </div>
          </Card>
          <HandoffActions />
        </>
      )}

      {step === 1 && (
        <Card>
          <div className="stack">
            <div className="between t-caption">
              <span className="muted">Wallet</span>
              <span className="mono">{shortAddress(address)}</span>
            </div>
            {balance !== null && (
              <div className="between t-caption">
                <span className="muted">USDT balance</span>
                <span className="num">{usdt(balance)}</span>
              </div>
            )}
            <label className="stack-8">
              <span className="t-caption muted">Amount in USDT</span>
              <input
                className="input amount-input"
                inputMode="decimal"
                placeholder="0"
                value={input}
                onChange={(e) => setInput(e.target.value.replace(",", "."))}
                aria-invalid={!!amountError}
              />
            </label>
            <div className="chip-row">
              {QUICK.map((q) => (
                <ChipButton
                  key={q}
                  selected={input === String(q)}
                  onClick={() => {
                    haptic.light();
                    setInput(String(q));
                  }}
                >
                  ${q.toLocaleString("en-US")}
                </ChipButton>
              ))}
            </div>
            <div className="message-box between" style={{ wordBreak: "normal" }}>
              <span className="t-caption muted">You receive</span>
              <span className="t-strong num">{preview} tokens</span>
            </div>
            <span className="t-caption muted">
              Min {usdt(minWei)} · You can still buy {usdt(limit)}
            </span>
            {(amountError || error) && <span className="field-error">{amountError || error}</span>}
            <Button block loading={busy} disabled={!input.trim() || !!amountError} onClick={toApprove}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <div className="stack">
            <div>
              <div className="t-strong">Approve USDT</div>
              <div className="t-caption muted">
                Allow the presale contract to use {fromWei(amount, 2)} USDT from your wallet. This needs a small BNB network
                fee.
              </div>
            </div>
            <TxStatus tx={approveTx} chainId={chainId} success="USDT approved" />
            <Button
              block
              loading={txBusy(approveTx)}
              disabled={approveTx.phase === "success"}
              onClick={approve}
            >
              {approveTx.phase === "failed" ? "Try again" : "Approve USDT"}
            </Button>
            <Button variant="ghost" block disabled={txBusy(approveTx)} onClick={() => setStep(1)}>
              Change amount
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && buyTx.phase !== "success" && (
        <Card>
          <div className="stack">
            <div className="stack-8">
              <div className="between">
                <span className="t-caption muted">You pay</span>
                <span className="t-strong num">{fromWei(amount, 2)} USDT</span>
              </div>
              <div className="between">
                <span className="t-caption muted">You receive</span>
                <span className="t-strong num">{preview} tokens</span>
              </div>
              <div className="between">
                <span className="t-caption muted">Wallet</span>
                <span className="mono">{shortAddress(address)}</span>
              </div>
            </div>
            <p className="t-caption muted" style={{ margin: 0 }}>
              Tokens can be claimed in this app after launch.
              {terms && ` ${terms}.`}
            </p>
            <TxStatus tx={buyTx} chainId={chainId} />
            <Button block loading={txBusy(buyTx)} onClick={buy}>
              {buyTx.phase === "failed" ? "Try again" : "Buy tokens"}
            </Button>
            {!txBusy(buyTx) && (
              <Button variant="ghost" block onClick={() => setStep(1)}>
                Change amount
              </Button>
            )}
          </div>
        </Card>
      )}

      {buyTx.phase === "success" && (
        <Card>
          <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
            <CircleCheck size={40} strokeWidth={1.75} className="c-success" />
            <div className="t-h2">Purchase complete</div>
            <div className="t-caption muted num">
              You paid {fromWei(amount, 2)} USDT for {preview} tokens.
            </div>
            <TxStatus tx={buyTx} chainId={chainId} success="Confirmed on chain" />
            <Button
              variant="secondary"
              block
              onClick={() => shareUrl(me.referral_link, "I just joined the Baby Grand presale. Join me:")}
            >
              <Share2 {...ic} /> Share
            </Button>
            <Button block onClick={onClose}>
              Done
            </Button>
          </div>
        </Card>
      )}
    </Flow>
  );
}
