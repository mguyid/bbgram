this is the admin of the dashboard

# software stack
python fastapi, postgress, reactjs or nextjs

# deploy
use docker compose to deploy on coolify.

# run

Next.js (App Router) admin dashboard for the `/admin-api` endpoints in `docs/interfaces.md` §2 and §2a.

Env (build time):
- `NEXT_PUBLIC_API_URL` — API base URL, e.g. `http://localhost:8000`.
- `NEXT_PUBLIC_REOWN_PROJECT_ID` — Reown (WalletConnect) project id for the owner wallet on the Contracts page.

```sh
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 NEXT_PUBLIC_REOWN_PROJECT_ID=xxx npm run dev    # http://localhost:3001
npm run lint && npx tsc --noEmit
NEXT_PUBLIC_API_URL=https://api.example.com NEXT_PUBLIC_REOWN_PROJECT_ID=xxx npm run build && npm start   # port 3001
```

Docker (used by the root `docker-compose.yml`):

```sh
docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_REOWN_PROJECT_ID=xxx -t baby-grand-admin .
docker run -p 3001:3001 baby-grand-admin
```

Pages of note:
- **Settings** — Telegram bot, X app, chain id / RPC, contract addresses and the presale signer (`/admin-api/settings`). Owner edits; others read.
- **Contracts** — current on-chain values of Token, Presale and Airdrop, and a form for every owner setter, signed with the
  connected owner wallet (Reown AppKit). Chain and addresses come from Settings. Each confirmed tx is written to the audit log.
  `/contracts?root=0x…` preselects a Merkle root (linked from a built airdrop).
- **Backup** (owner only) — download the whole database as a `.jsonl.gz` file, or restore one (type `RESTORE` to
  confirm). A restore replaces all data, needs the same app version (migration) as the backup and signs you out.
  Encrypted settings only work with the same `JWT_SECRET`. Backup files hold password hashes, 2FA secrets and encrypted
  keys: store them somewhere safe.

Sign in with an admin created by `python -m app.cli create-admin <email> <password> owner` (run in the api container,
e.g. Coolify → api → Terminal), using just email and password. 2FA is optional: each admin turns it on under
**Account** (scan the QR code, confirm a code). Once on, sign-in also asks for the 6-digit code. The JWT is kept in
sessionStorage; any 401 sends you back to the login page. `viewer` admins see everything read-only.
