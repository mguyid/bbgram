"use client";

import { useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Camera, Coins, Pause, Play, RotateCcw, Save, Send, Trash2, Users } from "lucide-react";
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
  progress_wei: string;
  progress_target_wei: string;
  progress_reset_at: string | null;
  simulated_wei: string;
  sim_running: boolean;
};
type Simulated = {
  running: boolean;
  count: number;
  total_wei: string;
  next_at: string | null;
  items: { id: number; wallet_address: string; amount_wei: string; created_at: string }[];
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

// ---------- progress bar (display only) ----------

function percentOf(part: string, whole: string): number {
  const w = BigInt(whole || "0");
  if (w <= 0n) return 0;
  return Math.min(100, Number((BigInt(part || "0") * 10000n) / w) / 100);
}

function ProgressPanel({ summary, config, onChanged }: { summary: Summary; config: Config; onChanged: () => void }) {
  const canEdit = useCanEdit();
  const initial = String(config.presale_progress_target_usdt ?? 0);
  const [target, setTarget] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const pct = percentOf(summary.progress_wei, summary.progress_target_wei);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const v = target.trim();
    if (!/^\d+$/.test(v)) return setMsg({ err: "Target: enter a whole number of USDT (0 = use the hard cap)." });
    setBusy(true);
    setMsg({});
    try {
      await api("/config", { method: "PUT", body: { presale_progress_target_usdt: Number(v) } });
      setMsg({ ok: "Saved." });
      onChanged();
    } catch (err) {
      setMsg({ err: (err as Error).message });
    }
    setBusy(false);
  };

  return (
    <form className="card stack" onSubmit={save}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h3>Progress bar</h3>
          <p>
            The bar on the mini app&apos;s Presale screen. It fills with contributions (real and simulated) since the
            last reset. Display only: resetting never changes contributions, totals or allocations.
          </p>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>
            {formatWei(summary.progress_wei, 2)} / {formatWei(summary.progress_target_wei, 2)} USDT
          </strong>
          <span className="muted">{pct.toFixed(1)}%</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="muted small">
          {summary.progress_reset_at ? `Counting since the reset on ${formatDate(summary.progress_reset_at)}.` : "Never reset."}
          {BigInt(summary.progress_target_wei || "0") === 0n && " Set a target or a hard cap to fill the bar."}
        </div>
      </div>
      <label className="field" style={{ maxWidth: 320 }}>
        <span>
          Target (USDT) <span className="muted">— 0 = use the hard cap</span>
        </span>
        <input value={target} disabled={!canEdit || busy} inputMode="numeric" onChange={(e) => setTarget(e.target.value)} />
      </label>
      <SuccessBox message={msg.ok} />
      <ErrorBox error={msg.err} />
      {canEdit && (
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || target === initial}>
            <Save size={16} /> {busy ? "Saving…" : "Save target"}
          </button>
          <ConfirmButton
            label={
              <>
                <RotateCcw size={14} /> Reset progress
              </>
            }
            title="Reset the progress bar?"
            message="The bar restarts at 0 and counts only contributions from now on. Contributions, totals, allocations and the snapshot are not changed."
            confirmLabel="Reset progress"
            onConfirm={async () => {
              await api("/presale/progress/reset", { method: "POST" });
              onChanged();
            }}
          />
        </div>
      )}
    </form>
  );
}

// ---------- simulated contributions ----------

type SimForm = { min: string; max: string; minS: string; maxS: string; cap: string };

function simFormOf(c: Config): SimForm {
  const s = (k: string) => String(c[k] ?? "");
  return {
    min: s("presale_sim_min_usdt"),
    max: s("presale_sim_max_usdt"),
    minS: s("presale_sim_min_seconds"),
    maxS: s("presale_sim_max_seconds"),
    cap: s("presale_sim_cap_usdt"),
  };
}

