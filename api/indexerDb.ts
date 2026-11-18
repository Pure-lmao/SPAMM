import type { Database } from "bun:sqlite";
import type { Address } from "@solana/kit";
import {
   BetResult,
   type BetAccountData,
   type CashoutEscrowAccountData,
   type EventGameState,
   type MarketId,
   type ParlayLegWire,
} from "spamm-aggregator-sdk";
import { getDb } from "./localDb";
import { foldParlayResult, safeJSONStringify } from "./utils";

export const NOT_FOUND_ATTEMPTS = 5;

export enum BetRecordStatus {
   Pending = "pending",
   Graded = "graded",
   Claimed = "claimed",
   CashedOut = "cashed_out",
   Reverted = "reverted",
}

export type Selection = {
   sport_id: number;
   league_id: number;
   event_id: number;
   mkt_id: number;
   period_id: number;
   player_id: number;
   is_pregame: number;
   operator: string;
   mint: string;
   side: number;
   event_state_sequence: number;
   event_game_state: EventGameState;
   odds_scaled: bigint | null;
   result: BetResult | null;
};

export type Filler = {
   address: string;
   amount: number;
   odds_scaled: bigint;
};

export type EventState = {
   sequence: number;
   game_state: EventGameState;
};

export type BetRecordType = "single" | "parlay";

export type BetRecord = {
   id: string;
   bet_id: bigint;
   type: BetRecordType;
   user_address: string;
   selections: Selection[];
   amount_requested: number;
   amount_filled: number;
   min_odds_requested: number;
   payout: number;
   freebet_id: number;
   promo_type: number;
   timestamp: number;
   result: BetResult;
   fillers: Filler[];
   created_at: number;
   created_sig: string;
   graded_at: number | null;
   graded_sig: string | null;
   final_payout: number | null;
   claimed_at: number | null;
   claimed_sig: string | null;
   last_update_slot: number;
   status: BetRecordStatus;
};

export enum CashoutEscrowStatus {
   Open = "open",
   Claimed = "claimed",
   Reverted = "reverted",
}

export type CashoutEscrowRecord = {
   id: string;
   orig_bet_id: bigint;
   cashout_id: bigint;
   type: BetRecordType;
   owner_address: string;
   amount: number;
   payout_removed: number;
   payment: number;
   market_maker: string;
   timestamp: number;
   created_at: number;
   created_sig: string;
   claimed_at: number | null;
   claimed_sig: string | null;
   last_update_slot: number;
   status: CashoutEscrowStatus;
};

export type CashoutRecord = {
   id: string;
   orig_bet_id: bigint;
   cashout_id: bigint;
   type: BetRecordType;
   amount: number;
   payout: number;
   selections: Selection[];
   event_states: EventState[];
   fillingMm: string;
   timestamp: number;
   result: BetResult;
   created_at: number;
   created_sig: string;
   graded_at: number | null;
   graded_sig: string | null;
   final_payout: number | null;
   claimed_at: number | null;
   claimed_sig: string | null;
   last_update_slot: number;
   status: BetRecordStatus;
};

type DbBetRow = Omit<BetRecord, "selections" | "bet_id" | "fillers"> & {
   bet_id: string;
   selections: string;
   fillers: string;
   unresolved: number;
   resolve_attempts: number;
};

type DbCashoutEscrowRow = Omit<CashoutEscrowRecord, "orig_bet_id" | "cashout_id"> & {
   orig_bet_id: string;
   cashout_id: string;
   unresolved: number;
   resolve_attempts: number;
};

type DbCashoutRow = Omit<CashoutRecord, "selections" | "event_states" | "orig_bet_id" | "cashout_id"> & {
   orig_bet_id: string;
   cashout_id: string;
   selections: string;
   event_states: string;
   unresolved: number;
   resolve_attempts: number;
};

export type UpdateMeta = {
   createdAt: number;
   createdSig: string;
   lastUpdateSlot: number;
};

export type UnresolvedBetRow = {
   id: string;
   type: BetRecordType;
   status: BetRecordStatus;
   selections: string;
   resolve_attempts: number;
};

export type UnresolvedCashoutRow = {
   id: string;
   type: BetRecordType;
   status: BetRecordStatus;
   selections: string;
   resolve_attempts: number;
};

export type UnresolvedEscrowRow = {
   id: string;
   status: string;
   resolve_attempts: number;
};

