"use client";

import { Check, ExternalLink, Gift } from "lucide-react";
import { useState, type ReactNode } from "react";
import { presaleReady, type Airdrop, type Presale } from "@/lib/api";
import { date, percent, shortAddress, tokenPrice, tokens, usdt } from "@/lib/format";
import { explorerTx } from "@/lib/loadWallet";
import { openLink } from "@/lib/telegram";
import type { WalletModule } from "@/lib/loadWallet";
import { useApi } from "@/lib/useApi";
import { useApp } from "../AppContext";
import { ErrorCard, ic, Screen, ScreenHeader } from "../Common";
import { runTx, TxStatus, type Tx } from "../TxStatus";
import { Button, Card, Chip, Countdown, EmptyState, ProgressBar, Skeleton, useNow } from "../ui";

const STATUS: Record<Presale["status"], { label: string; tone: "success" | "accent" | "warning" | "default" }> = {
  live: { label: "Live", tone: "success" },
  upcoming: { label: "Upcoming", tone: "accent" },
  paused: { label: "Paused", tone: "warning" },
  ended: { label: "Ended", tone: "default" },
  closed: { label: "Closed", tone: "default" },
};

export function PresaleScreen() {
  const presale = useApi<Presale>("/api/presale");
  const airdrop = useApi<Airdrop>("/api/airdrop");
  const p = presale.data;

  return (
    <Screen>
      <ScreenHeader title="Presale" />
      {!p ? (
        presale.error ? (
          presale.error.status === 404 ? (
            <Card>
              <EmptyState text="Presale details are coming soon." />
            </Card>
          ) : (
            <ErrorCard message={presale.error.message} onRetry={presale.reload} />
          )
        ) : (
          <>
            <Skeleton height={236} />
            <Skeleton height={120} />
          </>
        )
      ) : !presaleReady(p) ? (
        <Card title="Baby Grand presale" action={<Chip tone="accent">Coming soon</Chip>}>
          <EmptyState text="The presale opens soon. Details will appear here." />
        </Card>
      ) : (
        <>
          <ProgressCard p={p} onTick={presale.reload} />
          <ActionCard p={p} />
          {BigInt(p.contributed_wei || "0") > BigInt(0) && <AllocationCard p={p} />}
        </>
      )}
      {airdrop.data?.available && BigInt(airdrop.data.amount_wei || "0") > BigInt(0) && (
        <AirdropCard a={airdrop.data} chainId={p?.chain_id ?? 56} onClaimed={airdrop.reload} />
      )}
    </Screen>
  );
}

