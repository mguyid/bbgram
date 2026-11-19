"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, Inbox, Piano } from "lucide-react";
import { formatDate, formatWei, isHash, isHexAddress, shortAddr, timeAgo } from "@/lib/format";

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden>
      <Piano size={size} strokeWidth={2} />
    </span>
  );
}

/** Title block at the top of every page: optional back link, title, description and actions. */
export function PageHeader({
  title,
  description,
  actions,
  back,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  badge?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {back && (
          <Link href={back.href} className="crumb">
            <ArrowLeft size={14} /> {back.label}
          </Link>
        )}
        <div className="title-row">
          <h1>{title}</h1>
          {badge}
        </div>
        {description && <p className="desc">{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Loading({ label = "Loading…", full }: { label?: string; full?: boolean }) {
  return (
    <div className={full ? "full-center" : undefined}>
      <div className="loading" role="status">
        <span className="spinner" /> {label}
      </div>
    </div>
  );
}

export function EmptyState({ title, text, icon: I = Inbox }: { title: string; text?: ReactNode; icon?: Icon }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <I size={18} />
      </div>
      <strong>{title}</strong>
      {text && <span className="small">{text}</span>}
    </div>
  );
}

/** Full-width empty row for a table body. */
export function EmptyRow({ cols, title, text }: { cols: number; title: string; text?: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} style={{ padding: 0 }}>
        <EmptyState title={title} text={text} />
      </td>
    </tr>
  );
}

/** Risk score coloured by band; the number is always shown so colour is never the only signal. */
export function RiskBadge({ score, threshold = 60 }: { score: number | null | undefined; threshold?: number }) {
  if (score === null || score === undefined) return <span className="faint">—</span>;
  const tone = score >= threshold ? "red" : score >= threshold / 2 ? "amber" : "green";
  return <span className={`badge plain ${tone}`} style={{ minWidth: 34, justifyContent: "center" }}>{score}</span>;
}

export function UserCell({ id, username }: { id: number | string; username?: string | null }) {
  const label = username ? `@${username}` : `User ${id}`;
  return (
    <Link href={`/users/${id}`} className="user-cell">
      <span className="avatar">{(username || "#").slice(0, 1)}</span>
      {label}
    </Link>
  );
}

export function Addr({ value, full }: { value: string | null | undefined; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="faint">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <span className="addr" title={value}>
      <code style={full ? { wordBreak: "break-all" } : undefined}>{full ? value : shortAddr(value)}</code>
      <button type="button" className="icon-btn" onClick={copy} aria-label="Copy">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </span>
  );
}

export function ErrorBox({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      <AlertCircle size={16} />
      <span>{error}</span>
    </div>
  );
}

export function SuccessBox({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="success" role="status">
      <Check size={16} />
      <span>{message}</span>
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

type ConfirmProps = {
  label: ReactNode;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  askReason?: boolean;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
  onConfirm: (reason: string) => Promise<unknown>;
};

/** Button that opens a confirmation dialog (optionally asking for a reason) before running an action. */
export function ConfirmButton({
  label,
  title,
  message,
  confirmLabel = "Confirm",
  askReason,
  danger = true,
  disabled,
  className,
  onConfirm,
}: ConfirmProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setReason("");
    setError(null);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setBusy(false);
      setOpen(false);
      setReason("");
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className ?? (danger ? "btn danger" : "btn")}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <Modal title={title} onClose={close}>
          {message && <div className="modal-body">{message}</div>}
          {askReason && (
            <label className="field">
              <span>Reason</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
            </label>
          )}
          <ErrorBox error={error} />
          <div className="row end">
            <button type="button" className="btn ghost" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className={danger ? "btn danger-solid" : "btn primary"}
              onClick={run}
              disabled={busy || (askReason && !reason.trim())}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  count,
  onPage,
}: {
  page: number;
  pageSize?: number;
  total?: number;
  count: number;
  onPage: (p: number) => void;
}) {
  const pages = total !== undefined && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
  const hasNext = pages !== undefined ? page < pages : pageSize ? count >= pageSize : count > 0;
  return (
    <div className="pager">
      <span className="muted">
        Page {page}
        {pages !== undefined && ` of ${pages.toLocaleString("en-US")}`}
        {total !== undefined && ` · ${total.toLocaleString("en-US")} total`}
      </span>
      <div className="row">
        <button type="button" className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} /> Previous
        </button>
        <button type="button" className="btn small" disabled={!hasNext} onClick={() => onPage(page + 1)}>
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/** Render any value from an API object in a readable way. */
export function Value({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="faint">—</span>;
  if (k.endsWith("_wei")) return <>{formatWei(String(v))}</>;
  if (isHexAddress(v) || isHash(v)) return <Addr value={v} />;
  if (typeof v === "boolean") return <span className={`badge plain ${v ? "green" : ""}`}>{v ? "Yes" : "No"}</span>;
  if (k.endsWith("_at") && typeof v === "string") return <DateCell value={v} />;
  if (typeof v === "object") return <code className="json">{JSON.stringify(v)}</code>;
  return <>{String(v)}</>;
}

/** Generic table for API lists whose exact shape is not pinned by the contract. */
export function ObjTable({
  rows,
  userLinkKeys = ["user_id"],
  empty = "Nothing here.",
}: {
  rows: Record<string, unknown>[];
  userLinkKeys?: string[];
  empty?: string;
}) {
  if (!rows.length)
    return (
      <div className="table-wrap">
        <EmptyState title={empty} />
      </div>
    );
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c.replace(/_/g, " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>
                  {userLinkKeys.includes(c) && r[c] !== null && r[c] !== undefined ? (
                    <Link href={`/users/${r[c]}`}>{String(r[c])}</Link>
                  ) : (
                    <Value k={c} v={r[c]} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, sub, icon: I }: { label: string; value: ReactNode; sub?: ReactNode; icon?: Icon }) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {I && (
          <span className="stat-icon">
            <I size={16} />
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Relative time with the exact timestamp on hover. */
export function DateCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="faint">—</span>;
  return (
    <span title={formatDate(value)} className="muted">
      {timeAgo(value)}
    </span>
  );
}