export function selectionFromMarketId(
   marketId: MarketId,
   side: number,
   eventStateSequence: number,
   eventGameState: EventGameState,
   oddsScaled: bigint | null = null,
): Selection {
   return {
      sport_id: marketId.eventId.sport,
      league_id: marketId.eventId.league,
      event_id: Number(marketId.eventId.event),
      mkt_id: marketId.mkt,
      period_id: marketId.period,
      player_id: Number(marketId.player),
      is_pregame: marketId.isPregame ? 1 : 0,
      operator: marketId.operator,
      mint: marketId.mint,
      side,
      event_state_sequence: eventStateSequence,
      event_game_state: eventGameState,
      odds_scaled: oddsScaled,
      result: BetResult.Pending,
   };
}

export function selectionFromParlayLeg(leg: ParlayLegWire): Selection {
   return selectionFromMarketId(leg.marketId, leg.side, leg.eventStateSequence, leg.eventGameState, leg.oddsScaled);
}

function coerceOddsScaled(value: unknown): bigint | null {
   if (value === undefined || value === null || value === "") {
      return null;
   }
   try {
      return BigInt(value as string | number | bigint);
   } catch {
      return null;
   }
}

export function parseSelectionsJson(raw: string): Selection[] {
   const parsed = JSON.parse(raw) as Selection[];
   if (!Array.isArray(parsed)) {
      throw new Error("selections must be a JSON array");
   }
   for (const sel of parsed) {
      sel.odds_scaled = coerceOddsScaled(sel.odds_scaled);
   }
   return parsed;
}

function parseFillersJson(raw: string | null | undefined): Filler[] {
   if (raw == null || raw === "") {
      return [];
   }
   const parsed = JSON.parse(raw) as Filler[];
   if (!Array.isArray(parsed)) {
      throw new Error("fillers must be a JSON array");
   }
   return parsed.map((filler) => ({
      ...filler,
      odds_scaled: coerceOddsScaled(filler.odds_scaled) ?? 0n,
   }));
}

function parseEventStatesJson(raw: string): EventState[] {
   const parsed = JSON.parse(raw) as EventState[];
   if (!Array.isArray(parsed)) {
      throw new Error("event_states must be a JSON array");
   }
   return parsed;
}

export function fillersFromBetAccount(fillers: BetAccountData["fillers"]): Filler[] {
   return fillers.map((filler) => ({
      address: filler.mmAddress,
      amount: Number(filler.amount),
      odds_scaled: filler.oddsScaled,
   }));
}

function rowToBetRecord(row: DbBetRow): BetRecord {
   return {
      id: row.id,
      bet_id: BigInt(row.bet_id),
      type: row.type,
      user_address: row.user_address,
      selections: parseSelectionsJson(row.selections),
      amount_requested: row.amount_requested,
      amount_filled: row.amount_filled,
      min_odds_requested: row.min_odds_requested,
      payout: row.payout,
      freebet_id: row.freebet_id,
      promo_type: row.promo_type,
      timestamp: row.timestamp,
      result: row.result,
      fillers: parseFillersJson(row.fillers),
      created_at: row.created_at,
      created_sig: row.created_sig,
      graded_at: row.graded_at,
      graded_sig: row.graded_sig,
      final_payout: row.final_payout,
      claimed_at: row.claimed_at,
      claimed_sig: row.claimed_sig,
      last_update_slot: row.last_update_slot,
      status: row.status,
   };
}

function rowToCashoutRecord(row: DbCashoutRow): CashoutRecord {
   return {
      id: row.id,
      orig_bet_id: BigInt(row.orig_bet_id),
      cashout_id: BigInt(row.cashout_id),
      type: row.type,
      amount: row.amount,
      payout: row.payout,
      selections: parseSelectionsJson(row.selections),
      event_states: parseEventStatesJson(row.event_states),
      fillingMm: row.fillingMm,
      timestamp: row.timestamp,
      result: row.result,
      created_at: row.created_at,
      created_sig: row.created_sig,
      graded_at: row.graded_at,
      graded_sig: row.graded_sig,
      final_payout: row.final_payout,
      claimed_at: row.claimed_at,
      claimed_sig: row.claimed_sig,
      last_update_slot: row.last_update_slot,
      status: row.status,
   };
}

