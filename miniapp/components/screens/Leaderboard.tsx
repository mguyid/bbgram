"use client";

import { Crown } from "lucide-react";
import { useState } from "react";
import type { Leaderboard } from "@/lib/api";
import { displayName, points } from "@/lib/format";
import { haptic } from "@/lib/telegram";
import { useApi } from "@/lib/useApi";
import { useApp } from "../AppContext";
import { ErrorCard, ic, Screen, ScreenHeader } from "../Common";
import { Avatar, Button, Card, ChipButton, EmptyState, ListRow, Skeleton } from "../ui";

type Item = Leaderboard["items"][number];

export function LeaderboardScreen() {
  const { me, go } = useApp();
  const [period, setPeriod] = useState<"all" | "week">("all");
  const lb = useApi<Leaderboard>(`/api/leaderboard?period=${period}`);
  const d = lb.data;

  const select = (p: "all" | "week") => {
    if (p === period) return;
    haptic.light();
    setPeriod(p);
  };

  const top = d?.items.slice(0, 3) ?? [];
  const rest = d?.items.slice(3) ?? [];

  return (
    <Screen className="lb-screen">
      <ScreenHeader title="Leaderboard" />
      <div className="segmented" role="group" aria-label="Period">
        <ChipButton selected={period === "all"} onClick={() => select("all")}>
          All time
        </ChipButton>
        <ChipButton selected={period === "week"} onClick={() => select("week")}>
          This week
        </ChipButton>
      </div>
      {!d ? (
        lb.error ? (
          <ErrorCard message={lb.error.message} onRetry={lb.reload} />
        ) : (
          <>
            <Skeleton height={156} />
            <Skeleton height={336} />
          </>
        )
      ) : d.items.length === 0 ? (
        <Card>
          <EmptyState
            text={period === "week" ? "No points earned this week yet." : "No one on the board yet."}
            action={
              <Button size="compact" onClick={() => go("home")}>
                Spin
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="podium">
            {[top[1], top[0], top[2]].map((it, i) => (it ? <PodiumItem key={it.rank} item={it} /> : <div key={`empty-${i}`} />))}
          </div>
          {rest.length > 0 && (
            <Card flush>
              <div className="list">
                {rest.map((it) => (
                  <ListRow
                    key={it.rank}
                    leading={
                      <>
                        <span className="rank-num num t-caption">{it.rank}</span>
                        <Avatar src={it.photo_url} name={it.name} />
                      </>
                    }
                    title={it.name}
                    trailing={<span className="t-strong num">{points(it.points)}</span>}
                  />
                ))}
              </div>
            </Card>
          )}
        </>
      )}
      {d && (
        <div className="me-row">
          <div className="card">
            <ListRow
              leading={
                <>
                  <span className="rank-num num t-caption">{d.me.rank ? `#${points(d.me.rank)}` : "–"}</span>
                  <Avatar src={me.photo_url} name={displayName(me)} />
                </>
              }
              title="You"
              subtitle={d.me.rank ? undefined : "Not ranked yet"}
              trailing={<span className="t-strong num c-accent">{points(d.me.points)}</span>}
            />
          </div>
        </div>
      )}
    </Screen>
  );
}

function PodiumItem({ item }: { item: Item }) {
  const first = item.rank === 1;
  return (
    <div className={`card podium-item ${first ? "first" : ""}`}>
      {first ? <Crown {...ic} className="c-gold" aria-label="Rank 1" /> : <span className="podium-rank num">{item.rank}</span>}
      <Avatar src={item.photo_url} name={item.name} size={first ? 56 : 40} />
      <span className="t-caption t-strong ellipsis" style={{ maxWidth: "100%" }}>
        {item.name}
      </span>
      <span className={`t-caption num ${first ? "" : "muted"}`}>{points(item.points)}</span>
    </div>
  );
}
