// Wallet stack (Reown AppKit + wagmi + viem). Only ever loaded via dynamic import from wallet/presale flows.

import { createAppKit, type AppKit } from "@reown/appkit";
import { bsc, bscTestnet } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import {
  getConnection,
  readContract,
  signMessage as wagmiSignMessage,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from "@wagmi/core";
import type { Address, Hex } from "viem";

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const presaleAbi = [
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "maxAllocation", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

const airdropAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
] as const;

// WalletConnect explorer ids, in the order from telegram.md §4.6.
const FEATURED_WALLETS = [
  "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
  "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
  "8a0ee50d1f22f6651afcae7eb4253e52a3310b90af5daef78a8c4929a9bb99d4", // Binance Web3 Wallet
  "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709", // OKX Wallet
  "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa", // Coinbase Wallet
];

let kit: AppKit | null = null;
let adapter: WagmiAdapter | null = null;

export class WalletError extends Error {}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function init(chainId: number) {
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  if (kit) {
    kit.setThemeMode(theme);
    return;
  }
  const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "";
  if (!projectId) throw new WalletError("Wallet connection is not configured yet.");
  const main = chainId === 97 ? bscTestnet : bsc;
  const other = chainId === 97 ? bsc : bscTestnet;
  adapter = new WagmiAdapter({ projectId, networks: [main, other] });
  kit = createAppKit({
    adapters: [adapter],
    networks: [main, other],
    defaultNetwork: main,
    projectId,
    metadata: {
      name: "Baby Grand",
      description: "Baby Grand mini app",
      url: window.location.origin,
      icons: [],
    },
    featuredWalletIds: FEATURED_WALLETS,
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false },
    themeMode: theme,
    themeVariables: { "--w3m-accent": cssVar("--accent"), "--w3m-font-family": "Inter, -apple-system, system-ui, sans-serif" },
  });
}

function config() {
  if (!adapter) throw new WalletError("Wallet is not ready. Try again.");
  return adapter.wagmiConfig;
}

export function address(): string | undefined {
  if (!adapter) return undefined;
  return getConnection(config()).address;
}

/** Opens the wallet modal and resolves with the connected address. */
export function connect(): Promise<string> {
  const current = address();
  if (current) return Promise.resolve(current);
  const k = kit;
  if (!k) return Promise.reject(new WalletError("Wallet is not ready. Try again."));
  return new Promise((resolve, reject) => {
    let seenOpen = false;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      unsubAccount();
      unsubState();
      fn();
    };
    const unsubAccount = k.subscribeAccount((s) => {
      const a = address() || (s.isConnected ? s.address : undefined);
      if (a) {
        finish(() => {
          k.close();
          resolve(a);
        });
      }
    });
    const unsubState = k.subscribeState((s) => {
      if (s.open) seenOpen = true;
      else if (seenOpen && !address()) {
        finish(() => reject(new WalletError("Wallet connection was cancelled. Try again.")));
      }
    });
    k.open({ view: "Connect" }).catch(() =>
      finish(() => reject(new WalletError("Could not open the wallet list. Try again."))),
    );
  });
}

export async function disconnect() {
  if (kit) await kit.disconnect();
}

export async function signMessage(message: string): Promise<string> {
  return wagmiSignMessage(config(), { message });
}

async function ensureChain(chainId: number) {
  const c = getConnection(config());
  if (c.chainId !== chainId) await switchChain(config(), { chainId });
}

export async function usdtBalance(usdt: string, owner: string, chainId: number): Promise<bigint> {
  return readContract(config(), {
    address: usdt as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner as Address],
    chainId,
  });
}

export async function allowance(usdt: string, owner: string, spender: string, chainId: number) {
  return readContract(config(), {
    address: usdt as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner as Address, spender as Address],
    chainId,
  });
}

export async function approve(usdt: string, spender: string, amount: bigint, chainId: number): Promise<Hex> {
  await ensureChain(chainId);
  return writeContract(config(), {
    address: usdt as Address,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender as Address, amount],
    chainId,
  });
}

export async function buy(
  presale: string,
  amount: bigint,
  maxAllocation: bigint,
  signature: string,
  chainId: number,
): Promise<Hex> {
  await ensureChain(chainId);
  return writeContract(config(), {
    address: presale as Address,
    abi: presaleAbi,
    functionName: "buy",
    args: [amount, maxAllocation, signature as Hex],
    chainId,
  });
}

export async function claimPresale(presale: string, chainId: number): Promise<Hex> {
  await ensureChain(chainId);
  return writeContract(config(), { address: presale as Address, abi: presaleAbi, functionName: "claim", chainId });
}

export async function claimAirdrop(
  airdrop: string,
  amount: bigint,
  proof: string[],
  chainId: number,
): Promise<Hex> {
  await ensureChain(chainId);
  return writeContract(config(), {
    address: airdrop as Address,
    abi: airdropAbi,
    functionName: "claim",
    args: [amount, proof as Hex[]],
    chainId,
  });
}

export async function waitFor(hash: Hex, chainId: number) {
  const r = await waitForTransactionReceipt(config(), { hash, chainId });
  if (r.status !== "success") throw new WalletError("The transaction failed on chain. Try again.");
}

/** Maps wallet/RPC errors to plain language. Never shows raw RPC text. */
export function friendlyError(e: unknown): string {
  if (e instanceof WalletError) return e.message;
  const err = e as { name?: string; shortMessage?: string; message?: string; code?: number; details?: string };
  const text = `${err?.name || ""} ${err?.shortMessage || ""} ${err?.details || ""} ${err?.message || ""}`.toLowerCase();
  if (err?.code === 4001 || /user ?rejected|user denied|rejected the request|request rejected|cancel/.test(text))
    return "Request rejected in wallet. Try again.";
  if (/insufficient funds|exceeds balance.*gas|gas required exceeds/.test(text))
    return "Not enough BNB to pay the network fee. Add BNB and try again.";
  if (/transfer amount exceeds balance|insufficient balance/.test(text))
    return "Not enough USDT in this wallet.";
  if (/chain|network/.test(text) && /switch|mismatch|unsupported|does not match/.test(text))
    return "Switch your wallet to BNB Smart Chain and try again.";
  if (/revert|execution reverted/.test(text))
    return "The contract rejected this transaction. Check the limits and try again.";
  if (/timeout|timed out/.test(text)) return "The wallet did not respond in time. Try again.";
  return "Something went wrong with the wallet. Try again.";
}
