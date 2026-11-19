"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useGet } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { Addr, DateCell, EmptyRow, ErrorBox, Loading, PageHeader, Pager, RiskBadge, UserCell } from "@/components/ui";
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
      <PageHeader
        title="Users"
        description={data ? `${formatNumber(data.total)} users registered through the mini app.` : "Everyone registered through the mini app."}
      />
      <form className="inline card" onSubmit={submit} style={{ marginBottom: 16, padding: "14px 16px" }}>
        <label className="field" style={{ flex: "1 1 320px" }}>
          <span>Search</span>
          <div className="search">
            <Search size={15} />
            <input
              value={form.q}
              onChange={(e) => setForm({ ...form, q: e.target.value })}
              placeholder="Username, Telegram ID, wallet or X handle"
            />
          </div>
        </label>
        <label className="field">
          <span>Min risk</span>
          <input
            type="number"
            min={0}
            max={100}
            value={form.min_risk}
            onChange={(e) => setForm({ ...form, min_risk: e.target.value })}
            placeholder="0–100"
            style={{ width: 100 }}
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={form.banned} onChange={(e) => setForm({ ...form, banned: e.target.value })} style={{ width: 150 }}>
            <option value="">All users</option>
            <option value="false">Active</option>
            <option value="true">Banned</option>
          </select>
        </label>
        <button className="btn primary" type="submit">
          Apply filters
        </button>
      </form>

      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
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
                    <td className="muted num">{u.id}</td>
                    <td>
                      <UserCell id={u.id} username={u.username} />
                    </td>
                    <td className="muted num">{u.telegram_id}</td>
                    <td className="num">
                      <strong>{formatNumber(u.balance)}</strong>
                    </td>
                    <td className="num">
                      <RiskBadge score={u.risk_score} />
                    </td>
                    <td>
                      <Addr value={u.wallet_address} />
                    </td>
                    <td>{u.x_username ? `@${u.x_username}` : <span className="faint">—</span>}</td>
                    <td>
                      {u.banned ? <span className="badge red">Banned</span> : <span className="badge green">Active</span>}
                    </td>
                    <td>
                      <DateCell value={u.created_at} />
                    </td>
                  </tr>
                ))}
                {!data.items.length && <EmptyRow cols={9} title="No users match" text="Try a different search or clear the filters." />}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} count={data.items.length} onPage={setPage} />
        </>
      )}
    </>
  );
}
