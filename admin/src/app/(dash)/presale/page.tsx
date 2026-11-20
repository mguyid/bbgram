"use client";

import { useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Camera, Coins, RotateCcw, Save, Send, Users } from "lucide-react";
import { api, useGet } from "@/lib/api";
import { useAdmin, useCanEdit } from "@/lib/auth";
import { formatDate, formatNumber, formatWei } from "@/lib/format";
import type { Settings } from "@/lib/types";
import {
  Addr,
  ConfirmButton,
  DateCell,
  EmptyRow,
  ErrorBox,
  Loading,
  PageHeader,
  Stat,
  SuccessBox,
  UserCell,
} from "@/components/ui";

// Wallet + chain libraries load only when the credit panel is shown.
const PresaleCredit = dynamic(() => import("@/components/contracts/PresaleCredit"), {
  ssr: false,
  loading: () => <Loading />,
});

type Status = "upcoming" | "live" | "paused" | "ended" | "closed";
type Summary = {
  status: Status;
  start_at: string | null;
  end_at: string | null;
  paused: boolean;
  raised_wei: string;
  counted_wei: string;
  tokens_wei: string;
  contributors: number;
  hard_cap_wei: string;
  tokens_per_usdt_wei: string;
  min_wei: string;
  max_wei: string;
  presale_wallet: string | null;
  closed_at: string | null;
  credited: number;
  last_block: number | null;
};
type Allocation = {
  wallet_address: string;
  user_id: number | null;
  username: string | null;
  contributed_wei: string;
  counted_wei: string;
  tokens_wei: string;
  credited_tx: string | null;
};
type Allocations = {
  closed: boolean;
  closed_at: string | null;
  total_usdt_wei: string;
  total_tokens_wei: string;
  items: Allocation[];
};
type Contribution = {
  wallet_address: string;
  user_id: number | null;
  amount_wei: string;
  tx_hash: string;
  block_number: number;
  created_at: string;
};
type Config = Record<string, boolean | number | string>;

const STATUS_BADGE: Record<Status, string> = {
  upcoming: "blue",
  live: "green",
  paused: "amber",
  ended: "plain",
  closed: "plain",
};

