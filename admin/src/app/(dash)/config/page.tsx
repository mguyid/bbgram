"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { api, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { ErrorBox } from "@/components/ui";

type Kind = "bool" | "int" | "string";
type Value = boolean | number | string;

const KEYS: { key: string; kind: Kind; label: string; hint?: string }[] = [
  { key: "activity_paused", kind: "bool", label: "Activity paused", hint: "Same as Pause/Resume on Overview." },
  { key: "points_per_spin", kind: "int", label: "Points per spin" },
  { key: "spin_interval_hours", kind: "int", label: "Spin interval (hours)" },
  { key: "referral_points", kind: "int", label: "Referral points" },
  { key: "register_points", kind: "int", label: "Register points" },
  { key: "x_connect_points", kind: "int", label: "X connect points" },
  { key: "x_post_points", kind: "int", label: "X post points (once per URL)" },
  { key: "x_post_daily_points", kind: "int", label: "X post daily points" },
  { key: "x_bio_daily_points", kind: "int", label: "X bio daily points" },
  { key: "join_channel_points", kind: "int", label: "Join channel points" },
  { key: "telegram_channel", kind: "string", label: "Telegram channel", hint: "e.g. @babygrand" },
  {
    key: "max_telegram_id",
    kind: "int",
    label: "Max Telegram ID",
    hint: "0 = off. Higher ids earn no referral credit and are flagged.",
  },
  { key: "risk_threshold", kind: "int", label: "Risk threshold", hint: "Users at or above are excluded from snapshots." },
  { key: "referral_burst_n", kind: "int", label: "Referral burst: N children" },
  { key: "referral_burst_minutes", kind: "int", label: "Referral burst: within minutes" },
];

function kindOf(v: unknown): Kind {
  return typeof v === "boolean" ? "bool" : typeof v === "number" ? "int" : "string";
}

function ConfigForm({ initial, onSaved }: { initial: Record<string, Value>; onSaved: () => void }) {
  const canEdit = useCanEdit();
  const [values, setValues] = useState<Record<string, Value>>(initial);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);

  const extra = Object.keys(initial)
    .filter((k) => !KEYS.some((d) => d.key === k))
    .map((k) => ({ key: k, kind: kindOf(initial[k]), label: k, hint: undefined }));
  const fields = [...KEYS, ...extra];
  const changed = fields.filter((f) => values[f.key] !== initial[f.key]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, Value> = {};
    for (const f of changed) {
      const v = values[f.key];
      if (f.kind === "int") {
        const n = Number(v);
        if (v === "" || !Number.isInteger(n) || n < 0) {
          setMsg({ err: `${f.label} must be a whole number ≥ 0.` });
          return;
        }
        body[f.key] = n;
      } else body[f.key] = v;
    }
    setBusy(true);
    setMsg({});
    try {
      await api("/config", { method: "PUT", body });
      setMsg({ ok: "Saved." });
      onSaved();
    } catch (err) {
      setMsg({ err: (err as Error).message });
    }
    setBusy(false);
  };

  return (
    <form className="card stack" onSubmit={save} style={{ maxWidth: 640 }}>
      {fields.map((f) => (
        <label key={f.key} className={f.kind === "bool" ? "field inline" : "field"}>
          {f.kind === "bool" ? (
            <input
              type="checkbox"
              checked={Boolean(values[f.key])}
              disabled={!canEdit}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
            />
          ) : null}
          <span>
            {f.label} <code className="muted">{f.key}</code>
            {f.hint && <span className="muted"> — {f.hint}</span>}
          </span>
          {f.kind !== "bool" && (
            <input
              type={f.kind === "int" ? "number" : "text"}
              min={f.kind === "int" ? 0 : undefined}
              step={f.kind === "int" ? 1 : undefined}
              value={values[f.key] === undefined ? "" : String(values[f.key])}
              disabled={!canEdit}
              onChange={(e) =>
                setValues({
                  ...values,
                  [f.key]: f.kind === "int" && e.target.value !== "" ? Number(e.target.value) : e.target.value,
                })
              }
            />
          )}
        </label>
      ))}
      {msg.ok && <div className="ok">{msg.ok}</div>}
      <ErrorBox error={msg.err} />
      {canEdit && (
        <div>
          <button className="btn primary" type="submit" disabled={busy || !changed.length}>
            <Save size={16} /> Save {changed.length ? `(${changed.length} changed)` : ""}
          </button>
        </div>
      )}
    </form>
  );
}

export default function ConfigPage() {
  const { data, error, reload } = useGet<Record<string, Value>>("/config");
  return (
    <>
      <h1>Config</h1>
      <ErrorBox error={error} />
      {!data && !error && <p className="muted">Loading…</p>}
      {/* key remounts the form with fresh values after each load */}
      {data && <ConfigForm key={JSON.stringify(data)} initial={data} onSaved={reload} />}
    </>
  );
}
