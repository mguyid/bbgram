this is the admin of the dashboard

# software stack
python fastapi, postgress, reactjs or nextjs

# deploy
use docker compose to deploy on coolify.

# run

Next.js (App Router) admin dashboard for the `/admin-api` endpoints in `docs/interfaces.md` §2 and §2a.

Env (build time):
- `NEXT_PUBLIC_API_URL` — API base URL, e.g. `http://localhost:8000`.
- `NEXT_PUBLIC_REOWN_PROJECT_ID` — Reown (WalletConnect) project id for the owner wallet on the Contracts and Presale pages.

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
- **Settings** — one tab each for Telegram, X, Chain, Presale (presale wallet, USDT address, start block) and Contracts
  (token, airdrop, multisend); each tab saves only its own
  values (`/admin-api/settings`). Saving the bot token connects the bot: webhook to the API and the menu button to the
  mini app. The Telegram tab shows live status from Telegram (`/admin-api/settings/telegram`) and has Reconnect. The
  worker re-checks the bot every 10 minutes and after each deploy. Owner edits; others read.
- **Presale** — there is no presale contract: buyers send USDT straight to the presale wallet and the worker indexes the
  transfers. The page shows status and totals, a terms form (price, hard cap, min/max, start/end, pause; the `presale_*`
  config keys), the allocation preview and the contributions. **Close presale (take snapshot)** freezes the allocations;
  the owner can reopen until someone is credited. Once closed, **Credit buyers** sends allocations from the connected
  treasury wallet through the multisend contract: approve once, then send batches of 150 wallets.
- **Contracts** — current on-chain values of Token and Airdrop, and a form for every owner setter, signed with the
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
