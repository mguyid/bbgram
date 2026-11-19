"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Plug, RefreshCw, Save } from "lucide-react";
import { api, useGet } from "@/lib/api";
import { useAdmin } from "@/lib/auth";
import { isHexAddress } from "@/lib/format";
import type { Settings, TelegramStatus } from "@/lib/types";
import { Addr, ConfirmButton, ErrorBox, Loading, PageHeader, SuccessBox } from "@/components/ui";

const TABS = [
  { key: "telegram", label: "Telegram", desc: "Bot for the mini app, reminders and login hand-off." },
  { key: "x", label: "X", desc: "OAuth app for connecting users' X accounts." },
  { key: "chain", label: "Chain", desc: "Network the presale and airdrop run on." },
  { key: "contracts", label: "Contracts", desc: "Deployed contract addresses the backend reads from." },
  { key: "signer", label: "Presale signer", desc: "Signs whitelist allocations. The private key never leaves the server." },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Kind = "text" | "int" | "address";
type Field = { key: keyof Settings; label: string; kind: Kind; hint?: string };
type Msg = { ok?: string; err?: string };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function Badge({ ok, yes, no, warn }: { ok: boolean; yes: string; no: string; warn?: boolean }) {
  return <span className={`badge ${ok ? "green" : warn ? "amber" : "red"}`}>{ok ? yes : no}</span>;
}

async function putSettings(body: Record<string, unknown>) {
  await api("/settings", { method: "PUT", body });
}

/** One tab's form: its own fields, its own Save button, saves only what it owns. */
function FieldsForm({
  s,
  fields,
  secrets = [],
  onSaved,
  children,
}: {
  s: Settings;
  fields: Field[];
  secrets?: { key: string; label: string; isSet: boolean }[];
  onSaved: () => void;
  children?: ReactNode;
}) {
  const isOwner = useAdmin()?.role === "owner";
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, str(s[f.key])])),
  );
  const [sec, setSec] = useState<Record<string, string>>(() => Object.fromEntries(secrets.map((x) => [x.key, ""])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>({});

  const changed = fields.filter((f) => vals[f.key].trim() !== str(s[f.key]));
  const secretChanged = secrets.filter((x) => sec[x.key].trim());
  const count = changed.length + secretChanged.length;

  const run = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setMsg({});
    try {
      await putSettings(body);
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
      if (v && f.kind === "int" && !/^\d+$/.test(v)) return setMsg({ err: `${f.label} must be a whole number.` });
      if (v && f.kind === "address" && !isHexAddress(v)) return setMsg({ err: `${f.label} must be a 0x address.` });
      body[f.key] = v && f.kind === "int" ? Number(v) : v;
    }
    for (const x of secretChanged) body[x.key] = sec[x.key].trim();
    await run(body, "Saved.");
  };

  return (
    <form className="stack" onSubmit={save}>
      {fields.map((f) => (
        <label className="field" key={f.key}>
          <span>
            {f.label} {f.hint && <span className="muted">— {f.hint}</span>}
          </span>
          <input
            value={vals[f.key]}
            disabled={!isOwner}
            onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
          />
        </label>
      ))}
      {secrets.map((x) => (
        <div className="row" style={{ alignItems: "flex-end" }} key={x.key}>
          <label className="field" style={{ flex: 1, minWidth: 260 }}>
            <span>
              {x.label} <Badge ok={x.isSet} yes="Set" no="Not set" warn />
            </span>
            {isOwner && (
              <input
                type="password"
                autoComplete="new-password"
                placeholder={x.isSet ? "Leave empty to keep" : ""}
                value={sec[x.key]}
                onChange={(e) => setSec({ ...sec, [x.key]: e.target.value })}
              />
            )}
          </label>
          {isOwner && x.isSet && (
            <ConfirmButton
              label="Clear"
              title={`Clear ${x.label}?`}
              disabled={busy}
              onConfirm={() => run({ [x.key]: "" }, `${x.label} cleared.`)}
            />
          )}
        </div>
      ))}
      {children}
      <SuccessBox message={msg.ok} />
      <ErrorBox error={msg.err} />
      {isOwner && (
        <div>
          <button className="btn primary" type="submit" disabled={busy || count === 0}>
            <Save size={16} /> {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}

// ---------- Telegram ----------

function TelegramTab({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const isOwner = useAdmin()?.role === "owner";
  const status = useGet<TelegramStatus>("/settings/telegram");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>({});

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg({});
    try {
      await fn();
      setMsg({ ok });
      setToken("");
      onSaved();
      status.reload();
    } catch (err) {
      setMsg({ err: (err as Error).message });
    }
    setBusy(false);
  };

  const connect = (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    act(() => putSettings({ telegram_bot_token: token.trim() }), "Bot connected: webhook and menu button are set.");
  };

  const st = status.data;
  return (
    <div className="stack">
      <form className="stack" onSubmit={connect}>
        <label className="field">
          <span>
            Bot token <Badge ok={s.telegram_bot_token_set} yes="Set" no="Not set" warn />{" "}
            <span className="muted">— from @BotFather. Saving connects the bot automatically.</span>
          </span>
          {isOwner && (
            <input
              type="password"
              autoComplete="new-password"
              placeholder={s.telegram_bot_token_set ? "Paste a new token to replace" : "123456:ABC…"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          )}
        </label>
        {isOwner && (
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy || !token.trim()}>
              <Plug size={16} /> {busy ? "Connecting…" : "Save and connect"}
            </button>
            {s.telegram_bot_token_set && (
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => act(() => api("/settings/telegram/reconnect", { method: "POST" }), "Reconnected.")}
              >
                <RefreshCw size={16} /> Reconnect
              </button>
            )}
            {s.telegram_bot_token_set && (
              <ConfirmButton
                label="Remove token"
                title="Remove the bot token?"
                message="The bot stops answering and reminders stop until a token is saved again."
                disabled={busy}
                onConfirm={() => act(() => putSettings({ telegram_bot_token: "" }), "Bot token removed.")}
              />
            )}
          </div>
        )}
        <SuccessBox message={msg.ok} />
        <ErrorBox error={msg.err} />
      </form>

      <div className="card-inset stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h4 style={{ margin: 0 }}>Live status from Telegram</h4>
          <button className="btn small" type="button" onClick={status.reload} disabled={status.loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <ErrorBox error={status.error} />
        {!st && !status.error && <Loading />}
        {st && !st.token_set && <p className="muted small">No bot token saved yet.</p>}
        {st && st.token_set && (
          <dl className="kv">
            <dt>Bot</dt>
            <dd>
              {st.username ? (
                <a href={`https://t.me/${st.username}`} target="_blank" rel="noreferrer">
                  @{st.username}
                </a>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
            <dt>Telegram reachable</dt>
            <dd>
              <Badge ok={st.reachable} yes="Yes" no="No" />
            </dd>
            <dt>Webhook</dt>
            <dd className="stack" style={{ gap: 4 }}>
              <span>
                <Badge ok={st.webhook_ok} yes="Connected" no={st.webhook_url ? "Wrong URL" : "Not set"} />
              </span>
              <Addr value={st.webhook_url || st.expected_webhook_url} full />
              {!st.webhook_ok && st.webhook_url && (
                <span className="muted small">Should be {st.expected_webhook_url}. Press Reconnect.</span>
              )}
            </dd>
            <dt>Last delivery error</dt>
            <dd>{st.last_error ? <span style={{ color: "var(--danger)" }}>{st.last_error}</span> : <span className="muted">None</span>}</dd>
            <dt>Pending updates</dt>
            <dd>{st.pending_updates}</dd>
            <dt>Menu button</dt>
            <dd className="stack" style={{ gap: 4 }}>
              <span>
                <Badge ok={st.menu_ok} yes="Opens the mini app" no="Not set" />
              </span>
              <Addr value={st.menu_url || st.expected_menu_url} full />
            </dd>
          </dl>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          The worker checks this every 10 minutes and after each deploy, and reconnects the bot if anything points to the
          wrong place.
        </p>
      </div>
    </div>
  );
}

// ---------- Signer ----------

function SignerTab({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const isOwner = useAdmin()?.role === "owner";
  const [rotated, setRotated] = useState(false);
  return (
    <div className="stack">
      <div className="field">
        <span>Backend signer address</span>
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
    </div>
  );
}

// ---------- page ----------

function TabBody({ tab, s, onSaved }: { tab: TabKey; s: Settings; onSaved: () => void }) {
  switch (tab) {
    case "telegram":
      return <TelegramTab s={s} onSaved={onSaved} />;
    case "x":
      return (
        <FieldsForm
          s={s}
          onSaved={onSaved}
          fields={[{ key: "x_client_id", label: "Client ID", kind: "text" }]}
          secrets={[{ key: "x_client_secret", label: "Client secret", isSet: s.x_client_secret_set }]}
        >
          <div className="field">
            <span>Redirect URI — paste into the X developer portal</span>
            <Addr value={s.x_redirect_uri} full />
          </div>
        </FieldsForm>
      );
    case "chain":
      return (
        <FieldsForm
          s={s}
          onSaved={onSaved}
          fields={[
            { key: "chain_id", label: "Chain ID", kind: "int", hint: "56 = BSC mainnet, 97 = BSC testnet" },
            { key: "rpc_url", label: "RPC URL", kind: "text" },
          ]}
        />
      );
    case "contracts":
      return (
        <FieldsForm
          s={s}
          onSaved={onSaved}
          fields={[
            { key: "token_address", label: "Token address", kind: "address" },
            { key: "presale_address", label: "Presale address", kind: "address", hint: "saving reads USDT from the contract" },
            {
              key: "presale_start_block",
              label: "Presale start block",
              kind: "int",
              hint: "indexer starts here; filled automatically if empty",
            },
            { key: "airdrop_address", label: "Airdrop address", kind: "address" },
          ]}
        >
          <div className="field">
            <span>USDT address (read from the presale contract)</span>
            <Addr value={s.usdt_address} full />
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            On-chain values and owner actions are on the <Link href="/contracts">Contracts</Link> page.
          </p>
        </FieldsForm>
      );
    case "signer":
      return <SignerTab s={s} onSaved={onSaved} />;
  }
}

function hashTab(): TabKey {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return TABS.find((t) => t.key === h)?.key ?? "telegram";
}

export default function SettingsPage() {
  const { data, error, reload } = useGet<Settings>("/settings");
  const isOwner = useAdmin()?.role === "owner";
  const [picked, setPicked] = useState<TabKey | null>(null);
  // Tabs render only after settings load (client side), so reading the URL hash here is safe.
  const tab = picked ?? hashTab();

  const pick = (k: TabKey) => {
    setPicked(k);
    window.history.replaceState(null, "", `#${k}`);
  };
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <>
      <PageHeader title="Settings" description="Integrations, chain and contract configuration. Only the owner can edit." />
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="stack" style={{ maxWidth: 760 }}>
          {!isOwner && <div className="notice small">Only the owner can change settings.</div>}
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`tab${tab === t.key ? " active" : ""}`}
                onClick={() => pick(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <section className="card stack">
            <div>
              <h3>{current.label}</h3>
              <p className="muted small">{current.desc}</p>
            </div>
            {/* key: remount with fresh values after each save */}
            <TabBody key={`${tab}:${JSON.stringify(data)}`} tab={tab} s={data} onSaved={reload} />
          </section>
        </div>
      )}
    </>
  );
}
