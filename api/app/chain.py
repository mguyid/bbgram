"""On-chain helpers: wallet message signatures, airdrop reads, presale USDT transfer indexing."""

import logging
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak, to_checksum_address
from web3 import AsyncWeb3

from app.runtime import Runtime

log = logging.getLogger(__name__)

TRANSFER_TOPIC = "0x" + keccak(text="Transfer(address,address,uint256)").hex()



def _views(names: list[tuple[str, str]], with_address: bool = False) -> list[dict[str, Any]]:
    inputs = [{"name": "a", "type": "address"}] if with_address else []
    return [{"type": "function", "name": n, "stateMutability": "view", "inputs": inputs,
             "outputs": [{"name": "", "type": t}]} for n, t in names]


AIRDROP_ABI = _views([("merkleRoot", "bytes32"), ("deadline", "uint64")]) + _views([("claimed", "bool")], True)


def wallet_message(telegram_id: int, nonce: str) -> str:
    return f"Link this wallet to Baby Grand: {telegram_id} {nonce}"


def recover_personal_sign(message: str, signature: str) -> str:
    return Account.recover_message(encode_defunct(text=message), signature=signature)


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


async def current_block(rpc_url: str) -> int:
    """Latest block number. Raises on RPC failure."""
    return int(await (await w3(rpc_url)).eth.block_number)


def _topic_address(address: str) -> str:
    return "0x" + "00" * 12 + address.lower()[2:]


async def fetch_presale_transfers(rt: Runtime, from_block: int,
                                  max_range: int = 4999) -> tuple[list[dict[str, Any]], int]:
    """USDT Transfer logs into the presale wallet from from_block: (decoded logs, last block scanned)."""
    web3 = await w3(rt.rpc_url)
    latest = await web3.eth.block_number
    if from_block > latest:
        return [], from_block - 1
    to_block = min(latest, from_block + max_range)
    logs = await web3.eth.get_logs({
        "address": to_checksum_address(rt.usdt),
        "topics": [TRANSFER_TOPIC, None, _topic_address(rt.presale_wallet)],
        "fromBlock": from_block,
        "toBlock": to_block,
    })
    out = []
    for lg in logs:
        out.append({
            "buyer": to_checksum_address(bytes(lg["topics"][1])[-20:]),
            "amount": int.from_bytes(bytes(lg["data"])[0:32], "big"),
            "tx_hash": "0x" + bytes(lg["transactionHash"]).hex(),
            "log_index": int(lg["logIndex"]),
            "block_number": int(lg["blockNumber"]),
        })
    return out, to_block
