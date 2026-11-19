"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, itemsOf, useGet, type Admin, type Role } from "@/lib/api";
import { useAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { ConfirmButton, ErrorBox } from "@/components/ui";

type AdminRow = Admin & { created_at?: string };

function CreateAdmin({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<{
    email: string;
    password: string;
    role: Role;
  }>({
    email: "",
    password: "",
    role: "viewer",
  });
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await api<{ admin: Admin }>("/admins", {
        method: "POST",
        body: { ...form, email: form.email.trim() },
      });
      setCreated(res.admin?.email ?? form.email);
      setForm({ email: "", password: "", role: "viewer" });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="card stack">
      <form className="inline" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          <Plus size={16} /> Create admin
        </button>
      </form>
      <ErrorBox error={error} />
      {created && (
        <div className="notice">
          Created <strong>{created}</strong>. They sign in with email and password and can turn on 2FA under Account.
        </div>
      )}
    </div>
  );
}

export default function AdminsPage() {
  const me = useAdmin();
  const isOwner = me?.role === "owner";
  const { data, error, reload } = useGet<unknown>(isOwner ? "/admins" : null);
  const admins = itemsOf<AdminRow>(data);

  if (!isOwner) return <p className="muted">Only owners can manage admins.</p>;

  return (
    <>
      <h1>Admins</h1>
      <CreateAdmin onCreated={reload} />
      <ErrorBox error={error} />
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>Role</th>
              <th>2FA</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.email}</td>
                <td>{a.role}</td>
                <td>{a.totp_enabled ? <span className="badge green">on</span> : <span className="muted">off</span>}</td>
                <td>{formatDate(a.created_at)}</td>
                <td>
                  {String(a.id) === String(me?.id) ? (
                    <span className="muted small">you</span>
                  ) : (
                    <ConfirmButton
                      label={<Trash2 size={14} />}
                      className="btn danger small"
                      title="Delete admin?"
                      message={
                        <>
                          <strong>{a.email}</strong> will lose access immediately.
                        </>
                      }
                      confirmLabel="Delete"
                      onConfirm={async () => {
                        await api(`/admins/${a.id}`, { method: "DELETE" });
                        reload();
                      }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
