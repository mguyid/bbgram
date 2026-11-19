"use client";

import { CircleCheck, Wallet } from "lucide-react";
import { useState } from "react";
import { api, ApiError, type Presale } from "@/lib/api";
import { shortAddress } from "@/lib/format";
import { loadWallet, walletErrorMessage } from "@/lib/loadWallet";
import { haptic } from "@/lib/telegram";
import { useApi } from "@/lib/useApi";
import { useApp } from "../AppContext";
import { ic } from "../Common";
import { Flow } from "../Flow";
import { HandoffActions } from "../Handoff";
import { Button, Card, Skeleton, useToast } from "../ui";

type Nonce = { nonce: string; message: string };

export function WalletLinkFlow({ onClose }: { onClose: () => void }) {
  const { me, setMe, refreshMe } = useApp();
  const toast = useToast();
  const presale = useApi<Presale>("/api/presale");
  const chainId = presale.data?.chain_id ?? 56;
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState("");
  const [nonce, setNonce] = useState<Nonce | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      const n = await api.get<Nonce>("/api/wallet/nonce");
      setAddress(a);
      setNonce(n);
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
    setNonce(null);
    setStep(0);
  };

  const sign = async () => {
    if (!nonce) return;
    setBusy(true);
    setError("");
    try {
      const w = await loadWallet(chainId);
      const signature = await w.signMessage(nonce.message);
      const r = await api.post<{ address: string }>("/api/wallet/link", {
        address,
        signature,
        nonce: nonce.nonce,
      });
      setMe({ ...me, wallet_address: r.address });
      refreshMe();
      haptic.success();
      toast("Wallet linked.", "success");
      setStep(2);
    } catch (e) {
      await fail(e);
      // A nonce is single use; fetch a fresh one for the retry.
      api.get<Nonce>("/api/wallet/nonce").then(setNonce, () => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flow title="Link wallet" steps={["Connect", "Sign", "Done"]} current={step} onClose={onClose}>
      {step === 0 && (
        <>
          <Card>
            <div className="stack">
              <div className="hrow">
                <div className="row-icon">
                  <Wallet {...ic} />
                </div>
                <div className="grow">
                  <div className="t-strong">Connect your wallet</div>
                  <div className="t-caption muted">
                    MetaMask, Trust Wallet, Binance Web3 Wallet, OKX, Coinbase or any WalletConnect wallet.
                  </div>
                </div>
              </div>
              {me.wallet_address && (
                <div className="message-box t-caption">
                  Currently linked: <span className="mono">{shortAddress(me.wallet_address)}</span>. Linking a new
                  wallet replaces it.
                </div>
              )}
              <p className="t-caption muted" style={{ margin: 0 }}>
                Linking is free. You sign a message to prove you own the wallet. No transaction is sent.
              </p>
              {!presale.data && !presale.error ? (
                <Skeleton height={44} />
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
      {step === 1 && nonce && (
        <Card>
          <div className="stack">
            <div className="between">
              <span className="t-caption muted">Connected wallet</span>
              <span className="mono">{shortAddress(address)}</span>
            </div>
            <div className="stack-8">
              <span className="t-caption muted">You will sign this exact message:</span>
              <div className="message-box mono">{nonce.message}</div>
            </div>
            <Button block loading={busy} onClick={sign}>
              Sign message
            </Button>
            <Button variant="ghost" block disabled={busy} onClick={useOther}>
              Use a different wallet
            </Button>
            {error && <span className="field-error">{error}</span>}
          </div>
        </Card>
      )}
      {step === 2 && (
        <Card>
          <div className="empty">
            <CircleCheck size={40} strokeWidth={1.75} className="c-success" />
            <div className="t-h2" style={{ color: "var(--text)" }}>
              Wallet linked
            </div>
            <span className="mono">{shortAddress(address)}</span>
            <Button block onClick={onClose}>
              Done
            </Button>
          </div>
        </Card>
      )}
    </Flow>
  );
}
