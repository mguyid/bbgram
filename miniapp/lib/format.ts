// Display formatting per telegram.md §7. Wei math uses BigInt so viem stays out of the main bundle.

const WEI = BigInt(10) ** BigInt(18);
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function points(n: number): string {
  return int.format(Math.round(n));
}

/** Formats an 18-decimal wei string with thousands separators and at most `maxFrac` decimals (truncated). */
export function fromWei(wei: string | bigint, maxFrac: number): string {
  let v: bigint;
  try {
    v = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  } catch {
    v = BigInt(0);
  }
  const neg = v < BigInt(0);
  if (neg) v = -v;
  const whole = v / WEI;
  let frac = (v % WEI).toString().padStart(18, "0").slice(0, maxFrac).replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (maxFrac === 2 && frac.length === 1) frac += "0";
  return (neg ? "-" : "") + wholeStr + (frac ? "." + frac : "");
}

export const usdt = (wei: string | bigint) => "$" + fromWei(wei, 2);
export const tokens = (wei: string | bigint) => fromWei(wei, 4);

/** Parses a user-typed decimal ("12.5") into wei. Returns null when invalid. */
export function toWei(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,18})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return BigInt(w) * WEI + BigInt(f.padEnd(18, "0") || "0");
}

/** Token amount (wei) for a USDT amount (wei) at `tokensPerUsdtWei` token wei per whole USDT. */
export function tokensFor(usdtWei: bigint, tokensPerUsdtWei: string): bigint {
  return (usdtWei * BigInt(tokensPerUsdtWei || "0")) / WEI;
}

/** Price per token in USDT (up to 6 decimals), or "" when no price is set. */
export function tokenPrice(tokensPerUsdtWei: string): string {
  const t = BigInt(tokensPerUsdtWei || "0");
  return t > BigInt(0) ? "$" + fromWei((WEI * WEI) / t, 6) : "";
}

/** Vesting terms, e.g. "25% at launch, rest over 30 days". "" when everything unlocks at launch. */
export function unlockTerms(unlockBps: number, vestingSeconds: number): string {
  if (!vestingSeconds || unlockBps >= 10000) return "";
  const d = Math.round(vestingSeconds / 86400);
  const h = Math.round(vestingSeconds / 3600);
  const m = Math.max(1, Math.round(vestingSeconds / 60));
  const span = d >= 1 ? `${d} day${d === 1 ? "" : "s"}` : h >= 1 ? `${h} hour${h === 1 ? "" : "s"}` : `${m} min`;
  return unlockBps > 0 ? `${unlockBps / 100}% at launch, rest over ${span}` : `Unlocks gradually over ${span}`;
}

export function shortAddress(a: string | null | undefined): string {
  if (!a) return "";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** dd:hh:mm:ss, collapsing to hh:mm:ss under a day. */
export function countdown(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return d > 0 ? `${pad(d)}:${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Short relative duration: "3d 4h", "4h 12m", "12m". */
export function shortDuration(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(t / 1440);
  const h = Math.floor((t % 1440) / 60);
  const m = t % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function date(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function percent(numWei: string, denWei: string): number {
  try {
    const den = BigInt(denWei || "0");
    if (den === BigInt(0)) return 0;
    const p = Number((BigInt(numWei || "0") * BigInt(10000)) / den) / 100;
    return Math.min(100, Math.max(0, p));
  } catch {
    return 0;
  }
}

export function displayName(u: { username?: string | null; first_name?: string | null }): string {
  return u.username ? `@${u.username}` : u.first_name || "You";
}
