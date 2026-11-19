"use client";

import dynamic from "next/dynamic";
import { itemsOf, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import type { Airdrop, Settings } from "@/lib/types";
import { ErrorBox } from "@/components/ui";

// Wallet + chain libraries load only here.
const ContractsAdmin = dynamic(() => import("@/components/contracts/ContractsAdmin"), {
  ssr: false,
  loading: () => <p className="muted">Loading…</p>,
});

export default function ContractsPage() {
  const canEdit = useCanEdit();
  const settings = useGet<Settings>("/settings");
  const airdrops = useGet<unknown>("/airdrops");
  return (
    <>
      <h1>Contracts</h1>
      <ErrorBox error={settings.error || airdrops.error} />
      {!settings.data && !settings.error && <p className="muted">Loading…</p>}
      {settings.data && (
        <ContractsAdmin settings={settings.data} airdrops={itemsOf<Airdrop>(airdrops.data)} canEdit={canEdit} />
      )}
    </>
  );
}
