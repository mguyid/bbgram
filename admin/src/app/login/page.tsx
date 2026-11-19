"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, setSession, type Admin } from "@/lib/api";
import { ErrorBox } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getToken()) router.replace("/");
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; admin: Admin }>("/auth/login", {
        method: "POST",
        body: { email: email.trim(), password, totp },
      });
      setSession(res.token, res.admin);
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login stack" onSubmit={submit}>
        <h1>Baby Grand Admin</h1>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        <label className="field">
          <span>2FA code</span>
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
            required
            autoComplete="one-time-code"
            placeholder="123456"
          />
        </label>
        <ErrorBox error={error} />
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
