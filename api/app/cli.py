"""Usage: python -m app.cli create-admin <email> <password> <owner|admin|viewer>"""

import asyncio
import sys

from fastapi import HTTPException

from app.db import SessionLocal
from app.routes.admin import create_admin


async def _create_admin(email: str, password: str, role: str) -> int:
    if role not in ("owner", "admin", "viewer"):
        print("role must be owner, admin or viewer", file=sys.stderr)
        return 2
    async with SessionLocal() as session:
        try:
            admin, uri = await create_admin(session, email, password, role)
        except HTTPException as e:
            print(e.detail, file=sys.stderr)
            return 1
        await session.commit()
    print(f"Created {role} {admin.email} (id {admin.id})")
    print(f"TOTP URI (add to your authenticator app): {uri}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 4 and argv[0] == "create-admin":
        return asyncio.run(_create_admin(argv[1], argv[2], argv[3]))
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
