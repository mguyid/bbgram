"use client";

import { useState } from "react";
import { useGet } from "@/lib/api";
import { ErrorBox, ObjTable, Pager } from "@/components/ui";

type AuditPage = { items: Record<string, unknown>[]; total?: number; page_size?: number };

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useGet<AuditPage | Record<string, unknown>[]>(`/audit-log?page=${page}`);
  const items = Array.isArray(data) ? data : (data?.items ?? []);
  const total = Array.isArray(data) ? undefined : data?.total;
  const pageSize = Array.isArray(data) ? undefined : data?.page_size;

  return (
    <>
      <h1>Audit log</h1>
      <ErrorBox error={error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data && (
        <>
          <ObjTable rows={items} userLinkKeys={[]} empty="No entries." />
          <Pager page={page} total={total} pageSize={pageSize} count={items.length} onPage={setPage} />
        </>
      )}
    </>
  );
}