function SimulationPanel({ config, onChanged }: { config: Config; onChanged: () => void }) {
  const canEdit = useCanEdit();
  const sim = useGet<Simulated>("/presale/simulated");
  const running = config.presale_sim_running === true;
  const initial = simFormOf(config);
  const [f, setF] = useState<SimForm>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const dirty = (Object.keys(f) as (keyof SimForm)[]).some((k) => f[k] !== initial[k]);
  const set = (patch: Partial<SimForm>) => setF({ ...f, ...patch });

  const put = async (body: Config, ok: string) => {
    setBusy(true);
    setMsg({});
    try {
      await api("/config", { method: "PUT", body });
      setMsg({ ok });
      onChanged();
      sim.reload();
    } catch (err) {
      setMsg({ err: (err as Error).message });
    }
    setBusy(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const fields: [keyof SimForm, string, string][] = [
      ["min", "presale_sim_min_usdt", "Minimum amount"],
      ["max", "presale_sim_max_usdt", "Maximum amount"],
      ["minS", "presale_sim_min_seconds", "Minimum interval"],
      ["maxS", "presale_sim_max_seconds", "Maximum interval"],
      ["cap", "presale_sim_cap_usdt", "Cap"],
    ];
    const body: Config = {};
    for (const [k, key, label] of fields) {
      const v = f[k].trim();
      if (!/^\d+$/.test(v)) return setMsg({ err: `${label}: enter a whole number.` });
      body[key] = Number(v);
    }
    if (Number(f.min) > Number(f.max)) return setMsg({ err: "The minimum amount cannot be above the maximum." });
    if (Number(f.minS) < 1) return setMsg({ err: "The minimum interval must be at least 1 second." });
    if (Number(f.minS) > Number(f.maxS)) return setMsg({ err: "The minimum interval cannot be above the maximum." });
    await put(body, "Saved.");
  };

  const d = sim.data;
  return (
    <form className="card stack" onSubmit={save}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h3>
            Simulated contributions{" "}
            <span className={`badge ${running ? "green" : "plain"}`}>{running ? "running" : "stopped"}</span>
          </h3>
          <p>
            While running, adds a contribution of a random amount at random intervals within the ranges below. They show in
            the mini app&apos;s recent contributions list (tagged &quot;Simulated&quot;) and move the progress bar. They are
            never counted as raised, toward the hard cap, allocations, the snapshot or crediting.
          </p>
        </div>
      </div>
      <div className="inline">
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          <span>Min amount (USDT)</span>
          <input value={f.min} disabled={!canEdit || busy} inputMode="numeric" onChange={(e) => set({ min: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          <span>Max amount (USDT)</span>
          <input value={f.max} disabled={!canEdit || busy} inputMode="numeric" onChange={(e) => set({ max: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          <span>Min interval (seconds)</span>
          <input value={f.minS} disabled={!canEdit || busy} inputMode="numeric" onChange={(e) => set({ minS: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          <span>Max interval (seconds)</span>
          <input value={f.maxS} disabled={!canEdit || busy} inputMode="numeric" onChange={(e) => set({ maxS: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          <span>
            Total cap (USDT) <span className="muted">— 0 = none</span>
          </span>
          <input value={f.cap} disabled={!canEdit || busy} inputMode="numeric" onChange={(e) => set({ cap: e.target.value })} />
        </label>
      </div>
      <SuccessBox message={msg.ok} />
      <ErrorBox error={msg.err} />
      {canEdit && (
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || !dirty}>
            <Save size={16} /> Save ranges
          </button>
          {running ? (
            <button className="btn" type="button" disabled={busy} onClick={() => put({ presale_sim_running: false }, "Stopped.")}>
              <Pause size={16} /> Stop
            </button>
          ) : (
            <button
              className="btn"
              type="button"
              disabled={busy || dirty}
              title={dirty ? "Save the ranges first" : undefined}
              onClick={() => put({ presale_sim_running: true }, "Started. The first one is added after a random interval.")}
            >
              <Play size={16} /> Start
            </button>
          )}
          <ConfirmButton
            label={
              <>
                <Trash2 size={14} /> Clear simulated
              </>
            }
            title="Delete all simulated contributions?"
            message="Removes them from the mini app's list and the progress bar. Real contributions are not touched."
            confirmLabel="Delete"
            disabled={!d?.count}
            onConfirm={async () => {
              await api("/presale/simulated", { method: "DELETE" });
              sim.reload();
              onChanged();
            }}
          />
        </div>
      )}
      <ErrorBox error={sim.error} />
      {d && (
        <>
          <div className="muted small">
            {formatNumber(d.count)} simulated · {formatWei(d.total_wei, 2)} USDT
            {d.next_at && <> · next around {formatDate(d.next_at)}</>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Wallet (random)</th>
                  <th className="num">Amount (USDT)</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {d.items.slice(0, 20).map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Addr value={i.wallet_address} />
                    </td>
                    <td className="num">{formatWei(i.amount_wei, 2)}</td>
                    <td>
                      <DateCell value={i.created_at} />
                    </td>
                  </tr>
                ))}
                {!d.items.length && <EmptyRow cols={3} title="None yet" text="Start the simulation to add some." />}
              </tbody>
            </table>
          </div>
        </>
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
      {config.data && s && (
        <div style={{ marginTop: 14 }}>
          <ProgressPanel
            key={`progress-${config.data.presale_progress_target_usdt}`}
            summary={s}
            config={config.data}
            onChanged={reloadAll}
          />
        </div>
      )}
      {config.data && (
        <div style={{ marginTop: 14 }}>
          <SimulationPanel key={`sim-${JSON.stringify(simFormOf(config.data))}`} config={config.data} onChanged={reloadAll} />
        </div>
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
