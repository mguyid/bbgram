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
import { BrandMark, Loading } from "@/components/ui";

type NavItem = { href: string; label: string; icon: typeof Users; ownerOnly?: boolean };

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Community",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/users", label: "Users", icon: Users },
      { href: "/clusters", label: "Clusters", icon: Network },
      { href: "/x", label: "X review", icon: AtSign },
    ],
  },
  {
    label: "Token",
    items: [
      { href: "/snapshots", label: "Snapshots", icon: Camera },
      { href: "/presale", label: "Presale", icon: Ticket },
      { href: "/contracts", label: "Contracts", icon: FileCode },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/config", label: "Config", icon: SlidersHorizontal },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/admins", label: "Admins", icon: ShieldCheck, ownerOnly: true },
      { href: "/backup", label: "Backup", icon: Archive, ownerOnly: true },
      { href: "/audit", label: "Audit log", icon: FileClock },
      { href: "/account", label: "Account", icon: UserCog },
    ],
  },
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

  if (!admin) return <Loading full />;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <AdminContext.Provider value={admin}>
      <div className="shell">
        <nav className="sidebar" aria-label="Main">
          <Link href="/" className="brand">
            <BrandMark />
            <span>
              <div className="brand-name">Baby Grand</div>
              <div className="brand-sub">Operations console</div>
            </span>
          </Link>
          {NAV.map((group) => {
            const items = group.items.filter((n) => !n.ownerOnly || admin.role === "owner");
            if (!items.length) return null;
            return (
              <div key={group.label} className="nav-group">
                <div className="nav-label">{group.label}</div>
                {items.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={`nav-link${isActive(href) ? " active" : ""}`}
                    aria-current={isActive(href) ? "page" : undefined}
                  >
                    <Icon size={17} strokeWidth={1.9} /> {label}
                  </Link>
                ))}
              </div>
            );
          })}
          <div className="sidebar-foot">
            <span className="avatar">{admin.email.slice(0, 1)}</span>
            <div className="who">
              <div className="who-email" title={admin.email}>
                {admin.email}
              </div>
              <div className="who-role">{admin.role}</div>
            </div>
            <button type="button" className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </nav>
        <main className="main">
          <div className="content">{children}</div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}
