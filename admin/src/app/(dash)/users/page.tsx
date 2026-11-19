"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useGet } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { Addr, ErrorBox, Pager } from "@/components/ui";
import type { UserRow } from "@/lib/types";

const PAGE_SIZE = 50;

export default function UsersPage() {
  const [form, setForm] = useState({ q: "", min_risk: "", banned: "" });
  const [filters, setFilters] = useState(form);
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.min_risk !== "") params.set("min_risk", filters.min_risk);
  if (filters.banned !== "") params.set("banned", filters.banned);
  const { data, error, loading } = useGet<{ items: UserRow[]; total: number }>(`/users?${params}`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFilters(form);
    setPage(1);
  };

  return (
    <>
      <h1>Users</h1>
      <form className="inline card" onSubmit={submit} style={{ marginBottom: 14 }}>
        <label className="field">
          <span>Search</span>
          <input
            value={form.q}
            onChange={(e) => setForm({ ...form, q: e.target.value })}
            placeholder="username, telegram id, wallet, X"
          />
        </label>
        <label className="field">
          <span>Min risk</span>
          <input
            type="number"
            min={0}
            max={100}
            value={form.min_risk}
            onChange={(e) => setForm({ ...form, min_risk: e.target.value })}
            style={{ width: 90 }}
          />
        </label>
        <label className="field">
          <span>Banned</span>
          <select value={form.banned} onChange={(e) => setForm({ ...form, banned: e.target.value })}>
            <option value="">Any</option>
            <option value="true">Banned</option>
            <option value="false">Not banned</option>
          </select>
        </label>
        <button className="btn primary" type="submit">
          <Search size={16} /> Search
        </button>
      </form>

      <ErrorBox error={error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Username</th>
                  <th>Telegram ID</th>
                  <th className="num">Balance</th>
                  <th className="num">Risk</th>
                  <th>Wallet</th>
                  <th>X</th>
                  <th>Status</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/users/${u.id}`}>{u.id}</Link>
                    </td>
                    <td>
                      <Link href={`/users/${u.id}`}>{u.username ? `@${u.username}` : "—"}</Link>
                    </td>
                    <td>{u.telegram_id}</td>
                    <td className="num">{formatNumber(u.balance)}</td>
                    <td className="num">{u.risk_score ?? "—"}</td>
                    <td>
                      <Addr value={u.wallet_address} />
                    </td>
                    <td>{u.x_username ? `@${u.x_username}` : "—"}</td>
                    <td>{u.banned ? <span className="badge red">banned</span> : <span className="muted">ok</span>}</td>
                    <td>{formatDate(u.created_at)}</td>
                  </tr>
                ))}
                {!data.items.length && (
                  <tr>
                    <td colSpan={9} className="muted">
                      No users match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} count={data.items.length} onPage={setPage} />
        </>
      )}
    </>
  );
}