function rowToCashoutEscrowRecord(row: DbCashoutEscrowRow): CashoutEscrowRecord {
   return {
      id: row.id,
      orig_bet_id: BigInt(row.orig_bet_id),
      cashout_id: BigInt(row.cashout_id),
      type: row.type,
      owner_address: row.owner_address,
      amount: row.amount,
      payout_removed: row.payout_removed,
      payment: row.payment,
      market_maker: row.market_maker,
      timestamp: row.timestamp,
      created_at: row.created_at,
      created_sig: row.created_sig,
      claimed_at: row.claimed_at,
      claimed_sig: row.claimed_sig,
      last_update_slot: row.last_update_slot,
      status: row.status,
   };
}

const LEGACY_COLUMNS: Record<string, { name: string; definition: string }[]> = {
   bet_accounts: [
      { name: "promo_type", definition: "promo_type INTEGER NOT NULL DEFAULT 0" },
      { name: "fillers", definition: "fillers TEXT NOT NULL DEFAULT '[]'" },
      { name: "unresolved", definition: "unresolved INTEGER NOT NULL DEFAULT 0" },
      { name: "resolve_attempts", definition: "resolve_attempts INTEGER NOT NULL DEFAULT 0" },
   ],
   cashout_accounts: [
      { name: "unresolved", definition: "unresolved INTEGER NOT NULL DEFAULT 0" },
      { name: "resolve_attempts", definition: "resolve_attempts INTEGER NOT NULL DEFAULT 0" },
   ],
   cashout_escrow_accounts: [
      { name: "unresolved", definition: "unresolved INTEGER NOT NULL DEFAULT 0" },
      { name: "resolve_attempts", definition: "resolve_attempts INTEGER NOT NULL DEFAULT 0" },
   ],
};

function addLegacyColumns(database: Database, table: string): void {
   const columns = LEGACY_COLUMNS[table];
   if (columns == null) {
      return;
   }
   const existing = new Set(
      database.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((col) => col.name),
   );
   for (const column of columns) {
      if (!existing.has(column.name)) {
         database.run(`ALTER TABLE ${table} ADD COLUMN ${column.definition}`);
      }
   }
}

let schemaReady = false;

export function ensureSchema(): void {
   if (schemaReady) {
      return;
   }
   const database = getDb();
   database.run(`CREATE TABLE IF NOT EXISTS bet_accounts (
      id TEXT PRIMARY KEY,
      bet_id TEXT NOT NULL,
      type TEXT NOT NULL,
      user_address TEXT NOT NULL,
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
      freebet_id INTEGER,
      promo_type INTEGER NOT NULL DEFAULT 0,
      fillers TEXT NOT NULL DEFAULT '[]',
      unresolved INTEGER NOT NULL DEFAULT 0,
      resolve_attempts INTEGER NOT NULL DEFAULT 0
   )`);
   addLegacyColumns(database, "bet_accounts");

   database.run(`CREATE TABLE IF NOT EXISTS cashout_accounts (
      id TEXT PRIMARY KEY,
      orig_bet_id TEXT NOT NULL,
      cashout_id TEXT NOT NULL,
      type TEXT NOT NULL,
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
      unresolved INTEGER NOT NULL DEFAULT 0,
      resolve_attempts INTEGER NOT NULL DEFAULT 0
   )`);
   database.run(`CREATE INDEX IF NOT EXISTS idx_cashout_accounts_orig_bet_id ON cashout_accounts (orig_bet_id)`);
   database.run(`CREATE INDEX IF NOT EXISTS idx_cashout_accounts_cashout_id ON cashout_accounts (cashout_id)`);
   addLegacyColumns(database, "cashout_accounts");

   database.run(`CREATE TABLE IF NOT EXISTS cashout_escrow_accounts (
      id TEXT PRIMARY KEY,
      orig_bet_id TEXT NOT NULL,
      cashout_id TEXT NOT NULL,
      type TEXT NOT NULL,
      owner_address TEXT NOT NULL,
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
      unresolved INTEGER NOT NULL DEFAULT 0,
      resolve_attempts INTEGER NOT NULL DEFAULT 0
   )`);
   database.run(`CREATE INDEX IF NOT EXISTS idx_cashout_escrow_orig_bet_id ON cashout_escrow_accounts (orig_bet_id)`);
   database.run(`CREATE INDEX IF NOT EXISTS idx_cashout_escrow_cashout_id ON cashout_escrow_accounts (cashout_id)`);
   addLegacyColumns(database, "cashout_escrow_accounts");

   database.run(`CREATE TABLE IF NOT EXISTS indexer_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_sig TEXT,
      last_slot INTEGER
   )`);
   database.run(`CREATE TABLE IF NOT EXISTS applied_instructions (
      signature TEXT NOT NULL,
      ix_index INTEGER NOT NULL,
      PRIMARY KEY (signature, ix_index)
   )`);
   schemaReady = true;
}

