"use client";

import { Copy, Share2 } from "lucide-react";
import type { Referrals } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { date, points } from "@/lib/format";
import { haptic, shareUrl } from "@/lib/telegram";
import { useApi } from "@/lib/useApi";
import { ErrorCard, ic, Screen, ScreenHeader } from "../Common";
import { Avatar, Button, Card, Chip, EmptyState, ListRow, Skeleton, StatTile, useToast } from "../ui";

const SHARE_TEXT = "Join me on Baby Grand: spin daily, earn points and get early access to the presale.";

export function ReferralsScreen() {
  const toast = useToast();
  const ref = useApi<Referrals>("/api/referrals");
  const r = ref.data;

  const copy = async () => {
    if (!r) return;
    if (await copyText(r.link)) {
      haptic.light();
      toast("Link copied.", "success");
    } else toast("Could not copy. Press and hold the link to copy it.", "error");
  };
  const share = () => {
    if (!r) return;
    haptic.light();
    shareUrl(r.link, SHARE_TEXT);
  };

  return (
    <Screen>
      <ScreenHeader title="Referrals" />
      {!r ? (
        ref.error ? (
          <ErrorCard message={ref.error.message} onRetry={ref.reload} />
        ) : (
          <>
            <Skeleton height={188} />
            <Skeleton height={82} />
            <Skeleton height={224} />
          </>
        )
      ) : (
        <>
          <Card>
            <div className="stack">
              <div>
                <div className="t-h1 num">{points(r.points_per_friend)} points</div>
                <div className="t-caption muted">per friend who joins and spins once</div>
              </div>
              <input className="input mono" readOnly value={r.link} aria-label="Your referral link" onFocus={(e) => e.target.select()} />
              <div className="hrow">
                <Button variant="secondary" className="grow" onClick={copy}>
                  <Copy {...ic} /> Copy link
                </Button>
                <Button className="grow" onClick={share}>
                  <Share2 {...ic} /> Share
                </Button>
              </div>
            </div>
          </Card>
          <div className="stats">
            <StatTile label="Friends" value={points(r.stats.friends)} />
            <StatTile label="Points earned" value={points(r.stats.points_earned)} />
            <StatTile label="Pending" value={points(r.stats.pending)} />
          </div>
          <Card title="Your friends" flush>
            {r.items.length === 0 ? (
              <EmptyState
                text="No friends yet. Share your link to start earning."
                action={
                  <Button size="compact" onClick={share}>
                    <Share2 {...ic} /> Share
                  </Button>
                }
              />
            ) : (
              <div className="list">
                {r.items.map((f, i) => (
                  <ListRow
                    key={`${f.name}-${f.joined_at}-${i}`}
                    leading={<Avatar src={f.photo_url} name={f.name} />}
                    title={f.name}
                    subtitle={date(f.joined_at)}
                    trailing={
                      f.status === "pending" ? (
                        <Chip tone="warning">Pending</Chip>
                      ) : (
                        <span className="t-strong c-success num">+{points(f.points_earned)}</span>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
