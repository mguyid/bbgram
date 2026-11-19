"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban } from "lucide-react";
import { api, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { ConfirmButton, EmptyRow, ErrorBox, Loading, PageHeader } from "@/components/ui";

type Cluster = { kind: "ip" | "device" | "referrer"; key: string; user_ids: number[]; count: number };
const KINDS = ["all", "ip", "device", "referrer"] as const;
const MAX_IDS_SHOWN = 20;

export default function ClustersPage() {
  const canEdit = useCanEdit();
  const { data, error, loading, reload } = useGet<{ items: Cluster[] }>("/clusters");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const all = data?.items ?? [];
  const rows = kind === "all" ? all : all.filter((c) => c.kind === kind);
  const id = (c: Cluster) => `${c.kind}:${c.key}`;
  const userIds = Array.from(new Set(all.filter((c) => selected.has(id(c))).flatMap((c) => c.user_ids)));

  const toggle = (c: Cluster) => {
    const next = new Set(selected);
    if (next.has(id(c))) next.delete(id(c));
    else next.add(id(c));
    setSelected(next);
  };

  return (
    <>
      <PageHeader
        title="Clusters"
        description="Groups of accounts that share an IP address, a device or a referrer. Review them for multi-accounting."
      />
      <div className="toolbar">
        <div className="tabs">
          {KINDS.map((k) => (
            <button key={k} type="button" className={`tab${kind === k ? " active" : ""}`} onClick={() => setKind(k)}>
              {k === "all" ? "All" : k === "ip" ? "IP" : k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
        {canEdit && (
          <div className="row">
            <ConfirmButton
              label={
                <>
                  <Ban size={16} /> Ban selected ({userIds.length} users)
                </>
              }
              disabled={!userIds.length}
              title={`Ban ${userIds.length} users?`}
              message={`All accounts in the ${selected.size} selected cluster(s) will be banned.`}
              confirmLabel="Ban all"
              askReason
              onConfirm={async (reason) => {
                await api("/clusters/ban", { method: "POST", body: { user_ids: userIds, reason } });
                setSelected(new Set());
                reload();
              }}
            />
            {selected.size > 0 && (
              <button type="button" className="btn ghost" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            )}
          </div>
        )}
      </div>
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canEdit && <th />}
                <th>Kind</th>
                <th>Key</th>
                <th className="num">Accounts</th>
                <th>User IDs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={id(c)}>
                  {canEdit && (
                    <td>
                      <input type="checkbox" checked={selected.has(id(c))} onChange={() => toggle(c)} />
                    </td>
                  )}
                  <td>
                    <span className="badge plain blue">{c.kind === "ip" ? "IP" : c.kind[0].toUpperCase() + c.kind.slice(1)}</span>
                  </td>
                  <td>
                    {c.kind === "referrer" ? (
                      <Link href={`/users/${c.key}`}>{c.key}</Link>
                    ) : (
                      <code>{c.key}</code>
                    )}
                  </td>
                  <td className="num">
                    <strong>{c.count}</strong>
                  </td>
                  <td className="wrap">
                    {c.user_ids.slice(0, MAX_IDS_SHOWN).map((u, i) => (
                      <span key={u}>
                        {i > 0 && ", "}
                        <Link href={`/users/${u}`}>{u}</Link>
                      </span>
                    ))}
                    {c.user_ids.length > MAX_IDS_SHOWN && (
                      <span className="muted"> +{c.user_ids.length - MAX_IDS_SHOWN} more</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && <EmptyRow cols={5} title="No clusters" text="No accounts share an IP, device or referrer." />}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
