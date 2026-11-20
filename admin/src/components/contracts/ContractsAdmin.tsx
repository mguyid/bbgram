"use client";

// Contracts page body (plan §3.10). Loaded with next/dynamic so the wallet libraries stay out of other pages.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { isAddress, parseUnits, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { api } from "@/lib/api";
import { formatWei } from "@/lib/format";
import type { Airdrop, Settings } from "@/lib/types";
import { Addr, ErrorBox } from "@/components/ui";
import { airdropAbi, erc20Abi, tokenAbi } from "./abi";
import { chainFor, explorerTx, initWallet, makePublicClient, plainError, projectId, sendTx } from "./wallet";

type Key = "token" | "airdrop";
type V = Record<string, unknown>;
type Values = { now: number; token: V; airdrop: V };
type Tx =
  | { phase: "idle" }
  | { phase: "wallet" }
  | { phase: "pending"; hash: string }
  | { phase: "confirmed"; hash: string; logError?: string }
  | { phase: "failed"; reason: string; hash?: string };

const ABIS: Record<Key, Abi> = { token: tokenAbi, airdrop: airdropAbi };
const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO32 = "0x" + "0".repeat(64);

// ---------- conversions ----------

const big = (v: unknown): bigint | undefined => (typeof v === "bigint" ? v : undefined);
const num = (v: unknown): number => Number(big(v) ?? 0n);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function amount(v: string, label: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(v.trim())) throw new Error(`${label}: enter a number like 100 or 0.5.`);
  return parseUnits(v.trim(), 18);
}
function percentToBps(v: string, label: string): bigint {
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${label}: enter a percent from 0 to 100.`);
  return BigInt(Math.round(n * 100));
}
function address(v: string, label: string): Address {
  if (!isAddress(v.trim())) throw new Error(`${label}: enter a valid 0x address.`);
  return v.trim() as Address;
}
function datetime(v: string, label: string): bigint {
  const t = new Date(v).getTime();
  if (!v || Number.isNaN(t)) throw new Error(`${label}: pick a date and time.`);
  return BigInt(Math.floor(t / 1000));
}
const bpsToPercent = (v: unknown) => (big(v) === undefined ? "" : String(num(v) / 100));
function toLocalInput(sec: unknown): string {
  const s = num(sec);
  if (!s) return "";
  const d = new Date(s * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function showTime(sec: unknown): ReactNode {
  const s = num(sec);
  return s ? new Date(s * 1000).toLocaleString() : <span className="muted">not set</span>;
}
function jsonArgs(args: readonly unknown[]): unknown[] {
  return args.map((a) => (typeof a === "bigint" ? a.toString() : Array.isArray(a) ? jsonArgs(a) : a));
}

// ---------- reads ----------

async function readAll(client: PublicClient, s: Settings, account?: Address): Promise<Values> {
  const call = (address: string | null | undefined, abi: Abi, functionName: string, args: unknown[] = []) =>
    address && isAddress(address)
      ? client.readContract({ address: address as Address, abi, functionName, args }).catch(() => undefined)
      : Promise.resolve(undefined);
  const group = async (address: string | null | undefined, abi: Abi, names: string[]) => {
    const vals = await Promise.all(names.map((n) => call(address, abi, n)));
    return Object.fromEntries(names.map((n, i) => [n, vals[i]])) as V;
  };
  const own = ["owner", "pendingOwner"];
  const [block, token, airdrop] = await Promise.all([
    client.getBlock(),
    group(s.token_address, tokenAbi, [
      ...own,
      ...["name", "symbol", "totalSupply", "treasury", "taxWallet", "buyTaxBps", "sellTaxBps", "socials"],
    ]),
    group(s.airdrop_address, airdropAbi, [...own, "token", "merkleRoot", "deadline"]),
  ]);
  const [airdropTokens, myTokens] = await Promise.all([
    call(s.token_address, erc20Abi, "balanceOf", [s.airdrop_address]),
    account ? call(s.token_address, erc20Abi, "balanceOf", [account]) : undefined,
  ]);
  return {
    now: Number(block.timestamp),
    token: { ...token, myBalance: myTokens },
    airdrop: { ...airdrop, tokenBalance: airdropTokens },
  };
}

// ---------- context + generic action form ----------

type Ctx = {
  settings: Settings;
  values: Values;
  account?: Address;
  canEdit: boolean;
  addresses: Record<Key, string | null>;
  run: (key: Key, method: string, args: readonly unknown[], setTx: (t: Tx) => void) => Promise<void>;
};
const CtxObj = createContext<Ctx | null>(null);
const useCtx = () => useContext(CtxObj)!;

type Field = {
  name: string;
  label: string;
  type?: "text" | "datetime-local" | "bool";
  initial?: string;
  placeholder?: string;
};

type ActionProps = {
  title: string;
  contract: Key;
  method: string;
  fields?: Field[];
  /** Turns the form values into call args; throw Error for invalid input. */
  build?: (v: Record<string, string>) => readonly unknown[];
  /** Who may send: the contract owner (default), the pending owner, or any connected wallet. */
  who?: "owner" | "pending" | "any";
  /** When set, the form is disabled and this reason is shown. */
  blocked?: string | false;
  confirm?: string;
  hint?: ReactNode;
  /** Extra controls that can fill fields (e.g. pick a built airdrop). */
  helpers?: (set: (name: string, value: string) => void) => ReactNode;
  danger?: boolean;
};

function TxStatus({ tx }: { tx: Tx }) {
  const { settings } = useCtx();
  const link = (hash: string) => {
    const url = explorerTx(Number(settings.chain_id) || 0, hash);
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        view on BscScan
      </a>
    ) : (
      <code>{hash}</code>
    );
  };
  if (tx.phase === "idle") return null;
  if (tx.phase === "wallet") return <div className="notice small">Waiting for wallet confirmation…</div>;
  if (tx.phase === "pending") return <div className="notice small">Pending… {link(tx.hash)}</div>;
  if (tx.phase === "confirmed")
    return (
      <div className="small">
        <span className="ok">Confirmed.</span> {link(tx.hash)}
        {tx.logError && <div className="bad">Audit log failed: {tx.logError}</div>}
      </div>
    );
  return (
    <div className="error small">
      Failed: {tx.reason} {tx.hash && link(tx.hash)}
    </div>
  );
}

function Action(props: ActionProps) {
  const { values, account, canEdit, run } = useCtx();
  const [tx, setTx] = useState<Tx>({ phase: "idle" });
  const v = values[props.contract];
  const who = props.who ?? "owner";
  const busy = tx.phase === "wallet" || tx.phase === "pending";
  let reason: string | false | undefined = props.blocked;
  if (!account) reason = "Connect a wallet.";
  else if (who === "owner" && !same(account, str(v.owner))) reason = reason || "Connected wallet is not the owner.";
  else if (who === "pending" && !same(account, str(v.pendingOwner)))
    reason = reason || "Connected wallet is not the pending owner.";

  const submit = async (vals: Record<string, string>) => {
    let args: readonly unknown[] = [];
    try {
      args = props.build ? props.build(vals) : [];
    } catch (e) {
      setTx({ phase: "failed", reason: (e as Error).message });
      return;
    }
    if (props.confirm && !window.confirm(props.confirm)) return;
    await run(props.contract, props.method, args, setTx);
  };

  if (!canEdit) return null;
  // Remount the inputs when the on-chain values they start from change.
  const initKey = (props.fields ?? []).map((f) => f.initial ?? "").join("|");
  return (
    <div className="card stack action">
      <div>
        <h3>
          {props.title} <code className="muted small">{props.method}</code>
        </h3>
        {props.hint && <div className="muted small">{props.hint}</div>}
      </div>
      <ActionForm
        key={initKey}
        fields={props.fields ?? []}
        disabled={!!reason || busy}
        danger={props.danger}
        label={busy ? "Working…" : props.title}
        helpers={props.helpers}
        onSubmit={submit}
      />
      {reason && <div className="muted small">{reason}</div>}
      <TxStatus tx={tx} />
    </div>
  );
}

function ActionForm({
  fields,
  disabled,
  danger,
  label,
  helpers,
  onSubmit,
}: {
  fields: Field[];
  disabled: boolean;
  danger?: boolean;
  label: string;
  helpers?: ActionProps["helpers"];
  onSubmit: (v: Record<string, string>) => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.type === "bool" ? "true" : "")])),
  );
  const set = (name: string, value: string) => setVals((s) => ({ ...s, [name]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(vals);
  };
  return (
    <form className="inline" onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.name} className="field" style={{ flex: f.type === "bool" ? undefined : 1, minWidth: 140 }}>
          <span>{f.label}</span>
          {f.type === "bool" ? (
            <select value={vals[f.name]} onChange={(e) => set(f.name, e.target.value)}>
              <option value="true">add (true)</option>
              <option value="false">remove (false)</option>
            </select>
          ) : (
            <input
              type={f.type === "datetime-local" ? "datetime-local" : "text"}
              value={vals[f.name]}
              placeholder={f.placeholder}
              onChange={(e) => set(f.name, e.target.value)}
            />
          )}
        </label>
      ))}
      {helpers?.(set)}
      <button type="submit" className={danger ? "btn danger" : "btn primary"} disabled={disabled}>
        {label}
      </button>
    </form>
  );
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv card">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v === undefined || v === null || v === "" ? <span className="muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

const A = (v: unknown) => (str(v) && str(v) !== ZERO ? <Addr value={str(v)} full /> : <span className="muted">none</span>);
const W = (v: unknown) => (big(v) === undefined ? undefined : formatWei(big(v)!.toString()));
const P = (v: unknown) => (big(v) === undefined ? undefined : `${num(v) / 100}%`);

// ---------- sections ----------

function Ownership({ contract }: { contract: Key }) {
  return (
    <>
      <Action
        title="Transfer ownership"
        contract={contract}
        method="transferOwnership"
        fields={[{ name: "to", label: "New owner address", placeholder: "0x…" }]}
        build={(v) => [address(v.to, "New owner")]}
        confirm="Start ownership transfer? The new owner must then accept it."
        hint="Step 1 of 2. The new owner then connects and presses Accept ownership."
        danger
      />
      <Action
        title="Accept ownership"
        contract={contract}
        method="acceptOwnership"
        who="pending"
        hint="Step 2 of 2, signed by the pending owner."
      />
    </>
  );
}

function TokenSection() {
  const { values, addresses } = useCtx();
  const t = values.token;
  const [check, setCheck] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const client = useClient();

  const lookup = async () => {
    if (!isAddress(check.trim())) return setChecked("Enter a valid address.");
    const a = addresses.token as Address;
    const args = [check.trim() as Address] as const;
    try {
      const [ex, pair] = await Promise.all([
        client.readContract({ address: a, abi: tokenAbi, functionName: "isTaxExempt", args }),
        client.readContract({ address: a, abi: tokenAbi, functionName: "isAmmPair", args }),
      ]);
      setChecked(`tax exempt: ${ex ? "yes" : "no"} · AMM pair: ${pair ? "yes" : "no"}`);
    } catch (e) {
      setChecked(plainError(e));
    }
  };

  return (
    <>
      <KV
        rows={[
          ["Address", A(addresses.token)],
          ["Name / symbol", t.name !== undefined ? `${str(t.name)} / ${str(t.symbol)}` : undefined],
          ["Total supply", W(t.totalSupply)],
          ["Owner", A(t.owner)],
          ["Pending owner", A(t.pendingOwner)],
          ["Treasury", A(t.treasury)],
          ["Tax wallet", A(t.taxWallet)],
          ["Buy tax", P(t.buyTaxBps)],
          ["Sell tax", P(t.sellTaxBps)],
          ["Socials", str(t.socials)],
          ["Balance of airdrop", W(values.airdrop.tokenBalance)],
          ["Balance of connected wallet", W(t.myBalance)],
        ]}
      />
      <div className="card inline-check row">
        <label className="field" style={{ flex: 1, minWidth: 260 }}>
          <span>Check tax-exempt / AMM pair status of an address</span>
          <input value={check} onChange={(e) => setCheck(e.target.value)} placeholder="0x…" />
        </label>
        <button type="button" className="btn" onClick={lookup} style={{ alignSelf: "flex-end" }}>
          Check
        </button>
        {checked && <span className="small">{checked}</span>}
      </div>
      <div className="actions">
        <Action
          title="Set buy tax"
          contract="token"
          method="setBuyTax"
          fields={[{ name: "p", label: "Buy tax %", initial: bpsToPercent(t.buyTaxBps) }]}
          build={(v) => [percentToBps(v.p, "Buy tax")]}
          hint="Applied on buys from AMM pairs. No cap other than 100%."
        />
        <Action
          title="Set sell tax"
          contract="token"
          method="setSellTax"
          fields={[{ name: "p", label: "Sell tax %", initial: bpsToPercent(t.sellTaxBps) }]}
          build={(v) => [percentToBps(v.p, "Sell tax")]}
          hint="Applied on sells to AMM pairs. No cap other than 100%."
        />
        <Action
          title="Set tax wallet"
          contract="token"
          method="setTaxWallet"
          fields={[{ name: "a", label: "Tax wallet", initial: str(t.taxWallet) }]}
          build={(v) => [address(v.a, "Tax wallet")]}
        />
        <Action
          title="Set socials"
          contract="token"
          method="setSocials"
          fields={[{ name: "s", label: "Socials text", initial: str(t.socials) }]}
          build={(v) => [v.s]}
        />
        <Action
          title="Tax exempt"
          contract="token"
          method="setTaxExempt"
          fields={[
            { name: "a", label: "Address", placeholder: "0x…" },
            { name: "b", label: "Action", type: "bool" },
          ]}
          build={(v) => [address(v.a, "Address"), v.b === "true"]}
        />
        <Action
          title="AMM pair"
          contract="token"
          method="setAmmPair"
          fields={[
            { name: "a", label: "Pair address", placeholder: "0x…" },
            { name: "b", label: "Action", type: "bool" },
          ]}
          build={(v) => [address(v.a, "Pair"), v.b === "true"]}
          hint="Register the PancakeSwap pair so buy/sell tax applies."
        />
        <Action
          title="Fund airdrop"
          contract="token"
          method="transfer"
          who="any"
          blocked={!addresses.airdrop && "Airdrop address is not set in Settings."}
          fields={[{ name: "n", label: "Tokens", placeholder: "1000000" }]}
          build={(v) => [addresses.airdrop as Address, amount(v.n, "Tokens")]}
          hint="Token transfer from the connected wallet to the airdrop contract."
        />
        <Ownership contract="token" />
      </div>
    </>
  );
}

function AirdropSection({ airdrops, initialRoot }: { airdrops: Airdrop[]; initialRoot: string }) {
  const { values, addresses } = useCtx();
  const a = values.airdrop;
  const root = str(a.merkleRoot);
  const current = airdrops.find((d) => same(d.merkle_root, root));
  const deadline = num(a.deadline);
  const canRecover = deadline !== 0 && values.now > deadline;

  return (
    <>
      <KV
        rows={[
          ["Address", A(addresses.airdrop)],
          ["Owner", A(a.owner)],
          ["Pending owner", A(a.pendingOwner)],
          ["Token", A(a.token)],
          [
            "Merkle root",
            root && root !== ZERO32 ? (
              <span key="r" className="row">
                <Addr value={root} full />
                {current && <span className="badge green">airdrop #{current.id}</span>}
              </span>
            ) : (
              <span className="muted">not set</span>
            ),
          ],
          ["Claim deadline", showTime(a.deadline)],
          ["Token balance", W(a.tokenBalance)],
          ["Needed for current root", current ? formatWei(current.total_amount_wei) : undefined],
        ]}
      />
      <div className="actions">
        <Action
          title="Set root"
          contract="airdrop"
          method="setRoot"
          fields={[{ name: "r", label: "Merkle root", initial: initialRoot, placeholder: "0x…" }]}
          build={(v) => {
            if (!/^0x[0-9a-fA-F]{64}$/.test(v.r.trim())) throw new Error("Merkle root: enter a 0x + 64 hex value.");
            return [v.r.trim() as Hex];
          }}
          confirm="Set this Merkle root? Users will claim against it."
          hint="Pick a built airdrop or paste a root. Then fund the airdrop with enough tokens (Token tab)."
          helpers={(set) => (
            <label className="field">
              <span>Built airdrop</span>
              <select defaultValue="" onChange={(e) => set("r", e.target.value)}>
                <option value="">choose…</option>
                {airdrops.map((d) => (
                  <option key={d.id} value={d.merkle_root}>
                    #{d.id} · {formatWei(d.total_amount_wei)} tokens · {d.recipients} recipients
                    {d.active ? " · active" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        />
        <Action
          title="Set deadline"
          contract="airdrop"
          method="setDeadline"
          fields={[{ name: "d", label: "Deadline (your local time)", type: "datetime-local", initial: toLocalInput(a.deadline) }]}
          build={(v) => [datetime(v.d, "Deadline")]}
          hint="After the deadline claims stop and the owner can recover the rest."
        />
        <Action
          title="Recover"
          contract="airdrop"
          method="recover"
          blocked={!canRecover && "Available only after the claim deadline has passed."}
          fields={[{ name: "to", label: "To address", placeholder: "0x…" }]}
          build={(v) => [address(v.to, "To")]}
          confirm="Send the whole remaining token balance of the airdrop contract?"
          danger
        />
        <Ownership contract="airdrop" />
      </div>
    </>
  );
}

// ---------- page body ----------

const ClientCtx = createContext<PublicClient | null>(null);
const useClient = () => useContext(ClientCtx)!;

export default function ContractsAdmin({
  settings,
  airdrops,
  canEdit,
}: {
  settings: Settings;
  airdrops: Airdrop[];
  canEdit: boolean;
}) {
  const chainId = Number(settings.chain_id) || 0;
  const rpc = settings.rpc_url ?? "";
  const chain = useMemo(() => chainFor(chainId, rpc), [chainId, rpc]);
  const client = useMemo(() => makePublicClient(chain), [chain]);
  const addresses: Record<Key, string | null> = useMemo(
    () => ({
      token: settings.token_address || null,
      airdrop: settings.airdrop_address || null,
    }),
    [settings],
  );
  const [initialRoot] = useState(() => new URLSearchParams(window.location.search).get("root") ?? "");
  const [tab, setTab] = useState<Key>(initialRoot ? "airdrop" : "token");
  const [account, setAccount] = useState<Address | undefined>();
  const [values, setValues] = useState<Values | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [kit] = useState(() => (canEdit ? initWallet(chain) : null));

  useEffect(() => {
    if (!kit) return;
    return kit.subscribeAccount((s) => setAccount(s.isConnected && s.address ? (s.address as Address) : undefined));
  }, [kit]);

  const refresh = useCallback(() => {
    readAll(client, settings, account).then(
      (v) => {
        setValues(v);
        setReadError(null);
      },
      (e) => setReadError(`Could not read the chain: ${plainError(e)}`),
    );
  }, [client, settings, account]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = useCallback<Ctx["run"]>(
    async (key, method, args, setTx) => {
      const address = addresses[key];
      if (!account || !address) return;
      setTx({ phase: "wallet" });
      let hash: Hex | undefined;
      try {
        hash = await sendTx(client, account, address as Address, ABIS[key], method, args);
        setTx({ phase: "pending", hash });
        const r = await client.waitForTransactionReceipt({ hash });
        if (r.status !== "success") {
          setTx({ phase: "failed", hash, reason: "The transaction reverted on chain." });
          return;
        }
      } catch (e) {
        setTx({ phase: "failed", hash, reason: plainError(e) });
        return;
      }
      let logError: string | undefined;
      try {
        await api("/contracts/log", { method: "POST", body: { contract: key, method, args: jsonArgs(args), tx_hash: hash } });
      } catch (e) {
        logError = (e as Error).message;
      }
      setTx({ phase: "confirmed", hash, logError });
      refresh();
    },
    [account, addresses, client, refresh],
  );

  if (!chainId || !rpc) return <div className="notice">Set the chain id and RPC URL on the Settings page first.</div>;

  const ownerOf = (k: Key) => str(values?.[k].owner);

  return (
    <ClientCtx.Provider value={client}>
      {canEdit && (
        <div className="card row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          {kit ? (
            <>
              <div className="stack" style={{ gap: 4 }}>
                <div>
                  Wallet: {account ? <Addr value={account} full /> : <span className="muted">not connected</span>}
                </div>
                {account && (
                  <div className="row small">
                    {(["token", "airdrop"] as Key[]).map((k) => (
                      <span key={k} className={`badge ${same(account, ownerOf(k)) ? "green" : "red"}`}>
                        {k}: {same(account, ownerOf(k)) ? "owner" : "not owner"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => kit.open()}>
                  {account ? "Wallet" : "Connect wallet"}
                </button>
                {account && (
                  <button type="button" className="btn ghost" onClick={() => kit.disconnect()}>
                    Disconnect
                  </button>
                )}
              </div>
            </>
          ) : (
            <span className="muted">
              {projectId ? "Wallet unavailable." : "Wallet connect is not configured (NEXT_PUBLIC_REOWN_PROJECT_ID)."}
            </span>
          )}
        </div>
      )}
      <div className="row muted small" style={{ marginBottom: 10 }}>
        Chain {chainId} · {rpc}
        <button type="button" className="btn small" onClick={refresh}>
          Refresh
        </button>
      </div>
      <ErrorBox error={readError} />
      <div className="tabs">
        {(["token", "airdrop"] as Key[]).map((k) => (
          <button key={k} type="button" className={`tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      {!addresses[tab] ? (
        <div className="notice">The {tab} address is not set. Add it on the Settings page.</div>
      ) : !values ? (
        <p className="muted">Reading chain…</p>
      ) : (
        <CtxObj.Provider value={{ settings, values, account, canEdit, addresses, run }}>
          <div className="stack">
            {tab === "token" && <TokenSection />}
            {tab === "airdrop" && <AirdropSection airdrops={airdrops} initialRoot={initialRoot} />}
          </div>
        </CtxObj.Provider>
      )}
    </ClientCtx.Provider>
  );
}
