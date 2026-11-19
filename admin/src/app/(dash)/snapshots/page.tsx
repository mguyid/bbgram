"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Pause, Play } from "lucide-react";
import { api, itemsOf, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import type { Airdrop } from "@/lib/types";
import { AirdropPanel } from "@/components/airdrop";
import { DateCell, EmptyRow, EmptyState, ErrorBox, PageHeader } from "@/components/ui";

type SnapshotRow = { id: number; created_at: string; total_points: number; [k: string]: unknown };

export default function SnapshotsPage() {
  const router = useRouter();
  const canEdit = useCanEdit();
  const stats = useGet<{ activity_paused: boolean }>("/stats");
  const snaps = useGet<unknown>("/snapshots");
  const airdrops = useGet<unknown>("/airdrops");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = !!stats.data?.activity_paused;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const snap = await api<{ id: number }>("/snapshots", { method: "POST" });
      router.push(`/snapshots/${snap.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const rows = itemsOf<SnapshotRow>(snaps.data);
  const drops = itemsOf<Airdrop>(airdrops.data);

  return (
    <>
      <PageHeader
        title="Snapshots"
        description="Freeze point balances, review exclusions, then build a Merkle airdrop from the result."
        actions={
          canEdit && (
            <button type="button" className="btn primary" disabled={!paused || busy} onClick={create}>
              <Camera size={16} /> {busy ? "Creating…" : "Create snapshot"}
            </button>
          )
        }
      />
      {canEdit && (
        <div className="card status-panel" style={{ marginBottom: 20 }}>
          <div className={`status-orb ${paused ? "on" : "off"}`}>{paused ? <Pause size={20} /> : <Play size={20} />}</div>
          <div className="grow">
            <div className="status-title">
              {paused ? "Ready to snapshot" : "Earning is still running"}
            </div>
            <div className="muted small" style={{ marginTop: 2 }}>
              {paused ? (
                "Activity is paused, so balances are stable."
              ) : (
                <>
                  <Link href="/">Pause earning on Overview</Link> before taking a snapshot.
                </>
              )}{" "}
              Users at or above the risk threshold, banned users and users without a wallet are excluded automatically.
            </div>
          </div>
        </div>
      )}
      <ErrorBox error={error || stats.error || snaps.error} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Created</th>
              <th className="num">Total points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/snapshots/${s.id}`}>Snapshot #{s.id}</Link>
                </td>
                <td>
                  <DateCell value={s.created_at} />
                </td>
                <td className="num">{formatNumber(s.total_points)}</td>
              </tr>
            ))}
            {snaps.data !== undefined && !rows.length && (
              <EmptyRow cols={3} title="No snapshots yet" text="Pause earning, then create the first snapshot." />
            )}
          </tbody>
        </table>
      </div>

      <h2>Airdrops</h2>
      <ErrorBox error={airdrops.error} />
      {airdrops.data !== undefined && !drops.length && (
        <div className="table-wrap">
          <EmptyState title="No airdrops built yet" text="Open a snapshot and run a conversion preview to build one." />
        </div>
      )}
      <div className="stack">
        {drops.map((a) => (
          <div key={a.id}>
            {a.snapshot_id !== undefined && (
              <div className="small muted" style={{ marginBottom: 6 }}>
                From <Link href={`/snapshots/${a.snapshot_id}`}>snapshot #{a.snapshot_id}</Link>
                {a.created_at && ` · ${formatDate(a.created_at)}`}
              </div>
            )}
            <AirdropPanel airdrop={a} />
          </div>
        ))}
      </div>
    </>
  );
}
