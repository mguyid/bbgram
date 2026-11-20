# Baby Grand contracts

Foundry project: `BabyGrandToken` (`src/Token.sol`), `BabyGrandAirdrop` (`src/AirdropClaim.sol`),
`BabyGrandMultisend` (`src/Multisend.sol`), `MockUSDT` (`src/MockUSDT.sol`, testnet/local only).

There is **no presale contract**. Buyers send USDT to the presale wallet set in admin Settings; the API indexes
those transfers. After launch the team credits each buyer from the treasury through `BabyGrandMultisend`, from the
admin Presale page.
Interfaces are pinned in `../docs/interfaces.md` §4.

Dependencies are vendored in `lib/` (OpenZeppelin Contracts v5.1.0, forge-std v1.9.4, no git submodules).

## Build and test

```sh
forge build
forge test          # also rewrites test/vectors.json (Merkle cross-language vectors for the API)
forge fmt --check
```

## Deploy

Every script needs `DEPLOYER_PRIVATE_KEY`. `OWNER_ADDRESS` and `TREASURY_ADDRESS` default to the deployer.
Scripts print the addresses as `NAME=0x...` lines to paste into the admin Settings page.

| script | env | prints |
|---|---|---|
| `DeployToken.s.sol` | `TOKEN_SYMBOL` (required), `TOKEN_NAME` (default `Baby Grand`), `TREASURY_ADDRESS`, `OWNER_ADDRESS` | `TOKEN_ADDRESS` |
| `DeployAirdrop.s.sol` | `TOKEN_ADDRESS` (required), `OWNER_ADDRESS` | `AIRDROP_ADDRESS` |
| `DeployMultisend.s.sol` | none (no owner) | `MULTISEND_ADDRESS` |
| `DeployTestnet.s.sol` | none | all of the above |

Contracts are deployed unconfigured. **Merkle root and deadline (airdrop), taxes and AMM pairs (token) are set from
the admin Contracts page after deploy**, signed with the owner wallet. Funding the airdrop is a token `transfer` from
the treasury. Presale crediting is an `approve` to the multisend plus batched `send` calls, from the admin Presale page.

### Testnet / local (one shot)

MockUSDT + Token + Airdrop + Multisend, owned by the deployer (also the token treasury). `MockUSDT.mint` is public.
Put the printed `USDT_ADDRESS` into admin Settings (on testnet the API needs it to index presale payments).

```sh
forge script script/DeployTestnet.s.sol --rpc-url $BSC_RPC_URL --broadcast
```

### Mainnet order: Token → Airdrop → Multisend

```sh
forge script script/DeployToken.s.sol   --rpc-url $BSC_RPC_URL --broadcast   # prints TOKEN_ADDRESS
TOKEN_ADDRESS=0x... forge script script/DeployAirdrop.s.sol --rpc-url $BSC_RPC_URL --broadcast
forge script script/DeployMultisend.s.sol --rpc-url $BSC_RPC_URL --broadcast
```

If `OWNER_ADDRESS` is not set, the deployer owns the contracts; ownership can be moved later with the two-step
transfer on the Contracts page (`transferOwnership`, then `acceptOwnership` from the new owner).
Add `--verify` (with `ETHERSCAN_API_KEY`) to verify on BscScan.
