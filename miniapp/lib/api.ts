// API client for the Baby Grand backend (contract: docs/interfaces.md §1).

import { tg } from "./telegram";

export type Me = {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
  referral_code: string;
  referral_link: string;
  balance: number;
  today_delta: number;
  rank: number | null;
  wallet_address: string | null;
  x_username: string | null;
  reminders_enabled: boolean;
  banned: boolean;
  activity_paused: boolean;
};

export type SpinState = {
  ready: boolean;
  next_refill_at: string | null;
  points_per_spin: number;
  interval_seconds: number;
};

export type Task = {
  key: "spin" | "x_post" | "x_bio" | "x_connect" | "wallet" | "join_channel";
  title: string;
  section: "daily" | "one_time";
  reward: number;
  state: "todo" | "pending" | "done";
  /** Not in the contract: optional link (e.g. channel URL for join_channel). Used when present. */
  url?: string;
};

export type Referrals = {
  code: string;
  link: string;
  points_per_friend: number;
  stats: { friends: number; points_earned: number; pending: number };
  items: {
    name: string;
    photo_url: string | null;
    joined_at: string;
    points_earned: number;
    status: "pending" | "credited";
  }[];
};

export type Leaderboard = {
  items: { rank: number; name: string; photo_url: string | null; points: number }[];
  me: { rank: number | null; points: number };
};

export type XState = {
  connected: boolean;
  username: string | null;
  posts: { id: number; url: string; status: "active" | "revoked"; created_at: string }[];
  bio_marked: boolean;
};

/** Presale without a contract: buyers pay USDT straight into the presale wallet (interfaces.md section 1). */
export type Presale = {
  status: "upcoming" | "live" | "paused" | "ended" | "closed";
  start_at: string | null;
  end_at: string | null;
  raised_wei: string;
  hard_cap_wei: string;
  /** Token wei per 1 whole USDT. */
  tokens_per_usdt_wei: string;
  min_wei: string;
  max_wei: string;
  chain_id: number | null;
  presale_wallet: string | null;
  usdt_address: string | null;
  /** USDT received from the user's linked wallet. */
  contributed_wei: string;
  /** The part of it that counts (capped at the per-wallet max). */
  counted_wei: string;
  /** Estimated tokens while open; the frozen allocation once closed. */
  tokens_wei: string;
  credited: boolean;
  credited_tx: string | null;
};

export type Airdrop = {
  available: boolean;
  airdrop_address: string | null;
  amount_wei: string;
  proof: string[];
  claimed: boolean;
  deadline: string | null;
};

/** False until the admin has set the presale wallet, price and times (and USDT on testnet). */
export function presaleReady(p: Presale): boolean {
  return !!(
    p.presale_wallet && p.usdt_address && p.start_at && p.end_at && p.chain_id && BigInt(p.tokens_per_usdt_wei || "0") > BigInt(0)
  );
}

/** Referral code: Telegram start_param first, else `?start_param=` from the bot's web_app button URL. */
export function startParam(): string | undefined {
  const fromTg = tg()?.initDataUnsafe?.start_param;
  if (fromTg) return fromTg;
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("start_param") || undefined;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "bg_token";

let token: string | null = null;
let deviceHash = "";

export function getToken() {
  if (token) return token;
  try {
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch {}
  return token;
}

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/** Stable-ish fingerprint of browser/Telegram traits, hashed client-side. */
async function computeDeviceHash(): Promise<string> {
  const s = window.screen;
  const traits = [
    navigator.userAgent,
    navigator.language,
    navigator.hardwareConcurrency,
    s.width,
    s.height,
    s.colorDepth,
    window.devicePixelRatio,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    tg()?.platform || "web",
  ].join("|");
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(traits));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Non-secure context fallback (FNV-1a).
    let h = 0x811c9dc5;
    for (let i = 0; i < traits.length; i++) {
      h ^= traits.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}

let reauth: (() => Promise<boolean>) | null = null;

/** Registers a function that can obtain a fresh JWT after a 401 (Telegram initData only). */
export function setReauth(fn: (() => Promise<boolean>) | null) {
  reauth = fn;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  if (!deviceHash) deviceHash = await computeDeviceHash();
  const headers: Record<string, string> = { "X-Device-Hash": deviceHash };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "No connection. Check your internet and try again.");
  }
  if (res.status === 401 && retry && reauth && !path.startsWith("/api/auth/")) {
    if (await reauth()) return request<T>(method, path, body, false);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      if (typeof j?.detail === "string") detail = j.detail;
    } catch {}
    throw new ApiError(res.status, detail || fallbackMessage(res.status));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function fallbackMessage(status: number) {
  if (status === 401) return "Your session expired. Reopen the app.";
  if (status === 403) return "This action is not available for your account.";
  if (status === 404) return "Not found.";
  if (status === 409) return "This was already done.";
  if (status === 423) return "Earning is paused right now. Try again later.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return "Something went wrong. Try again.";
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
};

export function trackScreen(screen: string) {
  if (!getToken()) return;
  api.post("/api/events", { screen }).catch(() => {});
}
