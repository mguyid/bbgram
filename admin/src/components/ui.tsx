"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { formatDate, formatWei, isHash, isHexAddress, shortAddr } from "@/lib/format";

export function Addr({ value, full }: { value: string | null | undefined; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="muted">—</span>;
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
  return <div className="error">{error}</div>;
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
              className={danger ? "btn danger" : "btn primary"}
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
      <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={16} /> Prev
      </button>
      <span className="muted">
        Page {page}
        {pages !== undefined && ` of ${pages}`}
        {total !== undefined && ` · ${total.toLocaleString("en-US")} total`}
      </span>
      <button type="button" className="btn ghost" disabled={!hasNext} onClick={() => onPage(page + 1)}>
        Next <ChevronRight size={16} />
      </button>
    </div>
  );
}

/** Render any value from an API object in a readable way. */
export function Value({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="muted">—</span>;
  if (k.endsWith("_wei")) return <>{formatWei(String(v))}</>;
  if (isHexAddress(v) || isHash(v)) return <Addr value={v} />;
  if (typeof v === "boolean") return <>{v ? "yes" : "no"}</>;
  if (k.endsWith("_at") && typeof v === "string") return <>{formatDate(v)}</>;
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
  if (!rows.length) return <p className="muted">{empty}</p>;
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

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}
