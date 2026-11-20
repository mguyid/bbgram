export type UserRow = {
  id: number;
  telegram_id: number;
  username: string | null;
  balance: number;
  risk_score: number | null;
  wallet_address: string | null;
  x_username: string | null;
  banned: boolean;
  created_at: string;
};

export type Airdrop = {
  id: number;
  snapshot_id?: number;
  merkle_root: string;
  total_amount_wei: string;
  recipients: number;
  created_at?: string;
  /** Root equals the on-chain `merkleRoot()`. */
  active?: boolean;
};

export type Settings = {
  telegram_bot_token_set: boolean;
  telegram_bot_username: string | null;
  telegram_webhook_ok: boolean;
  x_client_id: string | null;
  x_client_secret_set: boolean;
  x_redirect_uri: string | null;
  chain_id: number | null;
  rpc_url: string | null;
  usdt_address: string | null;
  token_address: string | null;
  /** The address that receives presale USDT (there is no presale contract). */
  presale_wallet: string | null;
  presale_start_block: number | null;
  airdrop_address: string | null;
  multisend_address: string | null;
};

export type TelegramStatus = {
  token_set: boolean;
  username: string;
  reachable: boolean;
  webhook_url: string;
  expected_webhook_url: string;
  webhook_ok: boolean;
  pending_updates: number;
  last_error: string;
  menu_url: string;
  expected_menu_url: string;
  menu_ok: boolean;
};
