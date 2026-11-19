"use client";

import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { useCanEdit } from "@/lib/auth";
import { formatWei } from "@/lib/format";
import type { Airdrop } from "@/lib/types";
import { Addr, ErrorBox } from "./ui";

export async function downloadProofs(id: number | string) {
  const data = await api(`/airdrops/${id}/proofs`);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `airdrop-${id}-proofs.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Merkle root, proofs download and a link to set the root on the Contracts page. */
export function AirdropPanel({ airdrop }: { airdrop: Airdrop }) {
  const canEdit = useCanEdit();
  const [err, setErr] = useState<string | null>(null);

  const download = async () => {
    setErr(null);
    try {
      await downloadProofs(airdrop.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="card stack">
      <dl className="kv">
        <dt>Airdrop</dt>
        <dd>
          #{airdrop.id}{" "}
          {airdrop.active !== undefined && (
            <span className={`badge${airdrop.active ? " green" : ""}`}>{airdrop.active ? "active" : "not active"}</span>
          )}
        </dd>
        <dt>Merkle root</dt>
        <dd>
          <Addr value={airdrop.merkle_root} full />
        </dd>
        <dt>Total tokens</dt>
        <dd>{formatWei(airdrop.total_amount_wei)}</dd>
        <dt>Recipients</dt>
        <dd>{airdrop.recipients?.toLocaleString("en-US")}</dd>
      </dl>
      <div className="row">
        <button type="button" className="btn" onClick={download}>
          <Download size={16} /> Download proofs JSON
        </button>
        {canEdit && !airdrop.active && (
          <Link className="btn primary" href={`/contracts?root=${airdrop.merkle_root}`}>
            Set root on Contracts page
          </Link>
        )}
      </div>
      <ErrorBox error={err} />
    </div>
  );
}
