// ABI fragments for the admin Contracts page (docs/interfaces.md §4). Human-readable form, parsed by viem.
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
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidReceiver(address receiver)",
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

export const presaleAbi = parseAbi([
  ...ownable,
  "function usdt() view returns (address)",
  "function token() view returns (address)",
  "function signer() view returns (address)",
  "function tokensPerUsdt() view returns (uint256)",
  "function hardCapWei() view returns (uint256)",
  "function minWei() view returns (uint256)",
  "function maxWei() view returns (uint256)",
  "function startTime() view returns (uint64)",
  "function endTime() view returns (uint64)",
  "function totalRaised() view returns (uint256)",
  "function totalTokensSold() view returns (uint256)",
  "function claimEnabled() view returns (bool)",
  "function claimStart() view returns (uint64)",
  "function unlockBps() view returns (uint256)",
  "function vestingDuration() view returns (uint64)",
  "function paused() view returns (bool)",
  "function setPrice(uint256 tokensPerUsdt)",
  "function setHardCap(uint256 hardCapWei)",
  "function setLimits(uint256 minWei, uint256 maxWei)",
  "function setTimes(uint64 start, uint64 end)",
  "function setSigner(address signer)",
  "function pause()",
  "function unpause()",
  "function setToken(address token)",
  "function setUnlock(uint256 unlockBps, uint64 vestingDuration)",
  "function enableClaim()",
  "function withdrawUsdt(address to)",
  "function withdrawTokens(address to, uint256 amount)",
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error InvalidTimes()",
  "error AlreadyStarted()",
  "error TokenAlreadySet()",
  "error TokenNotSet()",
  "error EnforcedPause()",
  "error ExpectedPause()",
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
  ZeroAmount: "Value must be greater than zero.",
  TaxTooHigh: "Tax cannot exceed 100%.",
  InvalidTimes: "Start must be before end.",
  AlreadyStarted: "Not editable: the presale has started and is not paused. Pause it first.",
  TokenAlreadySet: "Token address is already set (it can be set only once).",
  TokenNotSet: "Set the token address first.",
  EnforcedPause: "The presale is paused.",
  ExpectedPause: "The presale is not paused.",
  DeadlineNotReached: "The claim deadline has not passed yet (or no deadline is set).",
};
