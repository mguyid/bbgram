// ABI fragments for the admin Contracts and Presale pages (docs/interfaces.md §4). Human-readable form, parsed by viem.
import { parseAbi } from "viem";

const ownable = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnableInvalidOwner(address owner)",
] as const;

const erc20 = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
] as const;

export const erc20Abi = parseAbi(erc20);

export const tokenAbi = parseAbi([
  ...ownable,
  ...erc20,
  "function buyTaxBps() view returns (uint256)",
  "function sellTaxBps() view returns (uint256)",
  "function taxWallet() view returns (address)",
  "function socials() view returns (string)",
  "function treasury() view returns (address)",
  "function isTaxExempt(address account) view returns (bool)",
  "function isAmmPair(address pair) view returns (bool)",
  "function setBuyTax(uint256 bps)",
  "function setSellTax(uint256 bps)",
  "function setTaxWallet(address wallet)",
  "function setSocials(string value)",
  "function setTaxExempt(address account, bool exempt)",
  "function setAmmPair(address pair, bool isPair)",
  "error ZeroAddress()",
  "error TaxTooHigh()",
]);

/** Stateless batch sender used to credit presale buyers (docs/interfaces.md §4 Multisend). */
export const multisendAbi = parseAbi([
  "function send(address token, address[] recipients, uint256[] amounts)",
  "error LengthMismatch()",
  "error SafeERC20FailedOperation(address token)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

export const airdropAbi = parseAbi([
  ...ownable,
  "function token() view returns (address)",
  "function merkleRoot() view returns (bytes32)",
  "function deadline() view returns (uint64)",
  "function setRoot(bytes32 root)",
  "function setDeadline(uint64 deadline)",
  "function recover(address to)",
  "error ZeroAddress()",
  "error DeadlineNotReached()",
]);

/** Plain-language text for custom errors the contracts can revert with. */
export const ERROR_TEXT: Record<string, string> = {
  OwnableUnauthorizedAccount: "The connected wallet is not allowed to do this (not the owner / pending owner).",
  OwnableInvalidOwner: "Invalid new owner address.",
  ERC20InsufficientBalance: "Not enough tokens in the connected wallet.",
  ERC20InvalidReceiver: "Invalid receiver address.",
  ZeroAddress: "Address must not be zero.",
  TaxTooHigh: "Tax cannot exceed 100%.",
  ERC20InsufficientAllowance: "The multisend is not approved for enough tokens. Approve first.",
  SafeERC20FailedOperation: "A token transfer failed. Check the wallet's balance and approval.",
  LengthMismatch: "Recipients and amounts do not match.",
  DeadlineNotReached: "The claim deadline has not passed yet (or no deadline is set).",
};
