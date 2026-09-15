import { getDb } from "./localDb";
import { getCompiledTransactionMessageDecoder, 
   getTransactionDecoder, 
   type Address, 
   type Base64EncodedDataResponse, 
   type Commitment, 
   type ReadonlyUint8Array, 
   type Signature, 
   type Slot, 
   type TransactionError, 
   type UnixTimestamp 
} from "@solana/kit";
import { AGGREGATOR_PROGRAM_ID, 
   BetResult, 
   decodeAggregatorInstructionData, 
   getBetData, 
   getParlayData, 
   getCashoutData, 
   getCashoutEscrowData, 
   getCashoutParlayData, 
   getFreebetData, 
   ODDS_SCALE, 
   SYSTEM_PROGRAM_ID, 
   MINT_ID, 
   type BetAccountData, 
   type CashoutAccountData, 
   type CashoutEscrowAccountData, 
   type CashoutParlayAccountData, 
   type FreebetAccountData, 
   type MarketId, 
   type ParlayBetAccountData, 
   type ParlayLegWire, 
   type FillBetIxData, 
   type FillRfqBetIxData, 
   type FillParlayIxData, 
   type FillRfqParlayIxData, 
   type ParlayLegQuoted, 
   type EventGameState, 
   type DecodedAggregatorInstruction, 
} from "spamm-aggregator-sdk";
import { createRpcClients } from "../aggregator/client/txSend";
import { withRpcRetry } from "../market_maker/client/txSend";
import { foldParlayResult, safeJSONStringify } from "./utils";
const client = createRpcClients()

// Slot of the last program upgrade — the indexer ignores any program activity before it.
const LAST_PROGRAM_UPDATE_SLOT = 495152945n;

/** RPC blockTime is nullable; Number(null) would silently coerce to 0, so make that explicit. */
function blockTimeSeconds(blockTime: UnixTimestamp | null): number {
   return blockTime === null ? 0 : Number(blockTime);
}

// initIndexerTables()
// console.log(getLatestUpdate());

if(import.meta.main === true) {
   runIndexer();
   setInterval(async () => {
      await runIndexer();
   }, 1000 * 60 * 10);
}

enum BetRecordStatus {
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
   side: number;
   event_state_sequence: number;
   event_game_state: EventGameState;
   odds_scaled: bigint | null;
   result: BetResult | null;
}

export type Filler = {
   address: string;
   amount: number;
   odds_scaled: bigint;
}

export type EventState = {
   sequence: number;
   game_state: EventGameState;
}

export type BetRecordType = "single" | "parlay";

export type BetRecord = {
   id: string;
   /** Stored as string in SQLite/API to avoid JSON number precision loss for large u64 bet ids. */
   bet_id: bigint;
   type: BetRecordType;
   user_address: string;
   selections: Selection[];
   amount_requested: number;
   amount_filled: number;
   min_odds_requested: number;
   payout: number;
   freebet_id: number;
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
}

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
}

type DbBetRow = Omit<BetRecord, "selections" | "bet_id" | "fillers"> & {
   bet_id: string;
   selections: string;
   freebet_id: number;
   fillers: string;
};

type DbCashoutEscrowRow = Omit<CashoutEscrowRecord, "orig_bet_id" | "cashout_id"> & {
   orig_bet_id: string;
   cashout_id: string;
};

type DbCashoutRow = Omit<CashoutRecord, "selections" | "event_states"> & {
   selections: string;
   event_states: string;
};

function selectionFromMarketId(marketId: MarketId, side: number, eventStateSequence: number, eventGameState: EventGameState, oddsScaled: bigint | null = null): Selection {
   return {
      sport_id: marketId.eventId.sport,
      league_id: marketId.eventId.league,
      event_id: Number(marketId.eventId.event),
      mkt_id: marketId.mkt,
      period_id: marketId.period,
      player_id: Number(marketId.player),
      is_pregame: marketId.isPregame ? 1 : 0,
      operator: marketId.operator,
      side,
      event_state_sequence: eventStateSequence,
      event_game_state: eventGameState,
      odds_scaled: oddsScaled,
      result: BetResult.Pending,
   };
}