export function isInstructionApplied(signature: string, ixIndex: number): boolean {
   const database = getDb();
   const row = database.query<{ signature: string }, [string, number]>(
      `SELECT signature FROM applied_instructions WHERE signature = ? AND ix_index = ?`,
   ).get(signature, ixIndex);
   return row != null;
}

export function markInstructionApplied(signature: string, ixIndex: number): void {
   const database = getDb();
   database.run(
      `INSERT INTO applied_instructions (signature, ix_index) VALUES (?, ?)
       ON CONFLICT(signature, ix_index) DO NOTHING`,
      [signature, ixIndex],
   );
}

export function withInstructionWrite(signature: string, ixIndex: number, write: () => void): void {
   const database = getDb();
   database.transaction(() => {
      if (isInstructionApplied(signature, ixIndex)) {
         return;
      }
      write();
      markInstructionApplied(signature, ixIndex);
   })();
}

export function getIndexerWatermark(): { sig: string; slot: number } | null {
   const database = getDb();
   const row = database.query<{ last_sig: string | null; last_slot: number | null }, []>(
      `SELECT last_sig, last_slot FROM indexer_state WHERE id = 1`,
   ).get();
   if (!row || !row.last_sig) {
      return null;
   }
   return { sig: row.last_sig, slot: row.last_slot ?? 0 };
}

export function setIndexerWatermark(sig: string, slot: number): void {
   const database = getDb();
   database.run(
      `INSERT INTO indexer_state (id, last_sig, last_slot) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_sig = excluded.last_sig, last_slot = excluded.last_slot
       WHERE excluded.last_slot >= indexer_state.last_slot`,
      [sig, slot],
   );
}

export function addBetAccount(
   betAddress: string,
   userAddress: Address,
   type: BetRecordType,
   betId: bigint,
   selections: Selection[],
   amountRequested: bigint,
   amountFilled: bigint,
   minOddsRequested: bigint,
   payout: bigint,
   timestamp: number,
   meta: UpdateMeta,
   freebetId: number,
   promoType: number,
   fromChain: boolean,
   fillers: Filler[] = [],
): void {
   const database = getDb();
   const unresolved = fromChain ? 0 : 1;
   const conflictClause = fromChain
      ? ` ON CONFLICT(id) DO UPDATE SET
         bet_id = excluded.bet_id,
         type = excluded.type,
         user_address = excluded.user_address,
         selections = excluded.selections,
         amount_requested = excluded.amount_requested,
         amount_filled = excluded.amount_filled,
         min_odds_requested = excluded.min_odds_requested,
         payout = excluded.payout,
         timestamp = excluded.timestamp,
         last_update_slot = excluded.last_update_slot,
         freebet_id = excluded.freebet_id,
         promo_type = excluded.promo_type,
         fillers = excluded.fillers,
         unresolved = 0,
         resolve_attempts = 0
         WHERE bet_accounts.status = '${BetRecordStatus.Pending}'
            AND excluded.last_update_slot >= bet_accounts.last_update_slot`
      : ` ON CONFLICT(id) DO NOTHING`;
   database.run(
      `INSERT INTO bet_accounts
      (id, bet_id, type, user_address, selections, amount_requested, amount_filled, min_odds_requested, payout,
      timestamp, result, created_at, created_sig, last_update_slot, status, freebet_id, promo_type, fillers, unresolved, resolve_attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${conflictClause}`,
      [
         betAddress,
         betId.toString(),
         type,
         userAddress,
         safeJSONStringify(selections),
         Number(amountRequested),
         Number(amountFilled),
         Number(minOddsRequested),
         Number(payout),
         Number(timestamp),
         BetResult.Pending,
         meta.createdAt,
         meta.createdSig,
         meta.lastUpdateSlot,
         BetRecordStatus.Pending,
         freebetId ?? 0,
         promoType ?? 0,
         safeJSONStringify(fillers),
         unresolved,
         0,
      ],
   );
}

