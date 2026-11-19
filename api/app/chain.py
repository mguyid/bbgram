"""On-chain helpers: wallet message signatures, EIP-712 whitelist signing, presale reads, log indexing."""

import logging
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data
from eth_utils import keccak, to_checksum_address
from web3 import AsyncWeb3

from app.runtime import Runtime

log = logging.getLogger(__name__)

CONTRIBUTED_TOPIC = "0x" + keccak(text="Contributed(address,uint256,uint256)").hex()



def _views(names: list[tuple[str, str]], with_address: bool = False) -> list[dict[str, Any]]:
    inputs = [{"name": "a", "type": "address"}] if with_address else []
    return [{"type": "function", "name": n, "stateMutability": "view", "inputs": inputs,
             "outputs": [{"name": "", "type": t}]} for n, t in names]


PRESALE_GETTERS = [
    ("tokensPerUsdt", "uint256"), ("hardCapWei", "uint256"), ("minWei", "uint256"), ("maxWei", "uint256"),
    ("startTime", "uint64"), ("endTime", "uint64"), ("totalRaised", "uint256"), ("claimEnabled", "bool"),
    ("claimStart", "uint64"), ("unlockBps", "uint256"), ("vestingDuration", "uint64"), ("paused", "bool"),
]
PRESALE_WALLET_GETTERS = [
    ("contributed", "uint256"), ("purchased", "uint256"), ("claimed", "uint256"), ("vested", "uint256"),
    ("claimable", "uint256"),
]
PRESALE_ABI = _views(PRESALE_GETTERS + [("usdt", "address")]) + _views(PRESALE_WALLET_GETTERS, True)
AIRDROP_ABI = _views([("merkleRoot", "bytes32"), ("deadline", "uint64")]) + _views([("claimed", "bool")], True)


def wallet_message(telegram_id: int, nonce: str) -> str:
    return f"Link this wallet to Baby Grand: {telegram_id} {nonce}"


def recover_personal_sign(message: str, signature: str) -> str:
    return Account.recover_message(encode_defunct(text=message), signature=signature)


def whitelist_typed_data(chain_id: int, presale: str, wallet: str, max_allocation: int) -> dict[str, Any]:
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "Whitelist": [
                {"name": "wallet", "type": "address"},
                {"name": "maxAllocation", "type": "uint256"},
            ],
        },
        "primaryType": "Whitelist",
        "domain": {
            "name": "BabyGrandPresale",
            "version": "1",
            "chainId": chain_id,
            "verifyingContract": to_checksum_address(presale),
        },
        "message": {"wallet": to_checksum_address(wallet), "maxAllocation": int(max_allocation)},
    }


def sign_whitelist(chain_id: int, presale: str, private_key: str, wallet: str, max_allocation: int) -> str:
    signable = encode_typed_data(full_message=whitelist_typed_data(chain_id, presale, wallet, max_allocation))
    signed = Account.sign_message(signable, private_key=private_key)
    return "0x" + bytes(signed.signature).hex()


def recover_whitelist_signer(chain_id: int, presale: str, wallet: str, max_allocation: int, signature: str) -> str:
    signable = encode_typed_data(full_message=whitelist_typed_data(chain_id, presale, wallet, max_allocation))
    return Account.recover_message(signable, signature=signature)


_w3: tuple[str, AsyncWeb3] | None = None


async def w3(rpc_url: str) -> AsyncWeb3:
    """One shared client per rpc_url so the provider's HTTP session is reused, not leaked per call.
    Rebuilt (and the old session closed) when the RPC URL setting changes."""
    global _w3
    if _w3 is None or _w3[0] != rpc_url:
        old = _w3
        _w3 = (rpc_url, AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(rpc_url, request_kwargs={"timeout": 15})))
        if old is not None:
            try:
                await old[1].provider.disconnect()
            except Exception as e:  # noqa: BLE001 - closing the old session is best effort
                log.debug("Closing old web3 session failed: %s", e)
    return _w3[1]


def chain_configured(rt: Runtime, address: str) -> bool:
    return bool(address and rt.rpc_url)


async def _call_all(contract: Any, names: list[str], *args: Any) -> dict[str, Any]:
    return {n: await getattr(contract.functions, n)(*args).call() for n in names}


async def read_presale(rt: Runtime, wallet: str | None) -> dict[str, Any] | None:
    """Read presale state from chain. Returns None if not configured or the RPC fails."""
    if not chain_configured(rt, rt.presale_address):
        return None
    try:
        c = (await w3(rt.rpc_url)).eth.contract(address=to_checksum_address(rt.presale_address), abi=PRESALE_ABI)
        out = await _call_all(c, [n for n, _ in PRESALE_GETTERS])
        if wallet:
            out.update(await _call_all(c, [n for n, _ in PRESALE_WALLET_GETTERS], to_checksum_address(wallet)))
        return out
    except Exception as e:  # noqa: BLE001 - any RPC/ABI failure falls back to defaults
        log.warning("Presale read failed: %s", e)
        return None


async def read_presale_setup(rpc_url: str, presale: str) -> tuple[str, int]:
    """(usdt() of the presale contract, current block). Raises on RPC failure."""
    web3 = await w3(rpc_url)
    c = web3.eth.contract(address=to_checksum_address(presale), abi=_views([("usdt", "address")]))
    usdt = await c.functions.usdt().call()
    return to_checksum_address(usdt), int(await web3.eth.block_number)


async def read_airdrop(rt: Runtime, wallet: str | None = None) -> dict[str, Any] | None:
    """{merkle_root: "0x..", deadline: int, claimed: bool} or None if not configured / RPC fails."""
    if not chain_configured(rt, rt.airdrop_address):
        return None
    try:
        c = (await w3(rt.rpc_url)).eth.contract(address=to_checksum_address(rt.airdrop_address), abi=AIRDROP_ABI)
        out = {
            "merkle_root": "0x" + bytes(await c.functions.merkleRoot().call()).hex(),
            "deadline": int(await c.functions.deadline().call()),
            "claimed": False,
        }
        if wallet:
            out["claimed"] = bool(await c.functions.claimed(to_checksum_address(wallet)).call())
        return out
    except Exception as e:  # noqa: BLE001
        log.warning("Airdrop read failed: %s", e)
        return None


async def fetch_contributed_logs(rt: Runtime, from_block: int,
                                 max_range: int = 4999) -> tuple[list[dict[str, Any]], int]:
    """Return (decoded Contributed logs, last block scanned) starting at from_block."""
    web3 = await w3(rt.rpc_url)
    latest = await web3.eth.block_number
    if from_block > latest:
        return [], from_block - 1
    to_block = min(latest, from_block + max_range)
    logs = await web3.eth.get_logs({
        "address": to_checksum_address(rt.presale_address),
        "topics": [CONTRIBUTED_TOPIC],
        "fromBlock": from_block,
        "toBlock": to_block,
    })
    out = []
    for lg in logs:
        topic1 = bytes(lg["topics"][1])
        data = bytes(lg["data"])
        out.append({
            "buyer": to_checksum_address(topic1[-20:]),
            "amount": int.from_bytes(data[0:32], "big"),
            "total": int.from_bytes(data[32:64], "big"),
            "tx_hash": "0x" + bytes(lg["transactionHash"]).hex(),
            "log_index": int(lg["logIndex"]),
            "block_number": int(lg["blockNumber"]),
        })
    return out, to_block
