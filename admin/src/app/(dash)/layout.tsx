"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  Camera,
  FileCode,
  FileClock,
  LayoutDashboard,
  LogOut,
  Network,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  AtSign,
  UserCog,
  Users,
} from "lucide-react";
import { api, getStoredAdmin, getToken, logout, setStoredAdmin, type Admin } from "@/lib/api";
import { AdminContext } from "@/lib/auth";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/clusters", label: "Clusters", icon: Network },
  { href: "/x", label: "X review", icon: AtSign },
  { href: "/config", label: "Config", icon: SlidersHorizontal },
  { href: "/snapshots", label: "Snapshots", icon: Camera },
  { href: "/presale", label: "Presale", icon: Ticket },
  { href: "/contracts", label: "Contracts", icon: FileCode },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admins", label: "Admins", icon: ShieldCheck, ownerOnly: true },
  { href: "/backup", label: "Backup", icon: Archive, ownerOnly: true },
  { href: "/audit", label: "Audit log", icon: FileClock },
  { href: "/account", label: "Account", icon: UserCog },
];

export default function DashLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    let alive = true;
    api<Admin | { admin: Admin }>("/me").then(
      (res) => {
        const me = "admin" in res ? res.admin : res;
        const a = me && me.role ? me : getStoredAdmin();
        if (!alive) return;
        if (a) {
          setStoredAdmin(a);
          setAdmin(a);
        } else logout();
      },
      () => {
        /* 401 already redirects; on network errors fall back to the stored session */
        const a = getStoredAdmin();
        if (alive && a) setAdmin(a);
      },
    );
    return () => {
      alive = false;
    };
  }, [router]);

  if (!admin) return <div className="login-wrap muted">Loading…</div>;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <AdminContext.Provider value={admin}>
      <div className="shell">
        <nav className="sidebar">
          <div className="brand">Baby Grand Admin</div>
          {NAV.filter((n) => !n.ownerOnly || admin.role === "owner").map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`nav-link${isActive(href) ? " active" : ""}`}>
              <Icon size={16} /> {label}
            </Link>
          ))}
          <div className="sidebar-foot">
            <div className="small">{admin.email}</div>
            <div className="small muted">{admin.role}</div>
            <button type="button" className="btn ghost small" onClick={logout} style={{ marginTop: 6, paddingLeft: 0 }}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </nav>
        <main className="main">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}