export function refreshBetFromChain(
   betAddress: string,
   type: BetRecordType,
   betId: bigint,
   userAddress: string,
   selections: Selection[],
   amountFilled: bigint,
   minOddsRequested: bigint,
   payout: bigint,
   timestamp: number,
   promoType: number,
   fillers: Filler[],
): void {
   const database = getDb();
   const existing = database.query<{ status: string; selections: string }, [string]>(
      `SELECT status, selections FROM bet_accounts WHERE id = ?`,
   ).get(betAddress);
   const nextSelections = keepSelectionResults(selections, existing);
   database.run(
      `UPDATE bet_accounts SET
         bet_id = ?,
         type = ?,
         user_address = ?,
         selections = ?,
         amount_filled = ?,
         min_odds_requested = ?,
         payout = ?,
         timestamp = ?,
         promo_type = ?,
         fillers = ?,
         unresolved = 0,
         resolve_attempts = 0
       WHERE id = ?`,
      [
         betId.toString(),
         type,
         userAddress,
         safeJSONStringify(nextSelections),
         Number(amountFilled),
         Number(minOddsRequested),
         Number(payout),
         Number(timestamp),
         promoType,
         safeJSONStringify(fillers),
         betAddress,
      ],
   );
}

function keepSelectionResults(
   next: Selection[],
   existing: { status: string; selections: string } | null,
): Selection[] {
   if (existing == null || existing.status === BetRecordStatus.Pending) {
      return next;
   }
   const previous = parseSelectionsJson(existing.selections);
   return next.map((selection, index) => ({
      ...selection,
      result: previous[index]?.result ?? selection.result,
   }));
}

export function addCashoutAccount(
   cashoutAddress: string,
   origBetId: bigint,
   cashoutId: bigint,
   type: BetRecordType,
   amount: bigint,
   payout: bigint,
   selections: Selection[],
   eventStates: EventState[],
   fillingMm: string,
   timestamp: number,
   meta: UpdateMeta,
   fromChain: boolean,
): void {
   const database = getDb();
   const unresolved = fromChain ? 0 : 1;
   const conflictClause = fromChain
      ? ` ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         amount = excluded.amount,
         payout = excluded.payout,
         selections = excluded.selections,
         event_states = excluded.event_states,
         fillingMm = excluded.fillingMm,
         timestamp = excluded.timestamp,
         last_update_slot = excluded.last_update_slot,
         unresolved = 0,
         resolve_attempts = 0
         WHERE cashout_accounts.status = '${BetRecordStatus.Pending}'
            AND excluded.last_update_slot >= cashout_accounts.last_update_slot`
      : ` ON CONFLICT(id) DO NOTHING`;
   database.run(
      `INSERT INTO cashout_accounts
      (id, orig_bet_id, cashout_id, type, amount, payout, selections, event_states, fillingMm, timestamp, result, created_at, created_sig, last_update_slot, status, unresolved, resolve_attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${conflictClause}`,
      [
         cashoutAddress,
         origBetId.toString(),
         cashoutId.toString(),
         type,
         Number(amount),
         Number(payout),
         safeJSONStringify(selections),
         safeJSONStringify(eventStates),
         fillingMm,
         timestamp,
         BetResult.Pending,
         meta.createdAt,
         meta.createdSig,
         meta.lastUpdateSlot,
         BetRecordStatus.Pending,
         unresolved,
         0,
      ],
   );
}

export function refreshCashoutFromChain(
   cashoutAddress: string,
   type: BetRecordType,
   amount: bigint,
   payout: bigint,
   selections: Selection[],
   eventStates: EventState[],
   fillingMm: string,
   timestamp: number,
): void {
   const database = getDb();
   const existing = database.query<{ status: string; selections: string }, [string]>(
      `SELECT status, selections FROM cashout_accounts WHERE id = ?`,
   ).get(cashoutAddress);
   const nextSelections = keepSelectionResults(selections, existing);
   database.run(
      `UPDATE cashout_accounts SET
         type = ?,
         amount = ?,
         payout = ?,
         selections = ?,
         event_states = ?,
         fillingMm = ?,
         timestamp = ?,
         unresolved = 0,
         resolve_attempts = 0
       WHERE id = ?`,
      [
         type,
         Number(amount),
         Number(payout),
         safeJSONStringify(nextSelections),
         safeJSONStringify(eventStates),
         fillingMm,
         timestamp,
         cashoutAddress,
      ],
   );
}