function selectionFromParlayLeg(leg: ParlayLegWire): Selection {
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

function parseSelectionsJson(raw: string): Selection[] {
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

function fillersFromBetAccount(fillers: BetAccountData["fillers"]): Filler[] {
   return fillers.map((filler) => ({
      address: filler.mmAddress,
      amount: Number(filler.amount),
      odds_scaled: filler.oddsScaled,
   }));
}

function ticketOddsScaled(amount: bigint, payout: bigint, fallback: bigint): bigint {
   if (fallback > 0n) {
      return fallback;
   }
   if (amount <= 0n || payout <= 0n) {
      return 0n;
   }
   return (payout * ODDS_SCALE) / amount;
}

function isFreebetFillKind(kind: DecodedAggregatorInstruction["kind"]): boolean {
   return kind === "freebetFillBet"
      || kind === "freebetFillRfqBet"
      || kind === "freebetFillParlay"
      || kind === "freebetFillRfqParlay";
}

function fillBetPdaIndex(kind: DecodedAggregatorInstruction["kind"]): number {
   return isFreebetFillKind(kind) ? 5 : 3;
}

function parseUiTokenAmount(raw: unknown): bigint {
   if (raw == null || typeof raw !== "object") {
      return 0n;
   }
   const amount = (raw as { amount?: unknown }).amount;
   if (typeof amount === "string" || typeof amount === "number" || typeof amount === "bigint") {
      try {
         return BigInt(amount);
      } catch {
         return 0n;
      }
   }
   return 0n;
}

function tokenIncreaseForOwner(meta: unknown, owner: string): number | null {
   if (meta == null || typeof meta !== "object") {
      return null;
   }
   const rec = meta as { preTokenBalances?: unknown; postTokenBalances?: unknown };
   const pre = Array.isArray(rec.preTokenBalances) ? rec.preTokenBalances : [];
   const post = Array.isArray(rec.postTokenBalances) ? rec.postTokenBalances : [];
   let preAmt = 0n;
   let postAmt = 0n;
   for (const item of pre) {
      if (item == null || typeof item !== "object") {
         continue;
      }
      const row = item as { owner?: string; mint?: string; uiTokenAmount?: unknown };
      if (row.owner !== owner || row.mint !== MINT_ID) {
         continue;
      }
      preAmt += parseUiTokenAmount(row.uiTokenAmount);
   }
   for (const item of post) {
      if (item == null || typeof item !== "object") {
         continue;
      }
      const row = item as { owner?: string; mint?: string; uiTokenAmount?: unknown };
      if (row.owner !== owner || row.mint !== MINT_ID) {
         continue;
      }
      postAmt += parseUiTokenAmount(row.uiTokenAmount);
   }
   const delta = postAmt - preAmt;
   return delta > 0n ? Number(delta) : null;
}

function rowToBetRecord(row: DbBetRow): BetRecord {
   return {
      ...row,
      bet_id: BigInt(row.bet_id),
      selections: parseSelectionsJson(row.selections),
      fillers: parseFillersJson(row.fillers),
   };
}

function rowToCashoutRecord(row: DbCashoutRow): CashoutRecord {
   return {
      ...row,
      orig_bet_id: BigInt(row.orig_bet_id),
      cashout_id: BigInt(row.cashout_id),
      selections: parseSelectionsJson(row.selections),
      event_states: parseEventStatesJson(row.event_states),
   };
}

function rowToCashoutEscrowRecord(row: DbCashoutEscrowRow): CashoutEscrowRecord {
   return {
      ...row,
      orig_bet_id: BigInt(row.orig_bet_id),
      cashout_id: BigInt(row.cashout_id),
   };
}

function createBetAccountsTable(database: ReturnType<typeof getDb>): void {
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
      fillers TEXT NOT NULL DEFAULT '[]'
   )`);
}

function createCashoutAccountsTable(database: ReturnType<typeof getDb>): void {
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
      status TEXT NOT NULL
   )`);
   database.run(`CREATE INDEX IF NOT EXISTS idx_cashout_accounts_orig_bet_id ON cashout_accounts (orig_bet_id)`);
   database.run(`CREATE INDEX IF NOT EXISTS idx_cashout_accounts_cashout_id ON cashout_accounts (cashout_id)`);
}

function createCashoutEscrowAccountsTable(database: ReturnType<typeof getDb>): void {
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
      status TEXT NOT NULL
   )`);
   database.run(`CREATE INDEX IF NOT EXISTS idx_cashout_escrow_orig_bet_id ON cashout_escrow_accounts (orig_bet_id)`);
   database.run(`CREATE INDEX IF NOT EXISTS idx_cashout_escrow_cashout_id ON cashout_escrow_accounts (cashout_id)`);
}

// initIndexerTables()
function initIndexerTables(): void {
   const database = getDb();
   database.run(`DROP TABLE IF EXISTS bet_accounts`);
   createBetAccountsTable(database);
   database.run(`DROP TABLE IF EXISTS cashout_accounts`);
   createCashoutAccountsTable(database);
   database.run(`DROP TABLE IF EXISTS cashout_escrow_accounts`);
   createCashoutEscrowAccountsTable(database);
   // indexer_state (the resume watermark) survives table rebuilds — create it if missing, never drop.
   createIndexerStateTable(database);
};

type UpdateMeta = {
   createdAt: number;
   createdSig: string;
   lastUpdateSlot: number;
};

function addBetAccount(
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
   replaceExisting: boolean,
   fillers: Filler[] = [],
): void {
   const database = getDb();
   // A later fill carrying fresh on-chain account data may refresh an existing row — but only while the
   // row is still pending and the new data is not older. This lets a subsequent successful account fetch
   // correct an earlier synthetic fallback row, while graded/claimed records are never overwritten.
   const conflictClause = replaceExisting
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
         fillers = excluded.fillers
         WHERE bet_accounts.status = '${BetRecordStatus.Pending}'
            AND excluded.last_update_slot >= bet_accounts.last_update_slot`
      : ` ON CONFLICT(id) DO NOTHING`;
   database.run(`INSERT INTO bet_accounts
      (id, bet_id, type, user_address, selections, amount_requested, amount_filled, min_odds_requested, payout,
      timestamp, result, created_at, created_sig, last_update_slot, status, freebet_id, fillers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${conflictClause}`,
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
         safeJSONStringify(fillers),
      ]
   );
};

