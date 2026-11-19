"use client";

import { Pause, Play } from "lucide-react";
import { api, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { formatNumber, formatWei } from "@/lib/format";
import { ConfirmButton, ErrorBox, Stat } from "@/components/ui";

type Stats = {
  users: number;
  users_today: number;
  points_total: number;
  wallets_linked: number;
  activity_paused: boolean;
  presale: { raised_wei: string; contributors: number };
};

export default function OverviewPage() {
  const canEdit = useCanEdit();
  const { data, error, reload } = useGet<Stats>("/stats");

  return (
    <>
      <h1>Overview</h1>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="grid">
            <Stat label="Users" value={formatNumber(data.users)} sub={`+${formatNumber(data.users_today)} today`} />
            <Stat label="Points issued" value={formatNumber(data.points_total)} />
            <Stat label="Wallets linked" value={formatNumber(data.wallets_linked)} />
            <Stat
              label="Presale raised (USDT)"
              value={formatWei(data.presale?.raised_wei, 2)}
              sub={`${formatNumber(data.presale?.contributors)} contributors`}
            />
          </div>

          <h2>Activity</h2>
          <div className="card row" style={{ justifyContent: "space-between" }}>
            <div>
              Earning is{" "}
              {data.activity_paused ? (
                <span className="badge red">paused</span>
              ) : (
                <span className="badge green">running</span>
              )}
              <div className="muted small" style={{ marginTop: 4 }}>
                Pause stops all earning (spins, referrals, X, daily jobs). Snapshots can only be taken while paused.
              </div>
            </div>
            {canEdit &&
              (data.activity_paused ? (
                <ConfirmButton
                  label={
                    <>
                      <Play size={16} /> Resume
                    </>
                  }
                  title="Resume activity?"
                  message="Users will start earning points again."
                  confirmLabel="Resume"
                  danger={false}
                  className="btn primary"
                  onConfirm={async () => {
                    await api("/resume", { method: "POST" });
                    reload();
                  }}
                />
              ) : (
                <ConfirmButton
                  label={
                    <>
                      <Pause size={16} /> Pause
                    </>
                  }
                  title="Pause all activity?"
                  message="All earning stops for every user until you resume."
                  confirmLabel="Pause"
                  onConfirm={async () => {
                    await api("/pause", { method: "POST" });
                    reload();
                  }}
                />
              ))}
          </div>
        </>
      )}
    </>
  );
}
