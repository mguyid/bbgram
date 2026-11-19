"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Plus, Search, Trash2 } from "lucide-react";
import { api, itemsOf, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { formatDate, formatWei, isHexAddress } from "@/lib/format";
import type { UserRow } from "@/lib/types";
import { Addr, ConfirmButton, ErrorBox } from "@/components/ui";

type WhitelistRow = { wallet_address: string; user_id?: number | null; username?: string | null; created_at?: string };
type Contribution = {
  wallet_address: string;
  user_id: number | null;
  amount_wei: string;
  tx_hash: string;
  block_number: number;
  created_at: string;
};

function AddToWhitelist({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<"wallet" | "user">("wallet");
  const [wallet, setWallet] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserRow[] | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);

  const add = async (wallet_address: string, user_id?: number) => {
    setBusy(true);
    setMsg({});
    try {
      await api("/presale/whitelist", { method: "POST", body: user_id ? { wallet_address, user_id } : { wallet_address } });
      setMsg({ ok: `Added ${wallet_address}.` });
      setWallet("");
      onAdded();
    } catch (err) {
      setMsg({ err: (err as Error).message });
    }
    setBusy(false);
  };

  const addWallet = (e: FormEvent) => {
    e.preventDefault();
    if (!isHexAddress(wallet.trim())) {
      setMsg({ err: "Enter a valid 0x address (40 hex characters)." });
      return;
    }
    add(wallet.trim());
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setMsg({});
    try {
      const res = await api<{ items: UserRow[] }>(`/users?q=${encodeURIComponent(q.trim())}&page=1&page_size=20`);
      setResults(res.items);
    } catch (err) {
      setMsg({ err: (err as Error).message });
    }
  };

  return (
    <div className="card">
      <div className="tabs">
        <button type="button" className={`tab${mode === "wallet" ? " active" : ""}`} onClick={() => setMode("wallet")}>
          By wallet address
        </button>
        <button type="button" className={`tab${mode === "user" ? " active" : ""}`} onClick={() => setMode("user")}>
          By user
        </button>
      </div>
      {mode === "wallet" ? (
        <form className="inline" onSubmit={addWallet}>
          <label className="field" style={{ flex: 1, minWidth: 280 }}>
            <span>Wallet address</span>
            <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" required />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            <Plus size={16} /> Add
          </button>
        </form>
      ) : (
        <>
          <form className="inline" onSubmit={search}>
            <label className="field" style={{ flex: 1, minWidth: 280 }}>
              <span>Find user</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="username or telegram id" required />
            </label>
            <button className="btn" type="submit">
              <Search size={16} /> Search
            </button>
          </form>
          {results && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <tbody>
                  {results.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Link href={`/users/${u.id}`}>{u.username ? `@${u.username}` : `User ${u.id}`}</Link>
                      </td>
                      <td>{u.telegram_id}</td>
                      <td>{u.wallet_address ? <Addr value={u.wallet_address} /> : <span className="muted">no wallet linked</span>}</td>
                      <td>
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={!u.wallet_address || busy}
                          onClick={() => u.wallet_address && add(u.wallet_address, u.id)}
                        >
                          <Plus size={14} /> Whitelist wallet
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!results.length && (
                    <tr>
                      <td className="muted">No users found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {msg.ok && <div className="ok" style={{ marginTop: 8 }}>{msg.ok}</div>}
      <ErrorBox error={msg.err} />
    </div>
  );
}

export default function PresalePage() {
  const canEdit = useCanEdit();
  const wl = useGet<unknown>("/presale/whitelist");
  const contrib = useGet<{ raised_wei: string; items: Contribution[] }>("/presale/contributions");
  const whitelist = itemsOf<WhitelistRow>(wl.data);

  return (
    <>
      <h1>Presale</h1>

      <h2>Whitelist ({whitelist.length})</h2>
      {canEdit && <AddToWhitelist onAdded={wl.reload} />}
      <ErrorBox error={wl.error} />
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Wallet</th>
              <th>User</th>
              <th>Added</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {whitelist.map((w) => (
              <tr key={w.wallet_address}>
                <td>
                  <Addr value={w.wallet_address} />
                </td>
                <td>
                  {w.user_id ? (
                    <Link href={`/users/${w.user_id}`}>{w.username ? `@${w.username}` : `User ${w.user_id}`}</Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{formatDate(w.created_at)}</td>
                {canEdit && (
                  <td>
                    <ConfirmButton
                      label={<Trash2 size={14} />}
                      className="btn danger small"
                      title="Remove from whitelist?"
                      message={<code>{w.wallet_address}</code>}
                      confirmLabel="Remove"
                      onConfirm={async () => {
                        await api(`/presale/whitelist/${w.wallet_address}`, { method: "DELETE" });
                        wl.reload();
                      }}
                    />
                  </td>
                )}
              </tr>
            ))}
            {wl.data !== undefined && !whitelist.length && (
              <tr>
                <td colSpan={4} className="muted">
                  Whitelist is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Contributions</h2>
      <ErrorBox error={contrib.error} />
      {contrib.data && (
        <>
          <div className="card" style={{ marginBottom: 12, display: "inline-block" }}>
            <div className="muted small">Raised (USDT)</div>
            <div className="stat-value">{formatWei(contrib.data.raised_wei, 2)}</div>
            <div className="muted small">{contrib.data.items.length} contributions</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>User</th>
                  <th className="num">Amount (USDT)</th>
                  <th>Tx</th>
                  <th className="num">Block</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {contrib.data.items.map((c) => (
                  <tr key={c.tx_hash + c.wallet_address + c.amount_wei}>
                    <td>
                      <Addr value={c.wallet_address} />
                    </td>
                    <td>{c.user_id ? <Link href={`/users/${c.user_id}`}>{c.user_id}</Link> : "—"}</td>
                    <td className="num">{formatWei(c.amount_wei, 2)}</td>
                    <td>
                      <Addr value={c.tx_hash} />
                    </td>
                    <td className="num">{c.block_number}</td>
                    <td>{formatDate(c.created_at)}</td>
                  </tr>
                ))}
                {!contrib.data.items.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No contributions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
