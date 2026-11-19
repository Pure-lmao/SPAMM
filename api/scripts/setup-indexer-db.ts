/**
 * Create the indexer tables from scratch.
 *
 * Drops bet, cashout, escrow, watermark, and applied-instruction tables, then
 * recreates them. Sports, markets, and other API tables are left in place.
 * Run this before the indexer or bet-history reads. Those paths do not create
 * or migrate tables.
 *
 *   bun run setup-indexer-db
 */
import { getDb } from "../localDb";

const database = getDb();

database.run(`DROP TABLE IF EXISTS bet_accounts`);
database.run(`DROP TABLE IF EXISTS cashout_accounts`);
database.run(`DROP TABLE IF EXISTS cashout_escrow_accounts`);
database.run(`DROP TABLE IF EXISTS indexer_state`);
database.run(`DROP TABLE IF EXISTS applied_instructions`);

database.run(`CREATE TABLE bet_accounts (
   id TEXT PRIMARY KEY,
   bet_id TEXT NOT NULL,
   type TEXT NOT NULL,
   user_address TEXT NOT NULL,
   operator TEXT NOT NULL,
   mint TEXT NOT NULL,
   selections TEXT NOT NULL,
   amount_requested INTEGER NOT NULL,
   amount_filled INTEGER NOT NULL,
   min_odds_requested INTEGER NOT NULL,
   payout INTEGER NOT NULL,
   timestamp INTEGER NOT NULL,
   result INTEGER NOT NULL,
   created_at INTEGER NOT NULL,
   created_sig TEXT NOT NULL,
   graded_at INTEGER,
   graded_sig TEXT,
   final_payout INTEGER,
   claimed_at INTEGER,
   claimed_sig TEXT,
   last_update_slot INTEGER NOT NULL,
   status TEXT NOT NULL,
   freebet_id INTEGER NOT NULL,
   promo_type INTEGER NOT NULL,
   fillers TEXT NOT NULL,
   unresolved INTEGER NOT NULL,
   resolve_attempts INTEGER NOT NULL
)`);

database.run(`CREATE TABLE cashout_accounts (
   id TEXT PRIMARY KEY,
   orig_bet_id TEXT NOT NULL,
   cashout_id TEXT NOT NULL,
   type TEXT NOT NULL,
   operator TEXT NOT NULL,
   mint TEXT NOT NULL,
   amount INTEGER NOT NULL,
   payout INTEGER NOT NULL,
   selections TEXT NOT NULL,
   event_states TEXT NOT NULL,
   fillingMm TEXT NOT NULL,
   timestamp INTEGER NOT NULL,
   result INTEGER NOT NULL,
   created_at INTEGER NOT NULL,
   created_sig TEXT NOT NULL,
   graded_at INTEGER,
   graded_sig TEXT,
   final_payout INTEGER,
   claimed_at INTEGER,
   claimed_sig TEXT,
   last_update_slot INTEGER NOT NULL,
   status TEXT NOT NULL,
   unresolved INTEGER NOT NULL,
   resolve_attempts INTEGER NOT NULL
)`);
database.run(`CREATE INDEX idx_cashout_accounts_orig_bet_id ON cashout_accounts (orig_bet_id)`);
database.run(`CREATE INDEX idx_cashout_accounts_cashout_id ON cashout_accounts (cashout_id)`);

database.run(`CREATE TABLE cashout_escrow_accounts (
   id TEXT PRIMARY KEY,
   orig_bet_id TEXT NOT NULL,
   cashout_id TEXT NOT NULL,
   type TEXT NOT NULL,
   owner_address TEXT NOT NULL,
   operator TEXT NOT NULL,
   mint TEXT NOT NULL,
   amount INTEGER NOT NULL,
   payout_removed INTEGER NOT NULL,
   payment INTEGER NOT NULL,
   market_maker TEXT NOT NULL,
   timestamp INTEGER NOT NULL,
   created_at INTEGER NOT NULL,
   created_sig TEXT NOT NULL,
   claimed_at INTEGER,
   claimed_sig TEXT,
   last_update_slot INTEGER NOT NULL,
   status TEXT NOT NULL,
   unresolved INTEGER NOT NULL,
   resolve_attempts INTEGER NOT NULL
)`);
database.run(`CREATE INDEX idx_cashout_escrow_orig_bet_id ON cashout_escrow_accounts (orig_bet_id)`);
database.run(`CREATE INDEX idx_cashout_escrow_cashout_id ON cashout_escrow_accounts (cashout_id)`);

database.run(`CREATE TABLE indexer_state (
   id INTEGER PRIMARY KEY CHECK (id = 1),
   last_sig TEXT,
   last_slot INTEGER
)`);
database.run(`CREATE TABLE applied_instructions (
   signature TEXT NOT NULL,
   ix_index INTEGER NOT NULL,
   PRIMARY KEY (signature, ix_index)
)`);

console.log("indexer tables ready");