export function addCashoutEscrowAccount(
   escrowAddress: string,
   escrow: CashoutEscrowAccountData,
   meta: UpdateMeta,
   fromChain: boolean,
): void {
   const database = getDb();
   const unresolved = fromChain ? 0 : 1;
   database.run(
      `INSERT INTO cashout_escrow_accounts
      (id, orig_bet_id, cashout_id, type, owner_address, amount, payout_removed, payment, market_maker, timestamp, created_at, created_sig, last_update_slot, status, unresolved, resolve_attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
         orig_bet_id = excluded.orig_bet_id,
         cashout_id = excluded.cashout_id,
         type = excluded.type,
         owner_address = excluded.owner_address,
         amount = excluded.amount,
         payout_removed = excluded.payout_removed,
         payment = excluded.payment,
         market_maker = excluded.market_maker,
         timestamp = excluded.timestamp,
         last_update_slot = excluded.last_update_slot,
         unresolved = excluded.unresolved,
         resolve_attempts = 0
      WHERE cashout_escrow_accounts.unresolved = 1`,
      [
         escrowAddress,
         escrow.origBetId.toString(),
         escrow.cashoutId.toString(),
         escrow.isParlay ? "parlay" : "single",
         escrow.owner,
         Number(escrow.amount),
         Number(escrow.payoutRemoved),
         Number(escrow.payment),
         escrow.marketMaker,
         Number(escrow.timestamp),
         meta.createdAt,
         meta.createdSig,
         meta.lastUpdateSlot,
         CashoutEscrowStatus.Open,
         unresolved,
         0,
      ],
   );
}

export function refreshEscrowFromChain(escrowAddress: string, escrow: CashoutEscrowAccountData): void {
   const database = getDb();
   database.run(
      `UPDATE cashout_escrow_accounts SET
         orig_bet_id = ?,
         cashout_id = ?,
         type = ?,
         owner_address = ?,
         amount = ?,
         payout_removed = ?,
         payment = ?,
         market_maker = ?,
         timestamp = ?,
         unresolved = 0,
         resolve_attempts = 0
       WHERE id = ?`,
      [
         escrow.origBetId.toString(),
         escrow.cashoutId.toString(),
         escrow.isParlay ? "parlay" : "single",
         escrow.owner,
         Number(escrow.amount),
         Number(escrow.payoutRemoved),
         Number(escrow.payment),
         escrow.marketMaker,
         Number(escrow.timestamp),
         escrowAddress,
      ],
   );
}

export function noteUnresolvedAttempt(table: "bet_accounts" | "cashout_accounts" | "cashout_escrow_accounts", id: string, notFound: boolean): void {
   const database = getDb();
   if (!notFound) {
      return;
   }
   database.run(
      `UPDATE ${table} SET resolve_attempts = resolve_attempts + 1 WHERE id = ? AND unresolved = 1`,
      [id],
   );
}

export function listUnresolvedBets(): UnresolvedBetRow[] {
   const database = getDb();
   return database.query<UnresolvedBetRow, [number]>(
      `SELECT id, type, status, selections, resolve_attempts FROM bet_accounts
       WHERE unresolved = 1 AND resolve_attempts < ?`,
   ).all(NOT_FOUND_ATTEMPTS);
}

export function listUnresolvedCashouts(): UnresolvedCashoutRow[] {
   const database = getDb();
   return database.query<UnresolvedCashoutRow, [number]>(
      `SELECT id, type, status, selections, resolve_attempts FROM cashout_accounts
       WHERE unresolved = 1 AND resolve_attempts < ?`,
   ).all(NOT_FOUND_ATTEMPTS);
}

export function listUnresolvedEscrows(): UnresolvedEscrowRow[] {
   const database = getDb();
   return database.query<UnresolvedEscrowRow, [number]>(
      `SELECT id, status, resolve_attempts FROM cashout_escrow_accounts
       WHERE unresolved = 1 AND resolve_attempts < ?`,
   ).all(NOT_FOUND_ATTEMPTS);
}

