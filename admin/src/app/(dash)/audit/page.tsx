"use client";

import { useState } from "react";
import { useGet } from "@/lib/api";
import { ErrorBox, Loading, ObjTable, PageHeader, Pager } from "@/components/ui";

type AuditPage = { items: Record<string, unknown>[]; total?: number; page_size?: number };

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useGet<AuditPage | Record<string, unknown>[]>(`/audit-log?page=${page}`);
  const items = Array.isArray(data) ? data : (data?.items ?? []);
  const total = Array.isArray(data) ? undefined : data?.total;
  const pageSize = Array.isArray(data) ? undefined : data?.page_size;

  return (
    <>
      <PageHeader title="Audit log" description="Every admin action, newest first." />
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          <ObjTable rows={items} userLinkKeys={[]} empty="No admin actions recorded yet." />
          <Pager page={page} total={total} pageSize={pageSize} count={items.length} onPage={setPage} />
        </>
      )}
    </>
  );
}
