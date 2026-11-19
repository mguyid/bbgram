"use client";

import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { api, setStoredAdmin, useGet, type Admin } from "@/lib/api";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { ErrorBox, Loading, PageHeader } from "@/components/ui";

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
        placeholder="000000"
        className="otp"
        style={{ maxWidth: 200 }}
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
      <PageHeader title="Account" description="Your sign-in details and two-factor authentication." />
      <ErrorBox error={loadError} />
      {!me && !loadError && <Loading />}
      {me && (
        <div className="stack" style={{ maxWidth: 620 }}>
          <div className="card row" style={{ gap: 14 }}>
            <span className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>
              {me.email.slice(0, 1)}
            </span>
            <div>
              <div style={{ fontWeight: 600 }}>{me.email}</div>
              <div className="muted small" style={{ textTransform: "capitalize" }}>{me.role}</div>
            </div>
          </div>
          <div className="card stack">
            <div className="card-head" style={{ marginBottom: 0 }}>
              <div className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
                <div className={`status-orb ${me.totp_enabled ? "on" : "off"}`}>
                  {me.totp_enabled ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
                </div>
                <div>
                  <h3>Two-factor authentication</h3>
                  <p>A code from an authenticator app is asked for at every sign-in.</p>
                </div>
              </div>
              {me.totp_enabled ? <span className="badge green">On</span> : <span className="badge amber">Off</span>}
            </div>

            {me.totp_enabled ? (
              <form className="stack" onSubmit={disable}>
                <div className="muted">To turn 2FA off, confirm with a current code.</div>
                <CodeInput value={code} onChange={setCode} />
                <div>
                  <button className="btn danger" type="submit" disabled={busy}>
                    Turn off 2FA
                  </button>
                </div>
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
                <div className="row">
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
                <div className="muted">Sign-in currently needs only email and password. Turn on 2FA to protect this account.</div>
                <div>
                  <button className="btn primary" type="button" onClick={start} disabled={busy}>
                    Set up 2FA
                  </button>
                </div>
              </div>
            )}
            <ErrorBox error={error} />
          </div>
        </div>
      )}
    </>
  );
}
