# Baby Grand contracts

Foundry project: `BabyGrandToken` (`src/Token.sol`), `BabyGrandPresale` (`src/Presale.sol`),
`BabyGrandAirdrop` (`src/AirdropClaim.sol`), `MockUSDT` (`src/MockUSDT.sol`, testnet/local only).
Interfaces are pinned in `../docs/interfaces.md` §4.

Dependencies are vendored in `lib/` (OpenZeppelin Contracts v5.1.0, forge-std v1.9.4, no git submodules).

## Build and test

```sh
forge build
forge test          # also rewrites test/vectors.json (Merkle + EIP-712 cross-language vectors for the API)
forge fmt --check
```

## Deploy

Every script needs `DEPLOYER_PRIVATE_KEY`. `OWNER_ADDRESS` and `TREASURY_ADDRESS` default to the deployer.
Scripts print the addresses as `NAME=0x...` lines to paste into the admin Settings page.

| script | env | prints |
|---|---|---|
| `DeployToken.s.sol` | `TOKEN_SYMBOL` (required), `TOKEN_NAME` (default `Baby Grand`), `TREASURY_ADDRESS`, `OWNER_ADDRESS` | `TOKEN_ADDRESS` |
| `DeployPresale.s.sol` | `OWNER_ADDRESS`. USDT is BSC mainnet USDT `0x55d398326f99059fF775485246999027B3197955` on chain 56, otherwise a new `MockUSDT` is deployed | `USDT_ADDRESS`, `PRESALE_ADDRESS`, `PRESALE_START_BLOCK` |
| `DeployAirdrop.s.sol` | `TOKEN_ADDRESS` (required), `OWNER_ADDRESS` | `AIRDROP_ADDRESS` |
| `DeployTestnet.s.sol` | none | all of the above |

Contracts are deployed unconfigured. **Price, hard cap, limits, times, signer, unlock, token (presale), Merkle root
and deadline (airdrop), taxes and AMM pairs (token) are all set from the admin Contracts page after deploy**,
signed with the owner wallet. Funding the presale and the airdrop with tokens is a token `transfer` from the treasury.

### Testnet / local (one shot)

MockUSDT + Token + Presale + Airdrop, all owned by the deployer (also the token treasury). `MockUSDT.mint` is public.

```sh
forge script script/DeployTestnet.s.sol --rpc-url $BSC_RPC_URL --broadcast
```

### Mainnet order: Token → Presale → Airdrop

```sh
forge script script/DeployToken.s.sol   --rpc-url $BSC_RPC_URL --broadcast   # prints TOKEN_ADDRESS
forge script script/DeployPresale.s.sol --rpc-url $BSC_RPC_URL --broadcast   # then setToken from the Contracts page
TOKEN_ADDRESS=0x... forge script script/DeployAirdrop.s.sol --rpc-url $BSC_RPC_URL --broadcast
```

If `OWNER_ADDRESS` is not set, the deployer owns the contracts; ownership can be moved later with the two-step
transfer on the Contracts page (`transferOwnership`, then `acceptOwnership` from the new owner).
Add `--verify` (with `ETHERSCAN_API_KEY`) to verify on BscScan.
