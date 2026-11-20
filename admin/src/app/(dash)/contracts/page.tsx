"use client";

import dynamic from "next/dynamic";
import { itemsOf, useGet } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import type { Airdrop, Settings } from "@/lib/types";
import { ErrorBox, Loading, PageHeader } from "@/components/ui";

// Wallet + chain libraries load only here.
const ContractsAdmin = dynamic(() => import("@/components/contracts/ContractsAdmin"), {
  ssr: false,
  loading: () => <Loading />,
});

export default function ContractsPage() {
  const canEdit = useCanEdit();
  const settings = useGet<Settings>("/settings");
  const airdrops = useGet<unknown>("/airdrops");
  return (
    <>
      <PageHeader
        title="Contracts"
        description="Connect an owner wallet to read and manage the token and airdrop contracts."
      />
      <ErrorBox error={settings.error || airdrops.error} />
      {!settings.data && !settings.error && <Loading />}
      {settings.data && (
        <ContractsAdmin settings={settings.data} airdrops={itemsOf<Airdrop>(airdrops.data)} canEdit={canEdit} />
      )}
    </>
  );
}