function updateBetOrCashoutAccountResult(accountAddress: string, result: BetResult, gradedAt: number, gradedSig: string, slot: number): void {
   const database = getDb();
   const betRow = database.query<DbBetRow, string[]>(`SELECT * FROM bet_accounts WHERE id = ?`).get(accountAddress);
   if (betRow) {
      const selections = parseSelectionsJson(betRow.selections);
      if (selections.length === 1) {
         selections[0]!.result = result;
      }
      database.run(`UPDATE bet_accounts SET selections = ?, result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
         [safeJSONStringify(selections), result, gradedAt, gradedSig, BetRecordStatus.Graded, slot, accountAddress]);
   }
   const row = database.query<DbCashoutRow, string[]>(`SELECT * FROM cashout_accounts WHERE id = ?`).get(accountAddress);
   if (!row) {
      return;
   }
   const record = rowToCashoutRecord(row);
   for (const selection of record.selections) {
      selection.result = result;
   }
   const foldedResult = foldParlayResult(record.selections);
   database.run(`UPDATE cashout_accounts SET selections = ?, result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
      [safeJSONStringify(record.selections), foldedResult, gradedAt, gradedSig, BetRecordStatus.Graded, slot, accountAddress]);
};

function updateBetAccountClaimed(betAddress: string, claimedAt: number, claimedSig: string, slot: number, finalPayout: number | null = null): void {
   const database = getDb();
   if (finalPayout === null) {
      database.run(`UPDATE bet_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`, 
         [claimedAt, claimedSig, BetRecordStatus.Claimed, slot, betAddress]);
   } else {
      database.run(`UPDATE bet_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, final_payout = ?, last_update_slot = ? WHERE id = ?`, 
         [claimedAt, claimedSig, BetRecordStatus.Claimed, finalPayout, slot, betAddress]);
   }
};

function updateBetAccountCashedOut(
   betAddress: string,
   claimedAt: number,
   claimedSig: string,
   slot: number,
   finalPayout: number | null = null,
): void {
   const database = getDb();
   if (finalPayout === null) {
      database.run(`UPDATE bet_accounts SET result = ?, claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
         [BetResult.CashedOut, claimedAt, claimedSig, BetRecordStatus.CashedOut, slot, betAddress]);
   } else {
      database.run(`UPDATE bet_accounts SET result = ?, claimed_at = ?, claimed_sig = ?, status = ?, final_payout = ?, last_update_slot = ? WHERE id = ?`,
         [BetResult.CashedOut, claimedAt, claimedSig, BetRecordStatus.CashedOut, finalPayout, slot, betAddress]);
   }
};

function applyOrigBetCashoutFill(
   origBetAddress: string,
   cashoutAmount: bigint,
   payoutRemoved: bigint,
   delayed: boolean,
   payment: number | null,
   meta: UpdateMeta,
): void {
   const database = getDb();
   const row = database.query<{ amount_filled: number, payout: number }, string[]>(
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

function escrowPaymentForAddress(escrowAddress: string): number | null {
   const database = getDb();
   const row = database.query<{ payment: number }, string[]>(
      `SELECT payment FROM cashout_escrow_accounts WHERE id = ?`,
   ).get(escrowAddress);
   return row == null ? null : Number(row.payment);
}

function updateBetOrCashoutAccountSettled(accountAddress: string, settledAt: number, settledSig: string, slot: number): void {
   const database = getDb();
   // Funds were paid out on settle, so record the known payout as the final payout and close out the record.
   database.run(`UPDATE bet_accounts SET claimed_at = ?, claimed_sig = ?, final_payout = payout, status = ?, last_update_slot = ? WHERE id = ?`,
      [settledAt, settledSig, BetRecordStatus.Claimed, slot, accountAddress]);
   database.run(`UPDATE cashout_accounts SET claimed_at = ?, claimed_sig = ?, final_payout = payout, status = ?, last_update_slot = ? WHERE id = ?`,
      [settledAt, settledSig, BetRecordStatus.Claimed, slot, accountAddress]);
};

function updateCashoutAccountReverted(cashoutAddress: string, revertedAt: number, revertedSig: string, slot: number): void {
   const database = getDb();
   database.run(`UPDATE cashout_accounts SET graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
      [revertedAt, revertedSig, BetRecordStatus.Reverted, slot, cashoutAddress]);
};

function revertBetCashout(betAddress: string, slot: number): void {
   const database = getDb();
   // Undo the cashout: clear the cashout claim fields. If the bet had already been graded before it was
   // cashed out, keep it graded (the pre-cashout result value is not recoverable from this row);
   // otherwise put the bet back to pending.
   database.run(`UPDATE bet_accounts SET
      result = CASE WHEN graded_at IS NULL THEN ? ELSE result END,
      status = CASE WHEN graded_at IS NULL THEN ? ELSE ? END,
      claimed_at = NULL, claimed_sig = NULL, final_payout = NULL, last_update_slot = ? WHERE id = ?`,
      [BetResult.Pending, BetRecordStatus.Pending, BetRecordStatus.Graded, slot, betAddress]);
};

function updateCashoutAccountResult(cashoutAddress: string, result: BetResult, gradedAt: number, gradedSig: string, slot: number): void {
   const database = getDb();
   database.run(`UPDATE cashout_accounts SET result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`, [result, gradedAt, gradedSig, BetRecordStatus.Graded, slot, cashoutAddress]);
};

function updateCashoutAccountClaimed(cashoutAddress: string, claimedAt: number, claimedSig: string, slot: number, finalPayout: number | null = null): void {
   const database = getDb();
   if (finalPayout === null) {
      database.run(`UPDATE cashout_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`, [claimedAt, claimedSig, BetRecordStatus.Claimed, slot, cashoutAddress]);
   } else {
      database.run(`UPDATE cashout_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, final_payout = ?, last_update_slot = ? WHERE id = ?`, [claimedAt, claimedSig, BetRecordStatus.Claimed, finalPayout, slot, cashoutAddress]);
   }
};

function addCashoutAccount(
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
   replaceExisting: boolean,
): void {
   const database = getDb();
   // Same refresh rules as addBetAccount: only pending rows, only with data at least as recent.
   const conflictClause = replaceExisting
      ? ` ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         amount = excluded.amount,
         payout = excluded.payout,
         selections = excluded.selections,
         event_states = excluded.event_states,
         fillingMm = excluded.fillingMm,
         timestamp = excluded.timestamp,
         last_update_slot = excluded.last_update_slot
         WHERE cashout_accounts.status = '${BetRecordStatus.Pending}'
            AND excluded.last_update_slot >= cashout_accounts.last_update_slot`
      : ` ON CONFLICT(id) DO NOTHING`;
   database.run(`INSERT INTO cashout_accounts
      (id, orig_bet_id, cashout_id, type, amount, payout, selections, event_states, fillingMm, timestamp, result, created_at, created_sig, last_update_slot, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)${conflictClause}`,
      [cashoutAddress, origBetId.toString(), cashoutId.toString(), type, Number(amount), Number(payout), safeJSONStringify(selections), safeJSONStringify(eventStates), fillingMm, timestamp, BetResult.Pending, meta.createdAt, meta.createdSig, meta.lastUpdateSlot, BetRecordStatus.Pending]);
};

export function addCashoutEscrowAccount(
   escrowAddress: string,
   escrow: CashoutEscrowAccountData,
   meta: UpdateMeta,
): void {
   const database = getDb();
   database.run(`INSERT OR IGNORE INTO cashout_escrow_accounts
      (id, orig_bet_id, cashout_id, type, owner_address, amount, payout_removed, payment, market_maker, timestamp, created_at, created_sig, last_update_slot, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ]
   );
}

function updateCashoutEscrowClaimed(escrowAddress: string, claimedAt: number, claimedSig: string, slot: number): void {
   const database = getDb();
   database.run(`UPDATE cashout_escrow_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`, [claimedAt, claimedSig, CashoutEscrowStatus.Claimed, slot, escrowAddress]);
}

function updateCashoutEscrowReverted(escrowAddress: string, claimedAt: number, claimedSig: string, slot: number): void {
   const database = getDb();
   database.run(`UPDATE cashout_escrow_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`, [claimedAt, claimedSig, CashoutEscrowStatus.Reverted, slot, escrowAddress]);
}

export function getCashoutEscrowRecordsByUser(userAddress: string): CashoutEscrowRecord[] {
   const database = getDb();
   const rows = database.query<DbCashoutEscrowRow, string[]>(`SELECT * FROM cashout_escrow_accounts WHERE owner_address = ? ORDER BY created_at DESC`).all(userAddress);
   return rows.map(rowToCashoutEscrowRecord);
}


function deleteCashoutAccount(cashoutAddress: string): void {
   const database = getDb();
   database.run(`DELETE FROM cashout_accounts WHERE id = ?`, [cashoutAddress]);
}

async function recordCashoutEscrowIfLive(escrowAddress: string, meta: UpdateMeta): Promise<CashoutEscrowAccountData | null> {
   if (!escrowAddress || escrowAddress === SYSTEM_PROGRAM_ID) {
      return null;
   }
   try {
      const escrow = await getCashoutEscrowData(client.rpc, escrowAddress as Address);
      addCashoutEscrowAccount(escrowAddress, escrow, meta);
      return escrow;
   } catch {
      return null;
   }
}

function applyParlayGradeMask<Row extends { selections: string }>(
   row: Row | null | undefined,
   mask: Uint8Array,
): Selection[] | null {
   if (!row) {
      return null;
   }
   const selections = parseSelectionsJson(row.selections);
   for (let i = 0; i < mask.length; i++) {
      const gradeByte = mask[i]!;
      if (gradeByte === 255) {
         continue;
      }
      selections[i]!.result = gradeByte as BetResult;
   }
   return selections;
}

function updateParlayOrCashoutAccountResult(accountAddress: string, mask: Uint8Array, slot: number, gradedAt: number, gradedSig: string): void {
   const database = getDb();
   let dbRow: DbBetRow | DbCashoutRow | null = null;
   let recordType: "bet" | "cashout" | null = null;
   const parlayRow = database.query<DbBetRow, string[]>(`SELECT * FROM bet_accounts WHERE id = ?`).get(accountAddress);
   if (parlayRow) {
      dbRow = parlayRow;
      recordType = "bet";
   } else {
      const cashoutRow = database.query<DbCashoutRow, string[]>(`SELECT * FROM cashout_accounts WHERE id = ?`).get(accountAddress);
      if (cashoutRow) {
         dbRow = cashoutRow;
         recordType = "cashout";
      }
   }
   if (!dbRow) {
      return;
   }
   const selections = applyParlayGradeMask(dbRow, mask);
   if (!selections) {
      return;
   }
   const result = foldParlayResult(selections);
   database.run(`UPDATE ${recordType === "bet" ? "bet_accounts" : "cashout_accounts"} SET selections = ?, result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`,
      [safeJSONStringify(selections), result, gradedAt, gradedSig, BetRecordStatus.Graded, slot, accountAddress]);
}


function getLatestUpdate(): {created: string | null,  graded: string | null, claimed: string | null} {
   const database = getDb();
   const bet = database.query<{ created_sig: string, created_at: number, graded_sig: string, graded_at: number, claimed_sig: string, claimed_at: number }, string[]>(`SELECT created_sig, created_at, graded_sig, graded_at, claimed_sig, claimed_at FROM bet_accounts ORDER BY last_update_slot DESC LIMIT 1`).get();
   if (!bet) {
      return {created: null, graded: null, claimed: null};
   }
   return {
      created: bet.created_sig, 
      graded: bet.graded_sig, 
      claimed: bet.claimed_sig,
   };  
};

// === INDEXER WATERMARK ===
// Single high-water-mark (newest processed signature + slot) so each run resumes right after the last
// processed transaction, instead of inferring the resume point from individual record rows.
function createIndexerStateTable(database: ReturnType<typeof getDb>): void {
   database.run(`CREATE TABLE IF NOT EXISTS indexer_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_sig TEXT,
      last_slot INTEGER
   )`);
}

function getIndexerWatermark(): { sig: string; slot: number } | null {
   const database = getDb();
   createIndexerStateTable(database);
   const row = database.query<{ last_sig: string | null, last_slot: number | null }, string[]>(`SELECT last_sig, last_slot FROM indexer_state WHERE id = 1`).get();
   if (!row || !row.last_sig) {
      return null;
   }
   return { sig: row.last_sig, slot: row.last_slot ?? 0 };
}

function setIndexerWatermark(sig: string, slot: number): void {
   const database = getDb();
   createIndexerStateTable(database);
   database.run(`INSERT INTO indexer_state (id, last_sig, last_slot) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_sig = excluded.last_sig, last_slot = excluded.last_slot
      WHERE excluded.last_slot >= indexer_state.last_slot`, [sig, slot]);
}

type SigMeta = {
   blockTime: UnixTimestamp | null;
   confirmationStatus: Commitment | null;
   err: TransactionError | null;
   memo: string | null;
   signature: Signature;
   slot: Slot;
};

type TransactionMeta = SigMeta & {
   transaction: Base64EncodedDataResponse | null;
   rpcMeta?: unknown;
   /** true when the tx exists on-chain but failed (meta.err) or has no fetchable data — terminal, skip forever. */
   isTerminalMiss?: boolean;
};

// getSigsSinceLatestSig(null, null, null)
async function getSigsSinceLatestSig(latestSig: string | null): Promise<SigMeta[]> {
   const sigs = [];
   let isEnd = false;
   let before: Signature | null = null;
   while (!isEnd) {
      const sigsRes = await client.rpc.getSignaturesForAddress(AGGREGATOR_PROGRAM_ID, {
         ...(latestSig ? { until: latestSig as Signature } : {}),
         ...(before ? { before: before as Signature } : {}),
         commitment: "confirmed",
         limit: 1000,
      }).send();
      sigs.push(...sigsRes)
      if (sigsRes.length < 1000) {
         isEnd = true;
      } else {
         before = sigsRes[sigsRes.length - 1]!.signature;
      }
   }
   //order oldest to newest
   const orderedSigs = sigs
      .filter((sig) => sig.slot > LAST_PROGRAM_UPDATE_SLOT) //ignore activity before the last program update
      .sort((a, b) => Number(a.slot) - Number(b.slot));
   
   return orderedSigs;
}

async function getTransactionFromSig(sig: SigMeta): Promise<TransactionMeta> {
   try {
      const transaction = await withRpcRetry(() =>
         client.rpc.getTransaction(sig.signature, {
            commitment: "confirmed",
            encoding: "base64",
            maxSupportedTransactionVersion: 1,
         }).send(),
      );
      if (transaction && !transaction.meta?.err) {
         return {
            ...sig,
            transaction: transaction.transaction,
            rpcMeta: transaction.meta,
         };
      }
      // The tx exists on-chain but failed (meta.err) or has no fetchable data — nothing to index, ever.
      return {
         ...sig,
         transaction: null,
         isTerminalMiss: true,
      };
   } catch {
      // Transient RPC failure — do NOT mark terminal, so the sig is retried on the next run.
      return {
         ...sig,
         transaction: null,
      };
   }
}

const txDecoder = getTransactionDecoder();
const msgDecoder = getCompiledTransactionMessageDecoder();
function parseTxData(transaction: Base64EncodedDataResponse): ({accounts: Address[], data: ReadonlyUint8Array})[] {
   const txBytes = new Uint8Array(Buffer.from(...transaction));
   const decodedTransaction = txDecoder.decode(txBytes);
   const decodedMessage = msgDecoder.decode(decodedTransaction.messageBytes);
   const parsedIxs: {accounts: Address[], data: ReadonlyUint8Array}[] = [];

   if (decodedMessage.version === 0 || decodedMessage.version === "legacy") {
      for (const instruction of decodedMessage.instructions) {
         const programId = decodedMessage.staticAccounts[instruction.programAddressIndex];
         if (programId !== AGGREGATOR_PROGRAM_ID) {
            continue;
         }
         if (!instruction.accountIndices) {
            continue;
         }
         const ixAccounts = instruction.accountIndices.map((index) => decodedMessage.staticAccounts[index]!);
         parsedIxs.push({
            accounts: ixAccounts,
            data: instruction.data!,
         });
      }
   } else if (decodedMessage.version === 1) {
      for (let i = 0; i < decodedMessage.instructionHeaders.length; i++) {
         const instructionHeader = decodedMessage.instructionHeaders[i]!;
         const instructionPayload = decodedMessage.instructionPayloads[i]!;
         const programId = decodedMessage.staticAccounts[instructionHeader.programAccountIndex];
         if (programId !== AGGREGATOR_PROGRAM_ID) {
            continue;
         }
         const ixAccounts = instructionPayload.instructionAccountIndices.map((index) => decodedMessage.staticAccounts[index]!);
         parsedIxs.push({
            accounts: ixAccounts,
            data: instructionPayload.instructionData,
         });
      }
   } else {
      throw new Error("Invalid transaction version");
   }
   
   return parsedIxs;
}

function getBetRecords(): BetRecord[] {
   const database = getDb();
   const betAccounts = database.query<DbBetRow, string[]>(`SELECT * FROM bet_accounts`).all();
   return betAccounts
      .filter((row: DbBetRow) => row.status !== BetRecordStatus.Pending)
      .map(rowToBetRecord);
}

export function getClosedBetRecordsByUser(userAddress: string): BetRecord[] {
   const database = getDb();
   // "Closed" includes every terminal status, not just claimed bets.
   const betAccounts = database.query<DbBetRow, string[]>(`SELECT * FROM bet_accounts WHERE user_address = ? AND status IN (?, ?, ?) ORDER BY created_at DESC`)
      .all(userAddress, BetRecordStatus.Claimed, BetRecordStatus.CashedOut, BetRecordStatus.Reverted);
   return betAccounts.map(rowToBetRecord);
}

async function indexAggregatorInstruction(
   ix: { accounts: Address[]; data: ReadonlyUint8Array },
   transactionMeta: TransactionMeta,
   blockTime: number,
): Promise<void> {
   let decodedTransaction: DecodedAggregatorInstruction;
   try {
      decodedTransaction = decodeAggregatorInstructionData(ix.data);
   } catch (error) {
      console.error("Error decoding transaction:", error);
      console.error("Data:", ix.data);
      return;
   }
   const meta: UpdateMeta = {
      createdAt: blockTime,
      createdSig: transactionMeta.signature,
      lastUpdateSlot: Number(transactionMeta.slot),
   };
   const userAddress = ix.accounts[1]!;
   const userOwner = ix.accounts[2]!;

   if (decodedTransaction.kind === "fillBet" || decodedTransaction.kind === "fillRfqBet" || decodedTransaction.kind === "freebetFillBet" || decodedTransaction.kind === "freebetFillRfqBet") {
      const data = decodedTransaction.data;
      const betPda = ix.accounts[fillBetPdaIndex(decodedTransaction.kind)]!;
      let betAccount: BetAccountData;
      let oddsScaled = 0n;
      let fetchedFromChain = true;
      try {
         betAccount = await getBetData(client.rpc, betPda);
      } catch {
         fetchedFromChain = false;
         if (decodedTransaction.kind === "fillRfqBet" || decodedTransaction.kind === "freebetFillRfqBet") {
            oddsScaled = (decodedTransaction.data as FillRfqBetIxData).oddsScaled;
         } else {
            oddsScaled = (decodedTransaction.data as FillBetIxData).minOddsScaled;
         }
         betAccount = {
            betId: data.betId,
            discriminator: 1,
            bump: 0,
            owner: userAddress,
            feepayer: ix.accounts[0]!,
            marketId: data.marketId,
            amount: data.amount,
            timestamp: blockTime,
            payout: data.amount * oddsScaled / ODDS_SCALE,
            result: BetResult.Pending,
            side: data.side,
            eventStateSequence: data.eventStateSequence,
            eventGameState: data.eventGameState,
            numFillers: 0,
            fillers: [],
            freebetId: decodedTransaction.kind === "freebetFillBet" || decodedTransaction.kind === "freebetFillRfqBet" ? decodedTransaction.freebetId : 0,
         };
      }
      const filledOdds = ticketOddsScaled(betAccount.amount, betAccount.payout, oddsScaled);
      addBetAccount(
         betPda,
         userAddress,
         "single",
         betAccount.betId,
         [selectionFromMarketId(betAccount.marketId, betAccount.side, betAccount.eventStateSequence, betAccount.eventGameState, filledOdds > 0n ? filledOdds : null)],
         data.amount,
         betAccount.amount,
         filledOdds,
         betAccount.payout,
         betAccount.timestamp,
         meta,
         decodedTransaction.kind === "freebetFillBet" || decodedTransaction.kind === "freebetFillRfqBet" ? decodedTransaction.freebetId : 0,
         fetchedFromChain,
         fillersFromBetAccount(betAccount.fillers),
      );
   }

   else if (decodedTransaction.kind === "fillParlay" || decodedTransaction.kind === "fillRfqParlay" || decodedTransaction.kind === "freebetFillParlay" || decodedTransaction.kind === "freebetFillRfqParlay") {
      const betPda = ix.accounts[fillBetPdaIndex(decodedTransaction.kind)]!;
      let parlayAccount: ParlayBetAccountData;
      let oddsScaled = 0n;
      let fetchedFromChain = true;
      try {
         parlayAccount = await getParlayData(client.rpc, betPda);
      } catch {
         fetchedFromChain = false;
         if (decodedTransaction.kind === "fillRfqParlay" || decodedTransaction.kind === "freebetFillRfqParlay") {
            oddsScaled = (decodedTransaction.data as FillRfqParlayIxData).oddsScaled;
         } else {
            oddsScaled = (decodedTransaction.data as FillParlayIxData).minOddsScaled;
         }
         parlayAccount = {
            betId: decodedTransaction.data.betId,
            discriminator: 2,
            bump: 0,
            owner: userAddress,
            feepayer: ix.accounts[0]!,
            amount: decodedTransaction.data.amount,
            payout: decodedTransaction.data.amount * oddsScaled / ODDS_SCALE,
            timestamp: blockTime,
            result: BetResult.Pending,
            fillerAddress: SYSTEM_PROGRAM_ID,
            numLegs: decodedTransaction.data.numLegs,
            legs: decodedTransaction.data.legs.map(leg => ({
               result: BetResult.Pending,
               oddsScaled: (leg as ParlayLegQuoted).oddsScaled ?? undefined,
               eventStateSequence: leg.eventStateSequence ?? undefined,
               eventGameState: leg.eventGameState ?? undefined,
               marketId: leg.marketId,
               side: leg.side,
            })),
            freebetId: decodedTransaction.kind === "freebetFillParlay" || decodedTransaction.kind === "freebetFillRfqParlay" ? decodedTransaction.freebetId : 0,
         };
      }
      const activeLegs = parlayAccount.legs.slice(0, parlayAccount.numLegs);
      addBetAccount(
         betPda,
         userAddress,
         "parlay",
         parlayAccount.betId,
         activeLegs.map(selectionFromParlayLeg),
         decodedTransaction.data.amount,
         parlayAccount.amount,
         ticketOddsScaled(parlayAccount.amount, parlayAccount.payout, oddsScaled),
         parlayAccount.payout,
         parlayAccount.timestamp,
         meta,
         decodedTransaction.kind === "freebetFillParlay" || decodedTransaction.kind === "freebetFillRfqParlay" ? decodedTransaction.freebetId : 0,
         fetchedFromChain,
      );
   }

   else if (decodedTransaction.kind === "fillCashout" || decodedTransaction.kind === "fillRfqCashout") {
      const data = decodedTransaction.data;
      let cashoutAccount: CashoutAccountData;
      let fetchedFromChain = true;
      try {
         cashoutAccount = await getCashoutData(client.rpc, ix.accounts[6]!);
      } catch {
         fetchedFromChain = false;
         cashoutAccount = {
            discriminator: 8,
            bump: 0,
            mm: ix.accounts[18]!,
            feepayer: ix.accounts[0]!,
            origOwner: userOwner,
            origBetId: data.origBetId,
            cashoutId: data.cashoutId,
            marketId: {
               eventId: {
                  sport: 0,
                  league: 0,
                  event: 0n,
               },
               mkt: 0,
               period: 0,
               player: 0n,
               isPregame: true,
               operator: SYSTEM_PROGRAM_ID,
            },
            side: 255,
            amount: data.amount,
            payout: data.minPayout,
            timestamp: blockTime,
            origEventStateSequence: data.eventStateSequence,
            origEventGameState: data.eventGameState,
            cashoutEventStateSequence: data.eventStateSequence,
            cashoutEventGameState: data.eventGameState,
            result: BetResult.Pending,
            numFillers: 0,
            fillers: [],
         };
      }
      addCashoutAccount(
         ix.accounts[6]!,
         cashoutAccount.origBetId,
         cashoutAccount.cashoutId,
         "single",
         cashoutAccount.amount,
         cashoutAccount.payout,
         [selectionFromMarketId(cashoutAccount.marketId, cashoutAccount.side, cashoutAccount.cashoutEventStateSequence, cashoutAccount.cashoutEventGameState)],
         [{ sequence: cashoutAccount.cashoutEventStateSequence, game_state: cashoutAccount.cashoutEventGameState }],
         cashoutAccount.mm,
         blockTime,
         meta,
         fetchedFromChain,
      );
      const escrow = await recordCashoutEscrowIfLive(ix.accounts[8]!, meta);
      const payment = escrow != null
         ? Number(escrow.payment)
         : tokenIncreaseForOwner(transactionMeta.rpcMeta, userOwner);
      applyOrigBetCashoutFill(
         ix.accounts[4]!,
         cashoutAccount.amount,
         cashoutAccount.payout,
         escrow != null,
         payment,
         meta,
      );
   }

   else if (decodedTransaction.kind === "fillParlayCashout" || decodedTransaction.kind === "fillRfqParlayCashout") {
      const data = decodedTransaction.data;
      let cashoutParlayAccount: CashoutParlayAccountData;
      let cashoutParlaySelections: Selection[];
      let fetchedFromChain = true;
      try {
         cashoutParlayAccount = await getCashoutParlayData(client.rpc, ix.accounts[6]!);
         cashoutParlaySelections = cashoutParlayAccount.legs.slice(0, cashoutParlayAccount.numLegs).map((leg) =>
            selectionFromMarketId(leg.marketId, leg.side, leg.cashoutEventStateSequence, leg.cashoutEventGameState, leg.oddsScaled));
      } catch {
         fetchedFromChain = false;
         cashoutParlayAccount = {
            discriminator: 9,
            bump: 0,
            mm: SYSTEM_PROGRAM_ID,
            feepayer: ix.accounts[0]!,
            origOwner: userOwner,
            origBetId: data.origBetId,
            cashoutId: data.cashoutId,
            amount: data.amount,
            payout: data.minPayout,
            timestamp: blockTime,
            result: BetResult.Pending,
            originalFillerAddress: SYSTEM_PROGRAM_ID,
            numLegs: data.numLegs,
            legs: [],
         };
         cashoutParlaySelections = data.snapshots.slice(0, data.numLegs).map((snapshot) =>
            selectionFromMarketId(
               {
                  eventId: { sport: 0, league: 0, event: 0n },
                  mkt: 0,
                  period: 0,
                  player: 0n,
                  isPregame: true,
                  operator: SYSTEM_PROGRAM_ID,
               },
               255,
               snapshot.eventStateSequence,
               snapshot.eventGameState,
            ));
      }
      addCashoutAccount(
         ix.accounts[6]!,
         cashoutParlayAccount.origBetId,
         cashoutParlayAccount.cashoutId,
         "parlay",
         cashoutParlayAccount.amount,
         cashoutParlayAccount.payout,
         cashoutParlaySelections,
         cashoutParlayAccount.legs.map(leg => ({ sequence: leg.cashoutEventStateSequence, game_state: leg.cashoutEventGameState })),
         cashoutParlayAccount.mm,
         blockTime,
         meta,
         fetchedFromChain,
      );
      const escrow = await recordCashoutEscrowIfLive(ix.accounts[8]!, meta);
      const payment = escrow != null
         ? Number(escrow.payment)
         : tokenIncreaseForOwner(transactionMeta.rpcMeta, userOwner);
      applyOrigBetCashoutFill(
         ix.accounts[4]!,
         cashoutParlayAccount.amount,
         cashoutParlayAccount.payout,
         escrow != null,
         payment,
         meta,
      );
   }

   else if (decodedTransaction.kind === "gradeBets") {
      const results = decodedTransaction.betResults;
      for (let i = 0; i < results.length; i++) {
         const ticketAddress = ix.accounts[2 + i]!;
         const resultByte = results[i]! as BetResult;
         updateBetOrCashoutAccountResult(ticketAddress, resultByte, blockTime, transactionMeta.signature, Number(transactionMeta.slot));
      }
   }

   else if (decodedTransaction.kind === "gradeParlay") {
      const parlayAddress = ix.accounts[2]!;
      const mask = decodedTransaction.legGradeMask;
      updateParlayOrCashoutAccountResult(parlayAddress, mask, Number(transactionMeta.slot), blockTime, transactionMeta.signature);
   }

   else if (decodedTransaction.kind === "settleBet" || decodedTransaction.kind === "settleFreebet") {
      const ticketAddress = ix.accounts[1]!;
      updateBetOrCashoutAccountSettled(ticketAddress, blockTime, transactionMeta.signature, Number(transactionMeta.slot));
   }

   else if (decodedTransaction.kind === "settleParlay" || decodedTransaction.kind === "settleFreebetParlay") {
      const ticketAddress = ix.accounts[1]!;
      updateBetOrCashoutAccountSettled(ticketAddress, blockTime, transactionMeta.signature, Number(transactionMeta.slot));
   }

   else if (decodedTransaction.kind === "claimCashoutEscrow") {
      const escrowAddress = ix.accounts[5]!;
      const originalBetAddress = ix.accounts[7]!;
      updateCashoutEscrowClaimed(escrowAddress, blockTime, transactionMeta.signature, Number(transactionMeta.slot));
      updateBetAccountCashedOut(
         originalBetAddress,
         blockTime,
         transactionMeta.signature,
         Number(transactionMeta.slot),
         escrowPaymentForAddress(escrowAddress),
      );
   }

   else if (decodedTransaction.kind === "revertCashout") {
      const escrowAddress = ix.accounts[8]!;
      const originalBetAddress = ix.accounts[4]!;
      const cashoutAddress = ix.accounts[6]!;
      updateCashoutEscrowReverted(escrowAddress, blockTime, transactionMeta.signature, Number(transactionMeta.slot));
      updateCashoutAccountReverted(cashoutAddress, blockTime, transactionMeta.signature, Number(transactionMeta.slot));
      revertBetCashout(originalBetAddress, Number(transactionMeta.slot));
   }
}

// runIndexer()
async function runIndexer() {
   let isIndexerRunInProgress = false;
   // Guard against overlapping runs: an interval tick must never start while a previous (potentially
   // long) run is still fetching/processing transactions.
   if (isIndexerRunInProgress) {
      console.log("Indexer run already in progress, skipping this tick.");
      return;
   }
   isIndexerRunInProgress = true;
   try {
      await runIndexerInner();
   } catch (error) {
      console.error("Indexer run failed:", error);
   } finally {
      isIndexerRunInProgress = false;
   }
}

async function runIndexerInner() {
   console.log("Running indexer...");
   const watermark = getIndexerWatermark();
   const latestSigs = getLatestUpdate();
   // Prefer the persisted watermark; fall back to the row-based resume point for legacy DBs.
   const latestSig = watermark?.sig ?? latestSigs.claimed ?? latestSigs.graded ?? latestSigs.created ?? null;
   console.log("Latest sig:", latestSig);
   const sigs = await getSigsSinceLatestSig(latestSig);
   console.log("Sigs:", sigs.length);
   let count = 0;
   for (const sig of sigs) {
      count++;
      console.log("Processing sig:", count, sig.signature);
      const transactionMeta = await getTransactionFromSig(sig);
      if (!transactionMeta.transaction) {
         if (transactionMeta.isTerminalMiss) {
            // Failed/missing on-chain transaction — advance the watermark past it permanently.
            setIndexerWatermark(sig.signature, Number(sig.slot));
         } else {
            // Transient RPC failure — leave the watermark so this sig is retried on the next run.
            console.log("Transient RPC failure fetching sig:", sig.signature, "- retrying next run.");
         }
         continue;
      }
      const blockTime = blockTimeSeconds(transactionMeta.blockTime);
      const parsedTxData = parseTxData(transactionMeta.transaction)
      for (const ix of parsedTxData) {
         try {
            await indexAggregatorInstruction(ix, transactionMeta, blockTime);
         } catch (error) {
            console.error("Error indexing instruction:", error, "sig:", transactionMeta.signature);
         }
      }
      // Advance the watermark after fully processing this transaction's instructions.
      setIndexerWatermark(sig.signature, Number(sig.slot));
   };
   console.log("Indexer finished");
}