"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import { Ban, ShieldAlert, ShieldCheck, UserCheck } from "lucide-react";
import { Addr, ConfirmButton, ErrorBox, Loading, ObjTable, PageHeader, RiskBadge, SuccessBox } from "@/components/ui";
import type { UserRow } from "@/lib/types";

type Referrer = { id: number; username?: string | null; telegram_id?: number };

type UserDetail = UserRow & {
  first_name?: string | null;
  referral_code?: string | null;
  point_events: Record<string, unknown>[];
  risk_reasons: unknown[];
  devices: Record<string, unknown>[];
  referrals: Record<string, unknown>[];
  referrer: Referrer | null;
  [k: string]: unknown;
};

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canEdit = useCanEdit();
  const { data: u, error, reload } = useGet<UserDetail>(`/users/${id}`);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [adjustMsg, setAdjustMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);

  const adjust = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0) {
      setAdjustMsg({ err: "Amount must be a non-zero whole number (negative to deduct)." });
      return;
    }
    setBusy(true);
    setAdjustMsg({});
    try {
      await api(`/users/${id}/adjust`, { method: "POST", body: { amount: n, reason: reason.trim() } });
      setAmount("");
      setReason("");
      setAdjustMsg({ ok: `Adjusted by ${n > 0 ? "+" : ""}${n} points.` });
      reload();
    } catch (err) {
      setAdjustMsg({ err: (err as Error).message });
    }
    setBusy(false);
  };

  if (error && !u) return <ErrorBox error={error} />;
  if (!u) return <Loading />;

  return (
    <>
      <PageHeader
        back={{ href: "/users", label: "Users" }}
        title={u.username ? `@${u.username}` : `User ${u.id}`}
        badge={u.banned ? <span className="badge red">Banned</span> : <span className="badge green">Active</span>}
        description={
          <>
            {u.first_name ? `${u.first_name} · ` : ""}Telegram {u.telegram_id} · joined {formatDate(u.created_at)}
          </>
        }
        actions={
          canEdit &&
          (u.banned ? (
            <ConfirmButton
              label={
                <>
                  <UserCheck size={16} /> Unban
                </>
              }
              className="btn"
              title="Unban this user?"
              message="The user can earn points again and appears on the leaderboard."
              confirmLabel="Unban"
              danger={false}
              onConfirm={async () => {
                await api(`/users/${id}/unban`, { method: "POST" });
                reload();
              }}
            />
          ) : (
            <ConfirmButton
              label={
                <>
                  <Ban size={16} /> Ban user
                </>
              }
              title="Ban this user?"
              message="Freezes earning and hides the user from the leaderboard."
              confirmLabel="Ban"
              askReason
              onConfirm={async (r) => {
                await api(`/users/${id}/ban`, { method: "POST", body: { reason: r } });
                reload();
              }}
            />
          ))
        }
      />
      <ErrorBox error={error} />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
        <div className="card">
          <div className="card-head">
            <h3>Profile</h3>
          </div>
          <dl className="kv">
            <dt>ID</dt>
            <dd>{u.id}</dd>
            <dt>Telegram ID</dt>
            <dd>{u.telegram_id}</dd>
            {u.first_name && (
              <>
                <dt>Name</dt>
                <dd>{u.first_name}</dd>
              </>
            )}
            <dt>Balance</dt>
            <dd>
              <strong>{formatNumber(u.balance)}</strong> <span className="muted">points</span>
            </dd>
            <dt>Wallet</dt>
            <dd>
              <Addr value={u.wallet_address} />
            </dd>
            <dt>X</dt>
            <dd>{u.x_username ? `@${u.x_username}` : <span className="faint">—</span>}</dd>
            <dt>Referrer</dt>
            <dd>
              {u.referrer ? (
                <Link href={`/users/${u.referrer.id}`}>
                  {u.referrer.username ? `@${u.referrer.username}` : `User ${u.referrer.id}`}
                </Link>
              ) : (
                <span className="faint">—</span>
              )}
            </dd>
            <dt>Joined</dt>
            <dd>{formatDate(u.created_at)}</dd>
          </dl>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Risk</h3>
            <RiskBadge score={u.risk_score} />
          </div>
          {u.risk_reasons?.length ? (
            <ul className="stack" style={{ margin: 0, padding: 0, listStyle: "none", gap: 8 }}>
              {u.risk_reasons.map((r, i) => (
                <li key={i} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <ShieldAlert size={15} className="bad" style={{ marginTop: 3, flexShrink: 0 }} />
                  <span>{typeof r === "string" ? r : JSON.stringify(r)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="row muted">
              <ShieldCheck size={15} className="ok" /> No risk signals.
            </div>
          )}
        </div>

        {canEdit && (
          <form className="card stack" onSubmit={adjust}>
            <div>
              <h3>Adjust points</h3>
              <p className="muted small">Credit or deduct points. The reason is written to the audit log.</p>
            </div>
            <label className="field">
              <span>Amount (negative to deduct)</span>
              <input type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
            <label className="field">
              <span>Reason</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} required />
            </label>
            <SuccessBox message={adjustMsg.ok} />
            <ErrorBox error={adjustMsg.err} />
            <div>
              <button className="btn primary" type="submit" disabled={busy || !reason.trim() || !amount}>
                {busy ? "Applying…" : "Apply adjustment"}
              </button>
            </div>
          </form>
        )}
      </div>

      <h2>Point events</h2>
      <ObjTable rows={u.point_events ?? []} empty="No point events." />

      <h2>Devices</h2>
      <ObjTable rows={u.devices ?? []} empty="No devices recorded." />

      <h2>
        Referrals <span className="badge plain">{u.referrals?.length ?? 0}</span>
      </h2>
      <ObjTable rows={u.referrals ?? []} userLinkKeys={["id", "user_id"]} empty="No referrals." />
    </>
  );
}
