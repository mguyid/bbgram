"use client";

import { Activity, Coins, Pause, Play, Sparkles, Users, Wallet } from "lucide-react";
import { api, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { formatNumber, formatWei } from "@/lib/format";
import { ConfirmButton, ErrorBox, Loading, PageHeader, Stat } from "@/components/ui";

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
      <PageHeader title="Overview" description="Community growth, points and presale at a glance." />
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="grid">
            <Stat
              label="Users"
              icon={Users}
              value={formatNumber(data.users)}
              sub={
                <>
                  <span className="up">+{formatNumber(data.users_today)}</span> today
                </>
              }
            />
            <Stat label="Points issued" icon={Sparkles} value={formatNumber(data.points_total)} />
            <Stat
              label="Wallets linked"
              icon={Wallet}
              value={formatNumber(data.wallets_linked)}
              sub={data.users ? `${Math.round((data.wallets_linked / data.users) * 100)}% of users` : undefined}
            />
            <Stat
              label="Presale raised"
              icon={Coins}
              value={
                <>
                  {formatWei(data.presale?.raised_wei, 2)} <span className="stat-sub">USDT</span>
                </>
              }
              sub={`${formatNumber(data.presale?.contributors)} contributors`}
            />
          </div>

          <h2>Earning</h2>
          <div className="card status-panel">
            <div className={`status-orb ${data.activity_paused ? "off" : "on"}`}>
              {data.activity_paused ? <Pause size={20} /> : <Activity size={20} />}
            </div>
            <div className="grow">
              <div className="status-title">
                Earning is {data.activity_paused ? "paused" : "live"}
                {data.activity_paused ? (
                  <span className="badge amber">Paused</span>
                ) : (
                  <span className="badge green">Running</span>
                )}
              </div>
              <div className="muted small" style={{ marginTop: 2 }}>
                Pausing stops all earning: spins, referrals, X rewards and daily jobs. Snapshots can only be taken
                while paused.
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
