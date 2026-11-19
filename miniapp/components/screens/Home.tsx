"use client";

import { ChevronRight, Coins, RotateCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { api, presaleReady, type Presale, type SpinState, type Task } from "@/lib/api";
import { displayName, percent, points, shortDuration } from "@/lib/format";
import { prefersReducedMotion, useCountUp } from "@/lib/motion";
import { haptic } from "@/lib/telegram";
import { useApi } from "@/lib/useApi";
import { useApp } from "../AppContext";
import { ErrorCard, ic, Screen, ScreenHeader } from "../Common";
import { Avatar, Card, Chip, Countdown, EmptyState, ListRow, RowIcon, Skeleton, useNow, useToast } from "../ui";
import { TASK_ICON } from "./taskMeta";

export function Home() {
  const { me } = useApp();
  const [fly, setFly] = useState<{ id: number; points: number } | null>(null);
  return (
    <Screen>
      <ScreenHeader title="Baby Grand" />
      {me.banned && (
        <Card>
          <div className="hrow c-danger">
            <TriangleAlert {...ic} />
            <span className="t-strong">Your account is restricted. Earning is disabled.</span>
          </div>
        </Card>
      )}
      <Hero fly={fly} />
      <SpinCard onWin={(p) => setFly({ id: Date.now(), points: p })} />
      <PresaleStrip />
      <QuickTasks />
    </Screen>
  );
}

function Hero({ fly }: { fly: { id: number; points: number } | null }) {
  const { me } = useApp();
  const balance = useCountUp(me.balance);
  const name = displayName(me);
  return (
    <section className="hero" aria-label="Your points">
      <span className="t-micro eyebrow">Your points</span>
      <span className="t-display num" aria-live="polite">
        {points(balance)}
      </span>
      {me.today_delta > 0 && <Chip className="delta">+{points(me.today_delta)} today</Chip>}
      {fly && (
        <span key={fly.id} className="fly num" aria-hidden>
          +{points(fly.points)}
        </span>
      )}
      <div className="hero-user">
        <Avatar src={me.photo_url} name={name} size={32} />
        <span className="t-strong ellipsis">{name}</span>
        <Chip className="rank-pill">{me.rank ? `Rank #${points(me.rank)}` : "Unranked"}</Chip>
      </div>
    </section>
  );
}

const RING = 2 * Math.PI * 66;

function SpinCard({ onWin }: { onWin: (points: number) => void }) {
  const { me, setMe } = useApp();
  const toast = useToast();
  const spin = useApi<SpinState>("/api/spin");
  const [phase, setPhase] = useState<"idle" | "spinning" | "result">("idle");
  const [won, setWon] = useState(0);
  const now = useNow(!!spin.data && !spin.data.ready);

  if (!spin.data) {
    if (spin.error) return <ErrorCard message={spin.error.message} onRetry={spin.reload} />;
    return <Skeleton height={264} />;
  }
  const s = spin.data;
  const paused = me.activity_paused || me.banned;
  const refillAt = s.next_refill_at ? new Date(s.next_refill_at).getTime() : 0;
  const ready = s.ready || (refillAt > 0 && refillAt <= now);
  const fill = ready ? 1 : Math.min(1, Math.max(0, 1 - (refillAt - now) / 1000 / (s.interval_seconds || 1)));

  const doSpin = async () => {
    haptic.light();
    setPhase("spinning");
    const started = Date.now();
    const minDuration = prefersReducedMotion() ? 300 : 1800;
    try {
      const r = await api.post<{ points: number; balance: number; next_refill_at: string }>("/api/spin");
      await new Promise((res) => setTimeout(res, Math.max(0, minDuration - (Date.now() - started))));
      spin.mutate({ ...s, ready: false, next_refill_at: r.next_refill_at });
      setMe({ ...me, balance: r.balance, today_delta: me.today_delta + r.points });
      setWon(r.points);
      setPhase("result");
      onWin(r.points);
      haptic.success();
      setTimeout(() => setPhase("idle"), 2500);
    } catch (e) {
      haptic.error();
      setPhase("idle");
      toast((e as Error).message, "error");
      spin.reload();
    }
  };

  const spinning = phase === "spinning";
  return (
    <Card className="spin-card">
      <div className="spin-wrap">
        <svg className="spin-ring" viewBox="0 0 144 144" aria-hidden>
          <circle className="track" cx="72" cy="72" r="66" />
          <circle className="fill" cx="72" cy="72" r="66" strokeDasharray={RING} strokeDashoffset={RING * (1 - fill)} />
        </svg>
        <button
          type="button"
          className={`spin-btn ${ready && !spinning && !paused ? "ready" : ""} ${spinning ? "spinning" : ""}`}
          disabled={!ready || paused || phase !== "idle"}
          onClick={doSpin}
          aria-label={ready ? "Spin" : "Spin not ready"}
        >
          <RotateCw size={28} strokeWidth={1.75} />
          Spin
        </button>
      </div>
      {phase === "result" ? (
        <div className="stack-8">
          <span className="t-h2 spin-result num">+{points(won)} points</span>
          <span className="t-caption muted">Next spin in {shortDuration(refillAt - now)}</span>
        </div>
      ) : paused ? (
        <span className="t-caption muted">Earning is paused right now.</span>
      ) : spinning ? (
        <span className="t-caption muted">Spinning…</span>
      ) : ready ? (
        <div className="stack-8">
          <span className="t-strong">Spin is ready</span>
          <span className="t-caption muted">Spin to earn {points(s.points_per_spin)} points</span>
        </div>
      ) : (
        <div className="stack-8">
          <span className="t-strong">Next spin in</span>
          <Countdown to={refillAt} onDone={spin.reload} className="muted" />
        </div>
      )}
    </Card>
  );
}

function PresaleStrip() {
  const { go } = useApp();
  const presale = useApi<Presale>("/api/presale");
  const now = useNow();
  const p = presale.data;
  if (!p && !presale.error) return <Skeleton height={56} />;
  const purchased = BigInt(p?.purchased_wei || "0");
  if (p && p.status === "claimable" && purchased > BigInt(0) && BigInt(p.claimed_wei || "0") >= purchased) return null;

  let text = "Presale · View details";
  if (p && !presaleReady(p)) text = "Presale · Coming soon";
  else if (p && p.start_at && p.end_at) {
    const pct = Math.floor(percent(p.raised_wei, p.hard_cap_wei));
    const toEnd = shortDuration(new Date(p.end_at).getTime() - now);
    if (p.status === "live") text = `Presale live · ${pct}% filled · ends in ${toEnd}`;
    else if (p.status === "upcoming")
      text = `Presale starts in ${shortDuration(new Date(p.start_at).getTime() - now)}`;
    else if (p.status === "paused") text = `Presale paused · ${pct}% filled`;
    else if (p.status === "ended") text = `Presale ended · ${pct}% filled`;
    else if (BigInt(p.claimable_wei || "0") > BigInt(0)) text = "Presale tokens are ready to claim";
    else text = "Presale claim is open";
  }
  return (
    <button type="button" className="card cta-strip" onClick={() => go("presale")}>
      <Coins {...ic} className="c-gold" />
      <span className="grow t-strong ellipsis t-caption">{text}</span>
      <ChevronRight {...ic} className="muted" />
    </button>
  );
}

function QuickTasks() {
  const { go } = useApp();
  const tasks = useApi<{ tasks: Task[] }>("/api/tasks");
  if (!tasks.data) {
    if (tasks.error) return <ErrorCard message={tasks.error.message} onRetry={tasks.reload} />;
    return <Skeleton height={176} />;
  }
  const top = tasks.data.tasks
    .filter((t) => t.state === "todo" && t.key !== "spin")
    .sort((a, b) => b.reward - a.reward)
    .slice(0, 3);
  return (
    <Card title="Quick tasks" flush>
      {top.length === 0 ? (
        <EmptyState text="All tasks done. Check back after your next spin." />
      ) : (
        <div className="list">
          {top.map((t) => (
            <ListRow
              key={t.key}
              leading={<RowIcon>{TASK_ICON[t.key]}</RowIcon>}
              title={t.title}
              trailing={
                <>
                  <Chip tone="accent">+{points(t.reward)}</Chip>
                  <ChevronRight {...ic} />
                </>
              }
              onClick={() => go("tasks")}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
