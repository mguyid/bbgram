"use client";

import { useState, type FormEvent } from "react";
import { Coins, ListChecks, Plus, Search, Trash2, Users } from "lucide-react";
import { api, itemsOf, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { formatNumber, formatWei, isHexAddress } from "@/lib/format";
import type { UserRow } from "@/lib/types";
import { Addr, ConfirmButton, DateCell, EmptyRow, ErrorBox, PageHeader, Stat, SuccessBox, UserCell } from "@/components/ui";

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
      <div className="card-head">
        <div>
          <h3>Add to whitelist</h3>
          <p>Whitelisted wallets can contribute during the presale.</p>
        </div>
      </div>
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
                        <UserCell id={u.id} username={u.username} />
                      </td>
                      <td className="muted">{u.telegram_id}</td>
                      <td>{u.wallet_address ? <Addr value={u.wallet_address} /> : <span className="muted">no wallet linked</span>}</td>
                      <td className="actions-cell">
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
                  {!results.length && <EmptyRow cols={4} title="No users found" />}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <SuccessBox message={msg.ok} />
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
      <PageHeader title="Presale" description="Manage the wallet whitelist and track USDT contributions indexed from the chain." />
      {contrib.data && (
        <div className="grid" style={{ marginBottom: 8 }}>
          <Stat
            label="Raised"
            icon={Coins}
            value={
              <>
                {formatWei(contrib.data.raised_wei, 2)} <span className="stat-sub">USDT</span>
              </>
            }
          />
          <Stat label="Contributions" icon={Users} value={formatNumber(contrib.data.items.length)} />
          <Stat label="Whitelisted wallets" icon={ListChecks} value={formatNumber(whitelist.length)} />
        </div>
      )}

      <h2>
        Whitelist <span className="badge plain">{whitelist.length}</span>
      </h2>
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
                  {w.user_id ? <UserCell id={w.user_id} username={w.username} /> : <span className="faint">—</span>}
                </td>
                <td>
                  <DateCell value={w.created_at} />
                </td>
                {canEdit && (
                  <td className="actions-cell">
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
              <EmptyRow cols={4} title="Whitelist is empty" text="Add wallets above to let them contribute." />
            )}
          </tbody>
        </table>
      </div>

      <h2>Contributions</h2>
      <ErrorBox error={contrib.error} />
      {contrib.data && (
        <>
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
                    <td>{c.user_id ? <UserCell id={c.user_id} /> : <span className="faint">—</span>}</td>
                    <td className="num">
                      <strong>{formatWei(c.amount_wei, 2)}</strong>
                    </td>
                    <td>
                      <Addr value={c.tx_hash} />
                    </td>
                    <td className="num muted">{c.block_number}</td>
                    <td>
                      <DateCell value={c.created_at} />
                    </td>
                  </tr>
                ))}
                {!contrib.data.items.length && (
                  <EmptyRow cols={6} title="No contributions yet" text="Contributions appear once the indexer sees them on chain." />
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
