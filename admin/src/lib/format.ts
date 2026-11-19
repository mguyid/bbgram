const DECIMALS = 18n;

/** Format an integer wei string as a human decimal (18 decimals). */
export function formatWei(wei: string | number | null | undefined, maxFraction = 4): string {
  if (wei === null || wei === undefined || wei === "") return "—";
  let v: bigint;
  try {
    v = BigInt(String(wei));
  } catch {
    return String(wei);
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** DECIMALS;
  const whole = v / base;
  let frac = (v % base).toString().padStart(Number(DECIMALS), "0").slice(0, maxFraction);
  frac = frac.replace(/0+$/, "");
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + w + (frac ? "." + frac : "");
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString("en-US") : String(n);
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "3h ago" style; falls back to the full date after a week. */
export function timeAgo(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  const sec = (Date.now() - d.getTime()) / 1000;
  if (Number.isNaN(sec)) return s;
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  return formatDate(s);
}

export function isHexAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export function isHash(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}
