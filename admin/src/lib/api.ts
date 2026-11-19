"use client";

import { useCallback, useEffect, useState } from "react";

export type Role = "owner" | "admin" | "viewer";
export type Admin = { id: number | string; email: string; role: Role };

const BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "") + "/admin-api";
const TOKEN_KEY = "bg_admin_token";
const ADMIN_KEY = "bg_admin";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredAdmin(): Admin | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(ADMIN_KEY);
  try {
    return raw ? (JSON.parse(raw) as Admin) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, admin: Admin) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}

export function setStoredAdmin(admin: Admin) {
  sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}

export function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ADMIN_KEY);
  window.location.replace("/login");
}

function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === "object" && d && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
      .join("; ");
  }
  return `Request failed (${status})`;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.status === 401 && !path.startsWith("/auth/")) {
    logout();
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(errorMessage(body, res.status));
  return body as T;
}

/** GET a path and keep the result in state. Pass null to skip. */
export function useGet<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: string }>({ path: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path).then(
      (data) => alive && setState({ path, data }),
      (e: Error) => alive && setState((s) => ({ path, data: s.data, error: e.message })),
    );
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.path !== path, reload };
}

/** Accepts either a bare array or {items: [...]}. */
export function itemsOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const items = (data as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}