export function updateBetOrCashoutAccountResult(
   accountAddress: string,
   result: BetResult,
   gradedAt: number,
   gradedSig: string,
   slot: number,
): void {
   const database = getDb();
   const betRow = database.query<DbBetRow, [string]>(`SELECT * FROM bet_accounts WHERE id = ?`).get(accountAddress);
   if (betRow) {
      const selections = parseSelectionsJson(betRow.selections);
      if (selections.length === 1) {
         selections[0]!.result = result;
      }
      database.run(
         `UPDATE bet_accounts SET selections = ?, result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
         [safeJSONStringify(selections), result, gradedAt, gradedSig, BetRecordStatus.Graded, slot, accountAddress],
      );
   }
   const row = database.query<DbCashoutRow, [string]>(`SELECT * FROM cashout_accounts WHERE id = ?`).get(accountAddress);
   if (!row) {
      return;
   }
   const record = rowToCashoutRecord(row);
   for (const selection of record.selections) {
      selection.result = result;
   }
   const foldedResult = foldParlayResult(record.selections);
   database.run(
      `UPDATE cashout_accounts SET selections = ?, result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
      [safeJSONStringify(record.selections), foldedResult, gradedAt, gradedSig, BetRecordStatus.Graded, slot, accountAddress],
   );
}

export function updateBetAccountCashedOut(
   betAddress: string,
   claimedAt: number,
   claimedSig: string,
   slot: number,
   finalPayout: number | null = null,
): void {
   const database = getDb();
   if (finalPayout === null) {
      database.run(
         `UPDATE bet_accounts SET result = ?, claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
         [BetResult.CashedOut, claimedAt, claimedSig, BetRecordStatus.CashedOut, slot, betAddress],
      );
   } else {
      database.run(
         `UPDATE bet_accounts SET result = ?, claimed_at = ?, claimed_sig = ?, status = ?, final_payout = ?, last_update_slot = ? WHERE id = ?`,
         [BetResult.CashedOut, claimedAt, claimedSig, BetRecordStatus.CashedOut, finalPayout, slot, betAddress],
      );
   }
}

export function applyOrigBetCashoutFill(
   origBetAddress: string,
   cashoutAmount: bigint,
   payoutRemoved: bigint,
   delayed: boolean,
   payment: number | null,
   meta: UpdateMeta,
): void {
   const database = getDb();
   const row = database.query<{ amount_filled: number; payout: number }, [string]>(
      `SELECT amount_filled, payout FROM bet_accounts WHERE id = ?`,
   ).get(origBetAddress);
   if (!row) {
      return;
   }
   const remainAmount = row.amount_filled - Number(cashoutAmount);
   const remainPayout = row.payout - Number(payoutRemoved);
   const isFull = remainAmount <= 0;
   if (delayed) {
      if (!isFull) {
         database.run(
            `UPDATE bet_accounts SET amount_filled = ?, payout = ?, last_update_slot = ? WHERE id = ? AND status = ?`,
            [remainAmount, remainPayout, meta.lastUpdateSlot, origBetAddress, BetRecordStatus.Pending],
         );
      }
      return;
   }
   if (isFull) {
      updateBetAccountCashedOut(origBetAddress, meta.createdAt, meta.createdSig, meta.lastUpdateSlot, payment);
      return;
   }
   database.run(
      `UPDATE bet_accounts SET amount_filled = ?, payout = ?, last_update_slot = ? WHERE id = ? AND status = ?`,
      [remainAmount, remainPayout, meta.lastUpdateSlot, origBetAddress, BetRecordStatus.Pending],
   );
}

export function escrowPaymentForAddress(escrowAddress: string): number | null {
   const database = getDb();
   const row = database.query<{ payment: number; unresolved: number }, [string]>(
      `SELECT payment, unresolved FROM cashout_escrow_accounts WHERE id = ?`,
   ).get(escrowAddress);
   if (row == null || row.unresolved === 1) {
      return null;
   }
   return Number(row.payment);
}

export function updateBetOrCashoutAccountSettled(
   accountAddress: string,
   settledAt: number,
   settledSig: string,
   slot: number,
): void {
   const database = getDb();
   database.run(
      `UPDATE bet_accounts SET claimed_at = ?, claimed_sig = ?, final_payout = payout, status = ?, last_update_slot = ? WHERE id = ?`,
      [settledAt, settledSig, BetRecordStatus.Claimed, slot, accountAddress],
   );
   database.run(
      `UPDATE cashout_accounts SET claimed_at = ?, claimed_sig = ?, final_payout = payout, status = ?, last_update_slot = ? WHERE id = ?`,
      [settledAt, settledSig, BetRecordStatus.Claimed, slot, accountAddress],
   );
}

export function updateCashoutAccountReverted(cashoutAddress: string, revertedAt: number, revertedSig: string, slot: number): void {
   const database = getDb();
   database.run(
      `UPDATE cashout_accounts SET graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
      [revertedAt, revertedSig, BetRecordStatus.Reverted, slot, cashoutAddress],
   );
}

export function revertBetCashout(betAddress: string, slot: number): void {
   const database = getDb();
   database.run(
      `UPDATE bet_accounts SET
         result = CASE WHEN graded_at IS NULL THEN ? ELSE result END,
         status = CASE WHEN graded_at IS NULL THEN ? ELSE ? END,
         claimed_at = NULL, claimed_sig = NULL, final_payout = NULL, last_update_slot = ? WHERE id = ?`,
      [BetResult.Pending, BetRecordStatus.Pending, BetRecordStatus.Graded, slot, betAddress],
   );
}

export function updateCashoutEscrowClaimed(escrowAddress: string, claimedAt: number, claimedSig: string, slot: number): void {
   const database = getDb();
   database.run(
      `UPDATE cashout_escrow_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
      [claimedAt, claimedSig, CashoutEscrowStatus.Claimed, slot, escrowAddress],
   );
}

export function updateCashoutEscrowReverted(escrowAddress: string, revertedAt: number, revertedSig: string, slot: number): void {
   const database = getDb();
   database.run(
      `UPDATE cashout_escrow_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
      [revertedAt, revertedSig, CashoutEscrowStatus.Reverted, slot, escrowAddress],
   );
}

function applyParlayGradeMask(selectionsRaw: string, mask: Uint8Array): Selection[] {
   const selections = parseSelectionsJson(selectionsRaw);
   for (let i = 0; i < mask.length; i++) {
      const gradeByte = mask[i]!;
      if (gradeByte === 255) {
         continue;
      }
      if (selections[i]) {
         selections[i]!.result = gradeByte as BetResult;
      }
   }
   return selections;
}

export function updateParlayOrCashoutAccountResult(
   accountAddress: string,
   mask: Uint8Array,
   slot: number,
   gradedAt: number,
   gradedSig: string,
): void {
   const database = getDb();
   const parlayRow = database.query<DbBetRow, [string]>(`SELECT * FROM bet_accounts WHERE id = ?`).get(accountAddress);
   if (parlayRow) {
      const selections = applyParlayGradeMask(parlayRow.selections, mask);
      const result = foldParlayResult(selections);
      database.run(
         `UPDATE bet_accounts SET selections = ?, result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
         [safeJSONStringify(selections), result, gradedAt, gradedSig, BetRecordStatus.Graded, slot, accountAddress],
      );
      return;
   }
   const cashoutRow = database.query<DbCashoutRow, [string]>(`SELECT * FROM cashout_accounts WHERE id = ?`).get(accountAddress);
   if (!cashoutRow) {
      return;
   }
   const selections = applyParlayGradeMask(cashoutRow.selections, mask);
   const result = foldParlayResult(selections);
   database.run(
      `UPDATE cashout_accounts SET selections = ?, result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
      [safeJSONStringify(selections), result, gradedAt, gradedSig, BetRecordStatus.Graded, slot, accountAddress],
   );
}

export function getClosedBetRecordsByUser(userAddress: string): BetRecord[] {
   const database = getDb();
   const betAccounts = database.query<DbBetRow, [string, string, string, string]>(
      `SELECT * FROM bet_accounts WHERE user_address = ? AND status IN (?, ?, ?) ORDER BY created_at DESC`,
   ).all(userAddress, BetRecordStatus.Claimed, BetRecordStatus.CashedOut, BetRecordStatus.Reverted);
   return betAccounts.map(rowToBetRecord);
}

export function getCashoutEscrowRecordsByUser(userAddress: string): CashoutEscrowRecord[] {
   const database = getDb();
   const rows = database.query<DbCashoutEscrowRow, [string]>(
      `SELECT * FROM cashout_escrow_accounts WHERE owner_address = ? ORDER BY created_at DESC`,
   ).all(userAddress);
   return rows.map(rowToCashoutEscrowRecord);
}

export function isAccountNotFound(error: unknown): boolean {
   const message = error instanceof Error ? error.message : String(error);
   return message.toLowerCase().includes("not found");
}
