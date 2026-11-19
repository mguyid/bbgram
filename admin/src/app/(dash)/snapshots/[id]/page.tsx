"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import type { Airdrop } from "@/lib/types";
import { AirdropPanel } from "@/components/airdrop";
import { Calculator, Hammer } from "lucide-react";
import { Addr, ConfirmButton, EmptyRow, ErrorBox, Loading, PageHeader, RiskBadge, Stat, UserCell } from "@/components/ui";

type Item = {
  user_id: number;
  username: string | null;
  wallet_address: string | null;
  points: number;
  risk_score: number | null;
  excluded: boolean;
  exclusion_reason: string | null;
};
type Snapshot = { id: number; created_at: string; total_points: number; items: Item[] };
type Preview = {
  total_points: number;
  recipients: number;
  total_tokens: string;
  items: { user_id: number; wallet_address: string; points: number; amount: string }[];
};
type Conversion = { pool_tokens: string; min_points?: number; per_user_cap_tokens?: string };

export default function SnapshotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canEdit = useCanEdit();
  const { data: snap, error, reload } = useGet<Snapshot>(`/snapshots/${id}`);
  const [onlyExcluded, setOnlyExcluded] = useState(false);
  const [toggleErr, setToggleErr] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  const [form, setForm] = useState({ pool: "", min: "", cap: "" });
  const [preview, setPreview] = useState<{ body: Conversion; data: Preview } | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [airdrop, setAirdrop] = useState<Airdrop | null>(null);

  const toggle = async (item: Item) => {
    setPending(item.user_id);
    setToggleErr(null);
    try {
      await api(`/snapshots/${id}/exclusions`, {
        method: "POST",
        body: { user_id: item.user_id, excluded: !item.excluded },
      });
      setPreview(null); // amounts changed
      reload();
    } catch (err) {
      setToggleErr((err as Error).message);
    }
    setPending(null);
  };

  const runPreview = async (e: FormEvent) => {
    e.preventDefault();
    const body: Conversion = { pool_tokens: form.pool.trim() };
    if (form.min.trim()) body.min_points = Number(form.min);
    if (form.cap.trim()) body.per_user_cap_tokens = form.cap.trim();
    setBusy(true);
    setPreviewErr(null);
    setPreview(null);
    try {
      const data = await api<Preview>(`/snapshots/${id}/preview`, { method: "POST", body });
      setPreview({ body, data });
    } catch (err) {
      setPreviewErr((err as Error).message);
    }
    setBusy(false);
  };

  if (error && !snap) return <ErrorBox error={error} />;
  if (!snap) return <Loading />;

  const excludedCount = snap.items.filter((i) => i.excluded).length;
  const rows = onlyExcluded ? snap.items.filter((i) => i.excluded) : snap.items;

  return (
    <>
      <PageHeader
        back={{ href: "/snapshots", label: "Snapshots" }}
        title={`Snapshot #${snap.id}`}
        description={`Taken ${formatDate(snap.created_at)}`}
      />
      <div className="grid">
        <Stat label="Total points (included)" value={formatNumber(snap.total_points)} />
        <Stat label="Included users" value={formatNumber(snap.items.length - excludedCount)} />
        <Stat
          label="Excluded users"
          value={formatNumber(excludedCount)}
          sub="Risk, bans and missing wallets"
        />
      </div>

      <h2>Conversion</h2>
      {canEdit ? (
        <form className="inline card" onSubmit={runPreview}>
          <label className="field">
            <span>Pool (tokens)</span>
            <input
              inputMode="decimal"
              value={form.pool}
              onChange={(e) => setForm({ ...form, pool: e.target.value })}
              required
              pattern="[0-9]+(\.[0-9]+)?"
              placeholder="1000000"
            />
          </label>
          <label className="field">
            <span>Min points (optional)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={form.min}
              onChange={(e) => setForm({ ...form, min: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Per-user cap, tokens (optional)</span>
            <input
              inputMode="decimal"
              pattern="[0-9]+(\.[0-9]+)?"
              value={form.cap}
              onChange={(e) => setForm({ ...form, cap: e.target.value })}
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            <Calculator size={16} /> {busy ? "Calculating…" : "Preview"}
          </button>
        </form>
      ) : (
        <div className="notice">Viewers cannot build airdrops.</div>
      )}
      <ErrorBox error={previewErr} />

      {preview && (
        <div className="section stack">
          <div className="grid">
            <Stat label="Recipients" value={formatNumber(preview.data.recipients)} />
            <Stat label="Total points" value={formatNumber(preview.data.total_points)} />
            <Stat label="Total tokens" value={preview.data.total_tokens} />
          </div>
          {!airdrop && (
            <div>
              <ConfirmButton
                label={
                  <>
                    <Hammer size={16} /> Build airdrop
                  </>
                }
                className="btn primary"
                title="Build airdrop?"
                message={
                  <>
                    Builds the Merkle tree for {formatNumber(preview.data.recipients)} recipients and{" "}
                    {preview.data.total_tokens} tokens. Check the preview first.
                  </>
                }
                confirmLabel="Build"
                onConfirm={async () => {
                  const res = await api<{
                    airdrop_id: number;
                    merkle_root: string;
                    total_amount_wei: string;
                    recipients: number;
                  }>(`/snapshots/${id}/airdrop`, { method: "POST", body: preview.body });
                  setAirdrop({
                    id: res.airdrop_id,
                    merkle_root: res.merkle_root,
                    total_amount_wei: res.total_amount_wei,
                    recipients: res.recipients,
                  });
                }}
              />
            </div>
          )}
          {airdrop && <AirdropPanel airdrop={airdrop} />}
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Wallet</th>
                  <th className="num">Points</th>
                  <th className="num">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {preview.data.items.map((p) => (
                  <tr key={p.user_id}>
                    <td>
                      <Link href={`/users/${p.user_id}`}>{p.user_id}</Link>
                    </td>
                    <td>
                      <Addr value={p.wallet_address} />
                    </td>
                    <td className="num">{formatNumber(p.points)}</td>
                    <td className="num">{p.amount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>Total</th>
                  <th className="num">{formatNumber(preview.data.total_points)}</th>
                  <th className="num">{preview.data.total_tokens}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <h2>Balances</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="field inline">
          <input type="checkbox" checked={onlyExcluded} onChange={(e) => setOnlyExcluded(e.target.checked)} />
          <span>Show excluded only</span>
        </label>
      </div>
      <ErrorBox error={toggleErr} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Wallet</th>
              <th className="num">Points</th>
              <th className="num">Risk</th>
              <th>Status</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.user_id} className={i.excluded ? "excluded" : undefined}>
                <td>
                  <UserCell id={i.user_id} username={i.username} />
                </td>
                <td>
                  <Addr value={i.wallet_address} />
                </td>
                <td className="num">{formatNumber(i.points)}</td>
                <td className="num">
                  <RiskBadge score={i.risk_score} />
                </td>
                <td>
                  {i.excluded ? (
                    <span className="badge red" title={i.exclusion_reason ?? undefined}>
                      Excluded{i.exclusion_reason ? ` · ${i.exclusion_reason}` : ""}
                    </span>
                  ) : (
                    <span className="badge green">Included</span>
                  )}
                </td>
                {canEdit && (
                  <td className="actions-cell">
                    <button
                      type="button"
                      className="btn small"
                      disabled={pending === i.user_id || !!airdrop}
                      onClick={() => toggle(i)}
                    >
                      {i.excluded ? "Include" : "Exclude"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && <EmptyRow cols={6} title="No users" />}
          </tbody>
        </table>
      </div>
    </>
  );
}
