"use client";

import { createContext, useContext } from "react";
import type { Me } from "@/lib/api";

export type Tab = "home" | "tasks" | "referrals" | "leaderboard" | "presale";

export type AppCtx = {
  me: Me;
  setMe: (me: Me) => void;
  refreshMe: () => Promise<void>;
  go: (tab: Tab) => void;
  openWallet: () => void;
  openBuy: () => void;
  openSettings: () => void;
};

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppContext");
  return ctx;
}