/** ISO UTC → value for a datetime-local input (the admin's local time). */
function toLocalInput(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- terms ----------

type Terms = { price: string; cap: string; min: string; max: string; start: string; end: string; paused: boolean };

function termsOf(c: Config): Terms {
  const s = (k: string) => (c[k] === undefined || c[k] === null ? "" : String(c[k]));
  return {
    price: s("presale_tokens_per_usdt"),
    cap: s("presale_hard_cap_usdt"),
    min: s("presale_min_usdt"),
    max: s("presale_max_usdt"),
    start: toLocalInput(c.presale_start_at),
    end: toLocalInput(c.presale_end_at),
    paused: c.presale_paused === true,
  };
}

function TermsForm({ config, closed, onSaved }: { config: Config; closed: boolean; onSaved: () => void }) {
  const canEdit = useCanEdit();
  const initial = termsOf(config);
  const [t, setT] = useState<Terms>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const disabled = !canEdit || closed || busy;
  const dirty = (Object.keys(t) as (keyof Terms)[]).some((k) => t[k] !== initial[k]);
  const set = (patch: Partial<Terms>) => setT({ ...t, ...patch });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const fail = (err: string) => setMsg({ err });
    const body: Config = {};
    if (t.price !== initial.price) {
      const v = t.price.trim();
      if (v && (!/^\d+(\.\d{1,18})?$/.test(v) || Number(v) <= 0)) return fail("Price: enter tokens per 1 USDT, like 100 or 0.5.");
      body.presale_tokens_per_usdt = v;
    }
    const whole: [keyof Terms, string, string][] = [
      ["cap", "presale_hard_cap_usdt", "Hard cap"],
      ["min", "presale_min_usdt", "Minimum"],
      ["max", "presale_max_usdt", "Maximum"],
    ];
    for (const [k, key, label] of whole) {
      if (t[k] === initial[k]) continue;
      const v = String(t[k]).trim();
      if (!/^\d+$/.test(v)) return fail(`${label}: enter a whole number of USDT.`);
      body[key] = Number(v);
    }
    if (Number(t.min) > Number(t.max)) return fail("Minimum cannot be higher than the per-wallet maximum.");
    const iso = (v: string) => (v ? new Date(v).toISOString() : "");
    if (t.start && t.end && new Date(t.start) >= new Date(t.end)) return fail("Start must be before end.");
    if (t.start !== initial.start) body.presale_start_at = iso(t.start);
    if (t.end !== initial.end) body.presale_end_at = iso(t.end);
    if (t.paused !== initial.paused) body.presale_paused = t.paused;

    setBusy(true);
    setMsg({});
    try {
      await api("/config", { method: "PUT", body });
      setMsg({ ok: "Saved." });
      onSaved();
    } catch (err) {
      setMsg({ err: (err as Error).message });
    }
    setBusy(false);
  };

  const price = Number(t.price);
  return (
    <form className="card stack" onSubmit={save}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h3>Terms</h3>
          <p>
            {closed
              ? "Locked: the presale is closed. Reopen it to change the terms."
              : "Shown to buyers in the mini app. The price sets each buyer's estimated tokens and is frozen by the snapshot."}
          </p>
        </div>
      </div>
      <div className="inline">
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          <span>
            Tokens per 1 USDT{" "}
            {price > 0 && <span className="muted">— ${(1 / price).toPrecision(4)} per token</span>}
          </span>
          <input value={t.price} disabled={disabled} placeholder="100" onChange={(e) => set({ price: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          <span>
            Hard cap (USDT) <span className="muted">— 0 = no cap</span>
          </span>
          <input value={t.cap} disabled={disabled} inputMode="numeric" onChange={(e) => set({ cap: e.target.value })} />
        </label>
      </div>
      <div className="inline">
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          <span>Minimum per purchase (USDT)</span>
          <input value={t.min} disabled={disabled} inputMode="numeric" onChange={(e) => set({ min: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          <span>
            Maximum per wallet (USDT) <span className="muted">— anything above is not counted</span>
          </span>
          <input value={t.max} disabled={disabled} inputMode="numeric" onChange={(e) => set({ max: e.target.value })} />
        </label>
      </div>
      <div className="inline">
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          <span>Start (your local time)</span>
          <input type="datetime-local" value={t.start} disabled={disabled} onChange={(e) => set({ start: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          <span>End (your local time)</span>
          <input type="datetime-local" value={t.end} disabled={disabled} onChange={(e) => set({ end: e.target.value })} />
        </label>
      </div>
      <label className="field inline">
        <input type="checkbox" checked={t.paused} disabled={disabled} onChange={(e) => set({ paused: e.target.checked })} />
        <span>Paused — buying is switched off in the mini app</span>
      </label>
      <SuccessBox message={msg.ok} />
      <ErrorBox error={msg.err} />
      {canEdit && !closed && (
        <div>
          <button className="btn primary" type="submit" disabled={busy || !dirty}>
            <Save size={16} /> {busy ? "Saving…" : "Save terms"}
          </button>
        </div>
      )}
    </form>
  );
}

// ---------- page ----------

export default function PresalePage() {
  const canEdit = useCanEdit();
  const isOwner = useAdmin()?.role === "owner";
  const summary = useGet<Summary>("/presale");
  const config = useGet<Config>("/config");
  const alloc = useGet<Allocations>("/presale/allocations");
  const contrib = useGet<{ raised_wei: string; items: Contribution[] }>("/presale/contributions");
  const settings = useGet<Settings>("/settings");

  const reloadAll = () => {
    summary.reload();
    config.reload();
    alloc.reload();
    contrib.reload();
  };

  const s = summary.data;
  const a = alloc.data;
  const closed = s?.status === "closed" || !!a?.closed;
  const uncredited = (a?.items ?? []).filter((i) => !i.credited_tx);

  return (
    <>
      <PageHeader
        title="Presale"
        description="Buyers send USDT straight to the presale wallet. Set the terms, watch contributions, take the snapshot to close, then send buyers their tokens after launch."
      />
      <ErrorBox error={summary.error} />
      {!s && !summary.error && <Loading />}
      {s && (
        <>
          <div className="grid" style={{ marginBottom: 14 }}>
            <Stat
              label="Status"
              value={<span className={`badge ${STATUS_BADGE[s.status]}`}>{s.status}</span>}
              sub={s.closed_at ? `Snapshot ${formatDate(s.closed_at)}` : s.end_at ? `Ends ${formatDate(s.end_at)}` : "No dates set"}
            />
            <Stat
              label="Raised"
              icon={Coins}
              value={
                <>
                  {formatWei(s.raised_wei, 2)} <span className="stat-sub">USDT</span>
                </>
              }
              sub={
                BigInt(s.hard_cap_wei || "0") > 0n
                  ? `of ${formatWei(s.hard_cap_wei, 2)} cap · ${formatWei(s.counted_wei, 2)} counted`
                  : `${formatWei(s.counted_wei, 2)} counted · no cap`
              }
            />
            <Stat label="Paying wallets" icon={Users} value={formatNumber(s.contributors)} />
            <Stat
              label={closed ? "Tokens allocated" : "Tokens (estimate)"}
              icon={Send}
              value={formatWei(s.tokens_wei, 2)}
              sub={closed ? `${formatNumber(s.credited)} of ${formatNumber(a?.items.length ?? 0)} wallets credited` : "Frozen by the snapshot"}
            />
          </div>
          <div className="card" style={{ marginBottom: 14 }}>
            <dl className="kv">
              <dt>Presale wallet</dt>
              <dd>
                {s.presale_wallet ? (
                  <Addr value={s.presale_wallet} full />
                ) : (
                  <span className="muted">
                    Not set. Add it under <Link href="/settings#presale">Settings → Presale</Link>.
                  </span>
                )}
              </dd>
              <dt>Last indexed block</dt>
              <dd>{s.last_block ?? <span className="muted">—</span>}</dd>
            </dl>
          </div>
        </>
      )}

      <ErrorBox error={config.error} />
      {/* key remounts the form with fresh values after each load */}
      {config.data && (
        <TermsForm key={JSON.stringify(config.data)} config={config.data} closed={closed} onSaved={reloadAll} />
      )}

      <h2>
        Allocations <span className="badge plain">{a?.items.length ?? 0}</span>
      </h2>
      <ErrorBox error={alloc.error} />
      {a && (
        <>
          <div className="card row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div className="stack" style={{ gap: 4 }}>
              <div>
                {a.closed ? (
                  <>
                    <strong>Presale closed.</strong> Snapshot taken {formatDate(a.closed_at)}. These allocations are final.
                  </>
                ) : (
                  <>
                    <strong>Live preview.</strong> One row per paying wallet at the current price. Taking the snapshot
                    freezes these amounts and closes the presale.
                  </>
                )}
              </div>
              <div className="muted small">
                {formatWei(a.total_usdt_wei, 2)} USDT counted · {formatWei(a.total_tokens_wei, 2)} tokens
              </div>
            </div>
            {canEdit && !a.closed && (
              <ConfirmButton
                label={
                  <>
                    <Camera size={14} /> Close presale (take snapshot)
                  </>
                }
                title="Close the presale and take the snapshot?"
                message={
                  <>
                    Freezes {formatNumber(a.items.length)} allocations ({formatWei(a.total_tokens_wei, 2)} tokens) at the
                    current price and stops buying in the mini app. USDT sent after this is not counted.
                  </>
                }
                confirmLabel="Close presale"
                onConfirm={async () => {
                  await api("/presale/close", { method: "POST" });
                  reloadAll();
                }}
              />
            )}
            {isOwner && a.closed && (
              <ConfirmButton
                label={
                  <>
                    <RotateCcw size={14} /> Reopen
                  </>
                }
                title="Reopen the presale?"
                message="Deletes the snapshot so buying can continue. Not possible once any buyer has been credited."
                confirmLabel="Reopen"
                disabled={(s?.credited ?? 0) > 0}
                onConfirm={async () => {
                  await api("/presale/reopen", { method: "POST" });
                  reloadAll();
                }}
              />
            )}
          </div>

          {a.closed &&
            (settings.data ? (
              <div style={{ marginBottom: 12 }}>
                <PresaleCredit
                  settings={settings.data}
                  items={uncredited.map((i) => ({ wallet_address: i.wallet_address, tokens_wei: i.tokens_wei }))}
                  canEdit={canEdit}
                  onCredited={reloadAll}
                />
              </div>
            ) : (
              <ErrorBox error={settings.error} />
            ))}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>User</th>
                  <th className="num">Sent (USDT)</th>
                  <th className="num">Counted (USDT)</th>
                  <th className="num">Tokens</th>
                  <th>Credited</th>
                </tr>
              </thead>
              <tbody>
                {a.items.map((i) => (
                  <tr key={i.wallet_address}>
                    <td>
                      <Addr value={i.wallet_address} />
                    </td>
                    <td>
                      {i.user_id ? <UserCell id={i.user_id} username={i.username} /> : <span className="faint">—</span>}
                    </td>
                    <td className="num">
                      {formatWei(i.contributed_wei, 2)}{" "}
                      {i.contributed_wei !== i.counted_wei && <span className="badge amber">over max</span>}
                    </td>
                    <td className="num">{formatWei(i.counted_wei, 2)}</td>
                    <td className="num">
                      <strong>{formatWei(i.tokens_wei, 2)}</strong>
                    </td>
                    <td>
                      {i.credited_tx ? (
                        <Addr value={i.credited_tx} />
                      ) : (
                        <span className="faint">{a.closed ? "not yet" : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!a.items.length && (
                  <EmptyRow cols={6} title="No buyers yet" text="Wallets appear here once they send USDT to the presale wallet." />
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Contributions</h2>
      <ErrorBox error={contrib.error} />
      {contrib.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>User</th>
                <th className="num">Amount (USDT)</th>
                <th>Tx</th>
                <th className="num">Block</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {contrib.data.items.map((c) => (
                <tr key={c.tx_hash + c.wallet_address + c.amount_wei}>
                  <td>
                    <Addr value={c.wallet_address} />
                  </td>
                  <td>{c.user_id ? <UserCell id={c.user_id} /> : <span className="faint">—</span>}</td>
                  <td className="num">
                    <strong>{formatWei(c.amount_wei, 2)}</strong>
                  </td>
                  <td>
                    <Addr value={c.tx_hash} />
                  </td>
                  <td className="num muted">{c.block_number}</td>
                  <td>
                    <DateCell value={c.created_at} />
                  </td>
                </tr>
              ))}
              {!contrib.data.items.length && (
                <EmptyRow cols={6} title="No contributions yet" text="Transfers appear once the indexer sees them on chain." />
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
