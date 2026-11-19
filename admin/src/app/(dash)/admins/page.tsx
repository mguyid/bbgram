"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, itemsOf, useGet, type Admin, type Role } from "@/lib/api";
import { useAdmin } from "@/lib/auth";
import { ConfirmButton, DateCell, ErrorBox, PageHeader } from "@/components/ui";

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
      <div>
        <h3>Add an admin</h3>
        <p className="muted small">
          Viewers can read everything. Admins can also change data. Owners also manage settings, admins and backups.
        </p>
      </div>
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
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            style={{ width: 130 }}
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          <Plus size={16} /> Create admin
        </button>
      </form>
      <ErrorBox error={error} />
      {created && (
        <div className="success">
          <span>
            Created <strong>{created}</strong>. They sign in with email and password and can turn on 2FA under
            Account.
          </span>
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

  if (!isOwner) return <div className="notice">Only owners can manage admins.</div>;

  return (
    <>
      <PageHeader title="Admins" description="People who can sign in to this console." />
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
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}>
                <td className="muted num">{a.id}</td>
                <td>
                  <span className="user-cell">
                    <span className="avatar">{a.email.slice(0, 1)}</span>
                    {a.email}
                  </span>
                </td>
                <td>
                  <span className={`badge plain ${a.role === "owner" ? "blue" : a.role === "admin" ? "green" : ""}`}>
                    {a.role[0].toUpperCase() + a.role.slice(1)}
                  </span>
                </td>
                <td>{a.totp_enabled ? <span className="badge green">On</span> : <span className="badge">Off</span>}</td>
                <td>
                  <DateCell value={a.created_at} />
                </td>
                <td className="actions-cell">
                  {String(a.id) === String(me?.id) ? (
                    <span className="badge plain">You</span>
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
