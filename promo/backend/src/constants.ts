import { address, type Address } from '@solana/kit';

/** Promo MM program id — set after deploy (`solana program deploy promo/program/target/deploy/promo_market_maker.so`). */
export const PROMO_PROGRAM_ID: Address = address(
   'ProMo6Ka3N1JLCaZrNTwnANQsCCfyKAm6R5TXM14LVQ',
);

export const ODDS_SCALE = 10_000;

/** Same pubkey as `api/utils.ts` / UI `DEFAULT_MARKET_OPERATOR`. */
export const DEFAULT_MARKET_OPERATOR: Address = address(
   'BqQKZKbnYMpmQEtoCjvaDVTdhfpbaCQuBiSngNKu6YQW',
);

/** Devnet USDC. Promo CLI markets use this unless `--mint` is set. */
export const DEFAULT_PROMO_MINT: Address = address(
   'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
);

/** Initial event-state sequence for new promo markets (pre-game bootstrap). */
export const PROMO_BOOTSTRAP_EVENT_SEQUENCE = 1;
