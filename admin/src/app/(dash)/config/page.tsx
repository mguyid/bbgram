"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { api, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { ErrorBox, Loading, PageHeader, SuccessBox } from "@/components/ui";

type Kind = "bool" | "int" | "string";
type Value = boolean | number | string;
type Group = "Activity" | "Rewards" | "Community" | "Anti-abuse" | "Other";

const KEYS: { key: string; kind: Kind; label: string; hint?: string; group?: Group }[] = [
  { key: "activity_paused", group: "Activity", kind: "bool", label: "Activity paused", hint: "Same as Pause/Resume on Overview." },
  { key: "points_per_spin", group: "Rewards", kind: "int", label: "Points per spin" },
  { key: "spin_interval_hours", group: "Rewards", kind: "int", label: "Spin interval (hours)" },
  { key: "referral_points", group: "Rewards", kind: "int", label: "Referral points" },
  { key: "register_points", group: "Rewards", kind: "int", label: "Register points" },
  { key: "x_connect_points", group: "Rewards", kind: "int", label: "X connect points" },
  { key: "x_post_points", group: "Rewards", kind: "int", label: "X post points (once per URL)" },
  { key: "x_post_daily_points", group: "Rewards", kind: "int", label: "X post daily points" },
  { key: "x_bio_daily_points", group: "Rewards", kind: "int", label: "X bio daily points" },
  { key: "join_channel_points", group: "Community", kind: "int", label: "Join channel points" },
  { key: "telegram_channel", group: "Community", kind: "string", label: "Telegram channel", hint: "e.g. @babygrand" },
  {
    key: "max_telegram_id",
    group: "Anti-abuse",
    kind: "int",
    label: "Max Telegram ID",
    hint: "0 = off. Higher ids earn no referral credit and are flagged.",
  },
  { key: "risk_threshold", group: "Anti-abuse", kind: "int", label: "Risk threshold", hint: "Users at or above are excluded from snapshots." },
  { key: "referral_burst_n", group: "Anti-abuse", kind: "int", label: "Referral burst: N children" },
  { key: "referral_burst_minutes", group: "Anti-abuse", kind: "int", label: "Referral burst: within minutes" },
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
    // presale_* keys are edited on the Presale page.
    .filter((k) => !KEYS.some((d) => d.key === k) && !k.startsWith("presale_"))
    .map((k) => ({ key: k, kind: kindOf(initial[k]), label: k, hint: undefined, group: "Other" as Group }));
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

  const GROUPS: { name: Group; desc: string }[] = [
    { name: "Activity", desc: "Global switch for all earning." },
    { name: "Rewards", desc: "Points granted for each action." },
    { name: "Community", desc: "Telegram channel task." },
    { name: "Anti-abuse", desc: "Thresholds used by risk scoring and snapshots." },
    { name: "Other", desc: "Keys returned by the API without a description here." },
  ];

  const control = (f: (typeof fields)[number]) =>
    f.kind === "bool" ? (
      <label className="field inline" style={{ justifySelf: "end" }}>
        <input
          type="checkbox"
          checked={Boolean(values[f.key])}
          disabled={!canEdit}
          onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
        />
        <span>{values[f.key] ? "On" : "Off"}</span>
      </label>
    ) : (
      <input
        type={f.kind === "int" ? "number" : "text"}
        min={f.kind === "int" ? 0 : undefined}
        step={f.kind === "int" ? 1 : undefined}
        value={values[f.key] === undefined ? "" : String(values[f.key])}
        disabled={!canEdit}
        aria-label={f.label}
        className={f.kind === "int" ? "num" : undefined}
        onChange={(e) =>
          setValues({
            ...values,
            [f.key]: f.kind === "int" && e.target.value !== "" ? Number(e.target.value) : e.target.value,
          })
        }
      />
    );

  return (
    <form className="stack" onSubmit={save} style={{ maxWidth: 860 }}>
      {GROUPS.map((g) => {
        const items = fields.filter((f) => (f.group ?? "Other") === g.name);
        if (!items.length) return null;
        return (
          <section key={g.name} className="card">
            <div className="card-head">
              <div>
                <h3>{g.name}</h3>
                <p>{g.desc}</p>
              </div>
            </div>
            <div className="form-rows">
              {items.map((f) => (
                <div key={f.key} className={`form-row${values[f.key] !== initial[f.key] ? " changed" : ""}`}>
                  <div>
                    <div className="label">
                      {f.label}
                      <code>{f.key}</code>
                    </div>
                    {f.hint && <div className="hint">{f.hint}</div>}
                  </div>
                  {control(f)}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <SuccessBox message={msg.ok} />
      <ErrorBox error={msg.err} />
      {canEdit && changed.length > 0 && (
        <div className="save-bar">
          <span className="muted">
            {changed.length} unsaved {changed.length === 1 ? "change" : "changes"}
          </span>
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setValues(initial)} disabled={busy}>
              Discard
            </button>
            <button className="btn primary" type="submit" disabled={busy}>
              <Save size={16} /> {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

export default function ConfigPage() {
  const { data, error, reload } = useGet<Record<string, Value>>("/config");
  return (
    <>
      <PageHeader title="Config" description="Point rewards and anti-abuse rules. Changes apply immediately." />
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {/* key remounts the form with fresh values after each load */}
      {data && <ConfigForm key={JSON.stringify(data)} initial={data} onSaved={reload} />}
    </>
  );
}
