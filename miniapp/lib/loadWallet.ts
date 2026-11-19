// Lazily loads the wallet stack so AppKit/wagmi/viem stay out of the initial bundle.
export type WalletModule = typeof import("./wallet");

export async function loadWallet(chainId: number): Promise<WalletModule> {
  const w = await import("./wallet");
  w.init(chainId);
  return w;
}

/** Plain-language message for any error thrown in a wallet flow. */
export async function walletErrorMessage(e: unknown): Promise<string> {
  try {
    const w = await import("./wallet");
    return w.friendlyError(e);
  } catch {
    return "Could not load the wallet. Check your connection and try again.";
  }
}

export function explorerTx(chainId: number, hash: string) {
  return `${chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com"}/tx/${hash}`;
}
