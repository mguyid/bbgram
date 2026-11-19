"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { RefreshCw, Save } from "lucide-react";
import { api, useGet } from "@/lib/api";
import { useAdmin } from "@/lib/auth";
import { isHexAddress } from "@/lib/format";
import type { Settings } from "@/lib/types";
import { Addr, ConfirmButton, ErrorBox } from "@/components/ui";

type Kind = "text" | "int" | "address";
const EDITABLE: { key: keyof Settings; kind: Kind }[] = [
  { key: "x_client_id", kind: "text" },
  { key: "chain_id", kind: "int" },
  { key: "rpc_url", kind: "text" },
  { key: "token_address", kind: "address" },
  { key: "presale_address", kind: "address" },
  { key: "presale_start_block", kind: "int" },
  { key: "airdrop_address", kind: "address" },
];
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function Badge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={`badge ${ok ? "green" : "red"}`}>{ok ? yes : no}</span>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card stack">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

type Msg = { ok?: string; err?: string };

function SettingsForm({
  s,
  onSaved,
  msg,
  setMsg,
  rotated,
  setRotated,
}: {
  s: Settings;
  onSaved: () => void;
  msg: Msg;
  setMsg: (m: Msg) => void;
  rotated: boolean;
  setRotated: (v: boolean) => void;
}) {
  const isOwner = useAdmin()?.role === "owner";
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(EDITABLE.map((f) => [f.key, str(s[f.key])])),
  );
  const [secrets, setSecrets] = useState({ telegram_bot_token: "", x_client_secret: "" });
  const [busy, setBusy] = useState(false);

  const changed = EDITABLE.filter((f) => vals[f.key].trim() !== str(s[f.key]));
  const secretChanged = (Object.keys(secrets) as (keyof typeof secrets)[]).filter((k) => secrets[k].trim());
  const count = changed.length + secretChanged.length;

  const put = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setMsg({});
    try {
      await api("/settings", { method: "PUT", body });
      setMsg({ ok });
      onSaved();
    } catch (err) {
      setMsg({ err: (err as Error).message });
    }
    setBusy(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const f of changed) {
      const v = vals[f.key].trim();
      if (v && f.kind === "int" && !/^\d+$/.test(v)) return setMsg({ err: `${f.key} must be a whole number.` });
      if (v && f.kind === "address" && !isHexAddress(v)) return setMsg({ err: `${f.key} must be a 0x address.` });
      body[f.key] = v && f.kind === "int" ? Number(v) : v;
    }
    for (const k of secretChanged) body[k] = secrets[k].trim();
    await put(body, "Saved.");
  };

  const input = (key: keyof Settings, label: string, hint?: string) => (
    <label className="field">
      <span>
        {label} {hint && <span className="muted">— {hint}</span>}
      </span>
      <input
        value={vals[key]}
        disabled={!isOwner}
        onChange={(e) => setVals({ ...vals, [key]: e.target.value })}
      />
    </label>
  );

  const secret = (key: keyof typeof secrets, label: string, isSet: boolean) => (
    <div className="row" style={{ alignItems: "flex-end" }}>
      <label className="field" style={{ flex: 1, minWidth: 260 }}>
        <span>
          {label} <Badge ok={isSet} yes="set" no="not set" />
        </span>
        {isOwner && (
          <input
            type="password"
            autoComplete="new-password"
            placeholder={isSet ? "Leave empty to keep" : ""}
            value={secrets[key]}
            onChange={(e) => setSecrets({ ...secrets, [key]: e.target.value })}
          />
        )}
      </label>
      {isOwner && isSet && (
        <ConfirmButton
          label="Clear"
          title={`Clear ${label}?`}
          disabled={busy}
          onConfirm={() => put({ [key]: "" }, `${label} cleared.`)}
        />
      )}
    </div>
  );

  return (
    <form className="stack" onSubmit={save} style={{ maxWidth: 760 }}>
      {!isOwner && <div className="notice small">Only the owner can change settings.</div>}

      <Section title="Telegram">
        {secret("telegram_bot_token", "Bot token", s.telegram_bot_token_set)}
        <dl className="kv">
          <dt>Bot</dt>
          <dd>{s.telegram_bot_username ? `@${s.telegram_bot_username}` : <span className="muted">—</span>}</dd>
          <dt>Webhook</dt>
          <dd>
            <Badge ok={s.telegram_webhook_ok} yes="ok" no="not set" />
          </dd>
        </dl>
      </Section>

      <Section title="X">
        {input("x_client_id", "Client ID")}
        {secret("x_client_secret", "Client secret", s.x_client_secret_set)}
        <div className="field">
          <span>Redirect URI — paste into the X developer portal</span>
          <Addr value={s.x_redirect_uri} full />
        </div>
      </Section>

      <Section title="Chain">
        {input("chain_id", "Chain ID", "56 = BSC mainnet, 97 = BSC testnet")}
        {input("rpc_url", "RPC URL")}
      </Section>

      <Section title="Contracts">
        {input("token_address", "Token address")}
        {input("presale_address", "Presale address", "saving reads USDT from the contract")}
        {input("presale_start_block", "Presale start block", "indexer starts here; filled automatically if empty")}
        {input("airdrop_address", "Airdrop address")}
        <div className="field">
          <span>USDT address (read from the presale contract)</span>
          <Addr value={s.usdt_address} full />
        </div>
      </Section>

      <Section title="Presale signer">
        <div className="field">
          <span>Backend signer address (signs whitelist allocations; key stays on the server)</span>
          <Addr value={s.signer_address} full />
        </div>
        {isOwner && (
          <div>
            <ConfirmButton
              label={
                <>
                  <RefreshCw size={14} /> Rotate signer
                </>
              }
              title="Rotate the presale signer?"
              message="A new key is generated. Existing whitelist signatures stop working until you call setSigner with the new address on the Contracts page."
              confirmLabel="Rotate"
              disabled={busy}
              onConfirm={async () => {
                await api("/settings/rotate-signer", { method: "POST" });
                setRotated(true);
                onSaved();
              }}
            />
          </div>
        )}
        {rotated && (
          <div className="notice small">
            Signer rotated. Now set it on chain: <Link href="/contracts">Contracts → Presale → Set signer</Link>.
          </div>
        )}
      </Section>

      {msg.ok && <div className="ok">{msg.ok}</div>}
      <ErrorBox error={msg.err} />
      {isOwner && (
        <div>
          <button className="btn primary" type="submit" disabled={busy || !count}>
            <Save size={16} /> Save {count ? `(${count} changed)` : ""}
          </button>
        </div>
      )}
    </form>
  );
}

export default function SettingsPage() {
  const { data, error, reload } = useGet<Settings>("/settings");
  const [msg, setMsg] = useState<Msg>({});
  const [rotated, setRotated] = useState(false);
  return (
    <>
      <h1>Settings</h1>
      <ErrorBox error={error} />
      {!data && !error && <p className="muted">Loading…</p>}
      {data && <SettingsForm key={JSON.stringify(data)} s={data}
          onSaved={reload}
          msg={msg}
          setMsg={setMsg}
          rotated={rotated}
          setRotated={setRotated}
        />}
    </>
  );
}