function ProgressCard({ p, onTick }: { p: Presale; onTick: () => void }) {
  const s = STATUS[p.status];
  return (
    <Card title="Baby Grand presale" action={<Chip tone={s.tone}>{s.label}</Chip>}>
      <div className="stack">
        {BigInt(p.hard_cap_wei || "0") > BigInt(0) ? (
          <ProgressBar
            value={percent(p.raised_wei, p.hard_cap_wei)}
            label="Raised"
            right={`${usdt(p.raised_wei)} / ${usdt(p.hard_cap_wei)}`}
          />
        ) : (
          <div className="between">
            <span className="t-caption muted">Raised</span>
            <span className="t-h2 num">{usdt(p.raised_wei)}</span>
          </div>
        )}
        <div className="stack-8">
          {p.status === "closed" && (
            <p className="t-caption muted" style={{ margin: 0 }}>
              The presale is closed. Allocations are final, and tokens are sent to buyers after launch.
            </p>
          )}
          {p.status === "upcoming" && p.start_at && (
            <div className="between">
              <span className="t-caption muted">Starts in</span>
              <Countdown to={p.start_at} onDone={onTick} />
            </div>
          )}
          {p.status === "live" && p.end_at && (
            <div className="between">
              <span className="t-caption muted">Ends in</span>
              <Countdown to={p.end_at} onDone={onTick} className="c-warning" />
            </div>
          )}
          <div className="between">
            <span className="t-caption muted">Price per token</span>
            <span className="t-caption num">{tokenPrice(p.tokens_per_usdt_wei) || "Coming soon"}</span>
          </div>
          <div className="between">
            <span className="t-caption muted">Per wallet</span>
            <span className="t-caption num">
              Min {usdt(p.min_wei)} · Max {usdt(p.max_wei)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ActionCard({ p }: { p: Presale }) {
  const { me, openWallet, openBuy } = useApp();
  if (p.status === "closed") return null;
  const reachedMax = BigInt(p.contributed_wei || "0") >= BigInt(p.max_wei);

  let text = "";
  let action: ReactNode = null;
  if (p.status === "ended") text = "The presale has ended. Tokens are sent to buyers after the launch.";
  else if (p.status === "paused") text = "The presale is paused. Buying is disabled for now.";
  else if (!me.wallet_address) {
    text = "Link a wallet to join the presale. You buy from that wallet, and your tokens are sent to it.";
    action = <Button onClick={openWallet}>Link wallet</Button>;
  } else if (p.status === "upcoming") {
    text = `You will buy from ${shortAddress(me.wallet_address)}. Come back when the presale opens.`;
  } else if (reachedMax) {
    text = "You reached the maximum for this wallet.";
  } else {
    text = `You buy from ${shortAddress(me.wallet_address)}, and your tokens are sent to it after launch.`;
    action = <Button onClick={openBuy}>Buy tokens</Button>;
  }
  return (
    <Card>
      <div className="stack">
        <p className="t-body" style={{ margin: 0 }}>
          {text}
        </p>
        {action}
      </div>
    </Card>
  );
}

/** Connects the wallet and checks it is the linked one before a claim. */
function linkedConnect(linked: string | null) {
  return async (w: WalletModule) => {
    const a = await w.connect();
    if (linked && a.toLowerCase() !== linked.toLowerCase()) {
      throw new w.WalletError(`Connect the wallet you linked (${shortAddress(linked)}).`);
    }
    return a;
  };
}

function AllocationCard({ p }: { p: Presale }) {
  const chainId = p.chain_id ?? 56;
  const closed = p.status === "closed";
  const over = BigInt(p.contributed_wei || "0") > BigInt(p.counted_wei || "0");
  return (
    <Card title="Your allocation" action={closed ? <Chip tone={p.credited ? "success" : "accent"}>{p.credited ? "Sent" : "Final"}</Chip> : <Chip>Estimate</Chip>}>
      <div className="stack">
        <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="card-plain stack-8" style={{ padding: 12 }}>
            <span className="t-micro muted">Paid</span>
            <span className="t-h2 num">{usdt(p.contributed_wei)}</span>
          </div>
          <div className="card-plain stack-8" style={{ padding: 12 }}>
            <span className="t-micro muted">{closed ? "Tokens" : "Est. tokens"}</span>
            <span className="t-h2 num ellipsis">{tokens(p.tokens_wei)}</span>
          </div>
        </div>
        {over && (
          <span className="t-caption c-warning">
            Only {usdt(p.counted_wei)} counts toward your allocation: the maximum is {usdt(p.max_wei)} per wallet.
          </span>
        )}
        {p.credited ? (
          <div className="stack-8">
            <span className="hrow c-success t-strong">
              <Check {...ic} /> Tokens sent to your wallet
            </span>
            {p.credited_tx && (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                style={{ alignSelf: "flex-start", paddingLeft: 0 }}
                onClick={() => openLink(explorerTx(chainId, p.credited_tx || ""))}
              >
                <span className="btn-label">
                  View on BscScan <ExternalLink size={16} strokeWidth={1.75} />
                </span>
              </button>
            )}
          </div>
        ) : (
          <span className="t-caption muted">
            {closed
              ? "The presale is closed. Your tokens are sent to your linked wallet after launch."
              : "This is an estimate. Your final allocation is fixed when the presale closes, and your tokens are sent to your linked wallet after launch."}
          </span>
        )}
      </div>
    </Card>
  );
}

function AirdropCard({ a, chainId, onClaimed }: { a: Airdrop; chainId: number; onClaimed: () => void }) {
  const { me } = useApp();
  const [tx, setTx] = useState<Tx>({ phase: "idle" });
  const busy = tx.phase === "wallet" || tx.phase === "pending";
  const now = useNow(!!a.deadline && !a.claimed);
  const expired = !!a.deadline && now > new Date(a.deadline).getTime();
  const claim = async () => {
    if (!a.airdrop_address) return;
    const addr = a.airdrop_address;
    const ok = await runTx(
      chainId,
      async (w) => {
        await linkedConnect(me.wallet_address)(w);
        return w.claimAirdrop(addr, BigInt(a.amount_wei), a.proof, chainId);
      },
      setTx,
    );
    if (ok) onClaimed();
  };
  return (
    <Card>
      <div className="stack">
        <div className="hrow">
          <div className="row-icon c-gold">
            <Gift {...ic} />
          </div>
          <div className="grow">
            <div className="t-micro muted">Airdrop</div>
            <div className="t-h2 num">{tokens(a.amount_wei)} tokens</div>
            {a.deadline && !a.claimed && !expired && (
              <div className="t-caption muted">Claim by {date(a.deadline)}</div>
            )}
          </div>
        </div>
        {a.claimed ? (
          <span className="hrow c-success t-strong">
            <Check {...ic} /> Claimed
          </span>
        ) : expired ? (
          <span className="t-caption muted">The claim period has ended.</span>
        ) : (
          <>
            <TxStatus tx={tx} chainId={chainId} success="Airdrop claimed" />
            {tx.phase !== "success" && (
              <Button block loading={busy} onClick={claim}>
                {tx.phase === "failed" ? "Try again" : "Claim"}
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
