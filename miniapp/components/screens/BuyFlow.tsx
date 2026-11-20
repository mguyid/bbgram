"use client";

import { CircleCheck, Share2, Wallet } from "lucide-react";
import { useState } from "react";
import { ApiError, presaleReady, type Presale } from "@/lib/api";
import { fromWei, shortAddress, tokens, tokensFor, toWei, usdt } from "@/lib/format";
import { loadWallet, walletErrorMessage } from "@/lib/loadWallet";
import { haptic, shareUrl } from "@/lib/telegram";
import { useApi } from "@/lib/useApi";
import { useApp } from "../AppContext";
import { ErrorCard, ic } from "../Common";
import { Flow } from "../Flow";
import { HandoffActions } from "../Handoff";
import { runTx, TxStatus, type Tx } from "../TxStatus";
import { Button, Card, ChipButton, Skeleton } from "../ui";

const QUICK = [25, 100, 500, 1000];
const ZERO = BigInt(0);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

const STEPS = ["Connect", "Amount", "Pay"];

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

function BuySteps({ p, onClose }: { p: Presale; onClose: () => void }) {
  const { me } = useApp();
  const chainId = p.chain_id ?? 56;
  const usdtAddr = p.usdt_address || "";
  const presaleWallet = p.presale_wallet || "";
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [payTx, setPayTx] = useState<Tx>({ phase: "idle" });

  const amount = toWei(input) ?? ZERO;
  const contributed = BigInt(p.contributed_wei || "0");
  const maxWei = BigInt(p.max_wei);
  const capWei = BigInt(p.hard_cap_wei);
  const walletLeft = maxWei > contributed ? maxWei - contributed : ZERO;
  const raised = BigInt(p.raised_wei);
  const limit = capWei > ZERO ? min(walletLeft, capWei > raised ? capWei - raised : ZERO) : walletLeft;
  const minWei = BigInt(p.min_wei);

  const amountError = (() => {
    if (!input.trim()) return "";
    if (toWei(input) === null || amount === ZERO) return "Enter a valid amount.";
    if (amount > limit) return limit > ZERO ? `You can buy up to ${usdt(limit)}.` : "You reached the maximum for this wallet.";
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
      // Payments are matched to buyers by the sending wallet, so only the linked wallet can buy.
      if (!me.wallet_address || a.toLowerCase() !== me.wallet_address.toLowerCase()) {
        setAddress(a);
        setError(
          me.wallet_address
            ? `Connect the wallet you linked (${shortAddress(me.wallet_address)}).`
            : "Link this wallet first, then buy from it.",
        );
        haptic.error();
        return;
      }
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

  const pay = async () => {
    await runTx(chainId, (w) => w.payUsdt(usdtAddr, presaleWallet, amount, chainId), setPayTx);
  };

  const preview = tokens(tokensFor(amount, p.tokens_per_usdt_wei));
  const txBusy = (t: Tx) => t.phase === "wallet" || t.phase === "pending";

  return (
    <Flow title="Buy tokens" steps={STEPS} current={payTx.phase === "success" ? 3 : step} onClose={onClose}>
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
              <span className="t-caption muted">Estimated tokens</span>
              <span className="t-strong num">{preview}</span>
            </div>
            <span className="t-caption muted">
              Min {usdt(minWei)} · You can still buy {usdt(limit)}
            </span>
            {(amountError || error) && <span className="field-error">{amountError || error}</span>}
            <Button
              block
              disabled={!input.trim() || !!amountError}
              onClick={() => {
                haptic.light();
                setPayTx({ phase: "idle" });
                setStep(2);
              }}
            >
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && payTx.phase !== "success" && (
        <Card>
          <div className="stack">
            <div className="stack-8">
              <div className="between">
                <span className="t-caption muted">You pay</span>
                <span className="t-strong num">{fromWei(amount, 2)} USDT</span>
              </div>
              <div className="between">
                <span className="t-caption muted">Estimated tokens</span>
                <span className="t-strong num">{preview}</span>
              </div>
              <div className="between">
                <span className="t-caption muted">From</span>
                <span className="mono">{shortAddress(address)}</span>
              </div>
              <div className="between">
                <span className="t-caption muted">To presale wallet</span>
                <span className="mono">{shortAddress(presaleWallet)}</span>
              </div>
            </div>
            <p className="t-caption muted" style={{ margin: 0 }}>
              This sends USDT straight to the presale wallet and needs a small BNB network fee. Your tokens are sent
              to this wallet after launch. Payments above {usdt(maxWei)} per wallet are not counted.
            </p>
            <TxStatus tx={payTx} chainId={chainId} />
            <Button block loading={txBusy(payTx)} onClick={pay}>
              {payTx.phase === "failed" ? "Try again" : `Pay ${fromWei(amount, 2)} USDT`}
            </Button>
            {!txBusy(payTx) && (
              <Button variant="ghost" block onClick={() => setStep(1)}>
                Change amount
              </Button>
            )}
          </div>
        </Card>
      )}

      {payTx.phase === "success" && (
        <Card>
          <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
            <CircleCheck size={40} strokeWidth={1.75} className="c-success" />
            <div className="t-h2">Payment sent</div>
            <div className="t-caption muted num">
              You paid {fromWei(amount, 2)} USDT for about {preview} tokens. It shows in your allocation within a
              minute.
            </div>
            <TxStatus tx={payTx} chainId={chainId} success="Confirmed on chain" />
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
