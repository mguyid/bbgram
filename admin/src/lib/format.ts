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
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

export function isHexAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export function isHash(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}
