// Wallet stack (Reown AppKit + wagmi adapter + viem). Imported only by the Contracts page and the Presale credit panel (dynamic imports).
import { createAppKit, type AppKit } from "@reown/appkit";
import { bsc, bscTestnet } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { switchChain, getConnection, writeContract } from "@wagmi/core";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { ERROR_TEXT } from "./abi";

export function chainFor(chainId: number, rpcUrl: string): Chain {
  const rpc = { default: { http: [rpcUrl] } };
  if (chainId === 56) return { ...bsc, rpcUrls: rpc } as Chain;
  if (chainId === 97) return { ...bscTestnet, rpcUrls: rpc } as Chain;
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: rpc,
  });
}

export function explorerTx(chainId: number, hash: string): string | null {
  if (chainId === 56) return `https://bscscan.com/tx/${hash}`;
  if (chainId === 97) return `https://testnet.bscscan.com/tx/${hash}`;
  return null;
}

export function makePublicClient(chain: Chain): PublicClient {
  return createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
}

let kit: AppKit | null = null;
let adapter: WagmiAdapter | null = null;

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "";

/*
 * Returning from a wallet app (phone browser + WalletConnect). While the browser is in the background the OS
 * can silently kill WalletConnect's relay socket, and WalletConnect only detects that in Node. The wallet's
 * answer (approval, tx hash) then waits at the relay and the page hangs on "waiting for wallet confirmation".
 * Restart the relay connection when the page comes back after a real absence so the answer is delivered.
 * Same fix as the mini app's lib/wallet.ts.
 */
const MIN_AWAY_MS = 2000;
let hiddenAt = 0;

function watchResume() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    if (!hiddenAt || Date.now() - hiddenAt < MIN_AWAY_MS) return;
    hiddenAt = 0;
    void kit
      ?.getUniversalProvider()
      .then((p) => p?.client?.core?.relayer?.restartTransport())
      .catch(() => {
        // Offline or no session yet: nothing to revive. A later return tries again.
      });
  });
}

/** Creates the AppKit modal once. Returns null when no Reown project id is configured. */
export function initWallet(chain: Chain): AppKit | null {
  if (kit) return kit;
  if (!projectId) return null;
  adapter = new WagmiAdapter({ projectId, networks: [chain] });
  kit = createAppKit({
    adapters: [adapter],
    networks: [chain],
    defaultNetwork: chain,
    projectId,
    metadata: { name: "Baby Grand Admin", description: "Baby Grand admin", url: window.location.origin, icons: [] },
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false },
    themeMode: "light",
  });
  watchResume();
  return kit;
}

/** Simulates the call (to get a readable revert reason), then asks the wallet to sign and send it. */
export async function sendTx(
  client: PublicClient,
  account: Address,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
): Promise<Hex> {
  if (!adapter) throw new Error("Wallet is not ready.");
  const config = adapter.wagmiConfig;
  const chainId = client.chain!.id;
  await client.simulateContract({ account, address, abi, functionName, args });
  if (getConnection(config).chainId !== chainId) await switchChain(config, { chainId });
  return writeContract(config, { address, abi, functionName, args, chainId } as Parameters<typeof writeContract>[1]);
}

/** Maps wallet/RPC/revert errors to a short plain reason. */
export function plainError(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && ERROR_TEXT[name]) return ERROR_TEXT[name];
      if (name) return `Contract reverted: ${name}`;
      if (revert.reason) return `Contract reverted: ${revert.reason}`;
      return "The contract rejected this transaction.";
    }
  }
  const err = e as { shortMessage?: string; message?: string; code?: number };
  const text = `${err?.shortMessage || ""} ${err?.message || ""}`;
  if (err?.code === 4001 || /user ?rejected|user denied|rejected the request/i.test(text))
    return "Rejected in the wallet.";
  if (/insufficient funds/i.test(text)) return "Not enough BNB in the connected wallet to pay gas.";
  return err?.shortMessage || err?.message || "Unknown error.";
}
