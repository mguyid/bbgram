"use client";

import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { api, setStoredAdmin, useGet, type Admin } from "@/lib/api";
import { ErrorBox } from "@/components/ui";

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>6-digit code from your app</span>
      <input
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        required
        autoComplete="one-time-code"
        placeholder="123456"
      />
    </label>
  );
}

export default function AccountPage() {
  const { data: me, error: loadError, reload } = useGet<Admin>("/me");
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  const done = (a: Admin) => {
    setStoredAdmin(a);
    setSetup(null);
    setCode("");
    reload();
  };

  const start = () =>
    run(async () => {
      const res = await api<{ secret: string; uri: string }>("/me/2fa/setup", {
        method: "POST",
      });
      setSetup({
        secret: res.secret,
        qr: await QRCode.toDataURL(res.uri, { margin: 1, width: 200 }),
      });
    });

  const enable = (e: FormEvent) => {
    e.preventDefault();
    run(async () => done(await api<Admin>("/me/2fa/enable", { method: "POST", body: { code } })));
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    run(async () => done(await api<Admin>("/me/2fa/disable", { method: "POST", body: { code } })));
  };

  return (
    <>
      <h1>Account</h1>
      <ErrorBox error={loadError} />
      {me && (
        <div className="card stack" style={{ maxWidth: 520 }}>
          <div>
            <strong>{me.email}</strong> <span className="muted">· {me.role}</span>
          </div>
          <h2>Two-factor authentication</h2>

          {me.totp_enabled ? (
            <form className="stack" onSubmit={disable}>
              <div>
                <span className="badge green">on</span> Sign-in asks for a code from your authenticator app.
              </div>
              <CodeInput value={code} onChange={setCode} />
              <button className="btn danger" type="submit" disabled={busy}>
                Turn off 2FA
              </button>
            </form>
          ) : setup ? (
            <form className="stack" onSubmit={enable}>
              <div>
                Scan this with an authenticator app (Google Authenticator, Authy, 1Password…), or enter the key.
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="qr" src={setup.qr} alt="2FA QR code" />
              <code className="json">{setup.secret}</code>
              <CodeInput value={code} onChange={setCode} />
              <div className="inline">
                <button className="btn primary" type="submit" disabled={busy}>
                  Turn on 2FA
                </button>
                <button className="btn ghost" type="button" onClick={() => setSetup(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="stack">
              <div className="muted">Off. Sign-in needs only email and password.</div>
              <div>
                <button className="btn primary" type="button" onClick={start} disabled={busy}>
                  Set up 2FA
                </button>
              </div>
            </div>
          )}
          <ErrorBox error={error} />
        </div>
      )}
    </>
  );
}
