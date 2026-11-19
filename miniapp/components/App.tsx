"use client";

import { Coins, House, ListChecks, Trophy, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, getToken, setReauth, setToken, startParam, trackScreen, type Me } from "@/lib/api";
import { applyTheme, haptic, inTelegram, tg } from "@/lib/telegram";
import { AppContext, type AppCtx, type Tab } from "./AppContext";
import { ic } from "./Common";
import { Button, EmptyState, Skeleton, ToastProvider, useToast } from "./ui";
import { Home } from "./screens/Home";
import { Tasks } from "./screens/Tasks";
import { ReferralsScreen } from "./screens/Referrals";
import { LeaderboardScreen } from "./screens/Leaderboard";
import { PresaleScreen } from "./screens/Presale";
import { SettingsSheet } from "./screens/Settings";
import { WalletLinkFlow } from "./screens/WalletLink";
import { BuyFlow } from "./screens/BuyFlow";

type AuthResponse = { token: string; user: Me };

const TABS: { key: Tab; label: string; Icon: typeof House }[] = [
  { key: "home", label: "Home", Icon: House },
  { key: "tasks", label: "Tasks", Icon: ListChecks },
  { key: "referrals", label: "Referrals", Icon: Users },
  { key: "leaderboard", label: "Leaderboard", Icon: Trophy },
  { key: "presale", label: "Presale", Icon: Coins },
];

function devInitData(): string {
  const id = process.env.NEXT_PUBLIC_DEV_TELEGRAM_ID;
  if (!id) return "";
  const user = process.env.NEXT_PUBLIC_DEV_TELEGRAM_USERNAME || `dev${id}`;
  return `dev:${id}:${user}`;
}

async function telegramAuth(): Promise<Me | null> {
  const w = tg();
  const initData = w?.initData || devInitData();
  if (!initData) return null;
  const r = await api.post<AuthResponse>("/api/auth/telegram", {
    init_data: initData,
    start_param: startParam(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: w?.initDataUnsafe?.user?.language_code || navigator.language,
    platform: w?.platform || "web",
  });
  setToken(r.token);
  return r.user;
}

async function authenticate(): Promise<Me> {
  const url = new URL(window.location.href);
  const handoff = url.searchParams.get("handoff");
  if (handoff) {
    url.searchParams.delete("handoff");
    window.history.replaceState(null, "", url.toString());
    const r = await api.post<AuthResponse>("/api/auth/handoff", { handoff_token: handoff });
    setToken(r.token);
    return r.user;
  }
  const me = await telegramAuth();
  if (me) {
    setReauth(async () => !!(await telegramAuth().catch(() => null)));
    return me;
  }
  if (getToken()) return api.get<Me>("/api/me");
  throw new ApiError(401, "Open Baby Grand from Telegram to continue.");
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [settings, setSettings] = useState(false);
  const [walletFlow, setWalletFlow] = useState(false);
  const [buyFlow, setBuyFlow] = useState(false);
  // Bumped when a flow closes so the visible screen remounts and refetches.
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const w = tg();
    try {
      w?.ready();
      w?.expand();
      if (w?.isVersionAtLeast("7.7")) w.disableVerticalSwipes?.();
    } catch {}
    applyTheme();
    const onTheme = () => applyTheme();
    w?.onEvent("themeChanged", onTheme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (!inTelegram()) mq.addEventListener("change", onTheme);

    authenticate().then(
      (user) => {
        setMe(user);
        if (startParam() === "x_connected") {
          setTab("tasks");
          toast("X account connected.", "success");
        }
      },
      (e: ApiError) => {
        setToken(null);
        setAuthError(e?.message || "Could not sign in. Try again.");
      },
    );
    return () => {
      w?.offEvent("themeChanged", onTheme);
      mq.removeEventListener("change", onTheme);
    };
  }, [toast]);

  // Screen-view events (risk scoring) for tabs and sub-screens.
  useEffect(() => {
    if (me) trackScreen(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, !!me]);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>("/api/me"));
    } catch {}
  }, []);

  const ctx = useMemo<AppCtx | null>(
    () =>
      me && {
        me,
        setMe,
        refreshMe,
        go: (t) => {
          setTab(t);
          window.scrollTo(0, 0);
        },
        openWallet: () => {
          trackScreen("wallet");
          setWalletFlow(true);
        },
        openBuy: () => {
          trackScreen("buy");
          setBuyFlow(true);
        },
        openSettings: () => {
          trackScreen("settings");
          setSettings(true);
        },
      },
    [me, refreshMe],
  );

  if (authError) {
    return (
      <div className="app">
        <main className="screen" style={{ justifyContent: "center", minHeight: "100dvh" }}>
          <EmptyState
            text={authError}
            action={
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            }
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      {!ctx ? (
        <main className="screen" aria-busy>
          <Skeleton height={44} width={140} />
          <Skeleton height={164} radius={24} />
          <Skeleton height={248} />
          <Skeleton height={64} />
        </main>
      ) : (
        <AppContext.Provider value={ctx}>
          <div key={rev}>
            {tab === "home" && <Home />}
            {tab === "tasks" && <Tasks />}
            {tab === "referrals" && <ReferralsScreen />}
            {tab === "leaderboard" && <LeaderboardScreen />}
            {tab === "presale" && <PresaleScreen />}
          </div>
          <SettingsSheet open={settings} onClose={() => setSettings(false)} />
          {walletFlow && <WalletLinkFlow onClose={() => { setWalletFlow(false); setRev((r) => r + 1); }} />}
          {buyFlow && <BuyFlow onClose={() => { setBuyFlow(false); setRev((r) => r + 1); }} />}
        </AppContext.Provider>
      )}
      <nav className="tabbar" aria-label="Main">
        <div className="tabbar-inner">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className="tab"
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                if (tab !== key) haptic.light();
                setTab(key);
                window.scrollTo(0, 0);
              }}
            >
              <Icon {...ic} />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
