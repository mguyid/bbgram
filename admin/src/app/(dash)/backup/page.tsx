"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { apiFetch, clearSession } from "@/lib/api";
import { useAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { ConfirmButton, ErrorBox } from "@/components/ui";

type RestoreResult = { ok: boolean; tables: Record<string, number>; created_at: string };

function ExportCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/backup/export");
      const name =
        /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "babygrand-backup.jsonl.gz";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="card stack">
      <h3>Export</h3>
      <p>
        Download a full copy of the database: users, points, snapshots, airdrops, presale data, settings, admins and the
        audit log.
      </p>
      <div>
        <button type="button" className="btn primary" onClick={download} disabled={busy}>
          <Download size={16} /> {busy ? "Downloading…" : "Download backup"}
        </button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function ImportCard() {
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<RestoreResult | null>(null);

  const restore = async () => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("confirm", confirm);
    const res = await apiFetch("/backup/import", { method: "POST", body: form });
    setResult((await res.json()) as RestoreResult);
    clearSession(); // admin accounts may have changed: sign in again
  };

  if (result) {
    return (
      <div className="card stack">
        <h3>Restore complete</h3>
        <p>Restored the backup from {formatDate(result.created_at)}.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.tables).map(([name, count]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">You have been signed out because admin accounts may have changed.</p>
        <div>
          <button type="button" className="btn primary" onClick={() => window.location.replace("/login")}>
            Sign in again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card danger-zone stack">
      <h3 className="bad">Import (danger zone)</h3>
      <div className="error">
        Restoring replaces ALL data (users, points, settings, admins, audit log) with the backup&apos;s contents. Admin
        logins in the backup replace the current ones. Encrypted settings only work if this server uses the same
        JWT_SECRET as the one that made the backup.
      </div>
      <label className="field">
        <span>Backup file (.jsonl.gz)</span>
        <input type="file" accept=".gz" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="field">
        <span>Type RESTORE to confirm</span>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESTORE" />
      </label>
      <div>
        <ConfirmButton
          label={
            <>
              <Upload size={16} /> Restore
            </>
          }
          title="Restore this backup?"
          message={
            <>
              All current data will be replaced with the contents of <strong>{file?.name}</strong>. This cannot be
              undone.
            </>
          }
          confirmLabel="Restore"
          disabled={!file || confirm !== "RESTORE"}
          onConfirm={restore}
        />
      </div>
    </div>
  );
}

export default function BackupPage() {
  const me = useAdmin();
  if (me?.role !== "owner") return <p className="muted">Only the owner can manage backups</p>;

  return (
    <>
      <h1>Backup</h1>
      <p className="notice">
        Backup files contain password hashes, 2FA secrets and encrypted keys. Store them somewhere safe.
      </p>
      <div className="stack">
        <ExportCard />
        <ImportCard />
      </div>
    </>
  );
}
