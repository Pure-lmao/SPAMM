import { getDb } from "localDb";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder, type Address, type Base64EncodedDataResponse, type Commitment, type ReadonlyUint8Array, type Signature, type Slot, type TransactionError, type UnixTimestamp } from "@solana/kit";
import { AGGREGATOR_PROGRAM_ID, BetResult, decodeAggregatorInstructionData, getBetData, getParlayData, ODDS_SCALE, SYSTEM_PROGRAM_ID, type BetAccountData, type BetFiller, type MarketId, type ParlayBetAccountData, type ParlayLegWire } from "spamm-aggregator-sdk";
import { createRpcClients } from "../aggregator/client/txSend";
import { withRpcRetry } from "../market_maker/client/txSend";
const client = createRpcClients()

// initIndexerTable()
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
}

export type Selection = {
   sport_id: number;
   league_id: number;
   event_id: number;
   mkt_id: number;
   period_id: number;
   player_id: number;
   is_pregame: number;
   side: number;
}

export type BetRecord = {
   id: string;
   /** Stored as string in SQLite/API to avoid JSON number precision loss for large u64 bet ids. */
   bet_id: string;
   type: "single" | "parlay";
   user_address: string;
   selections: Selection[];
   amount_requested: number;
   amount_filled: number;
   min_odds_requested: number;
   payout: number;
   result: BetResult;
   created_at: number;
   created_sig: string;
   graded_at: number | null;
   graded_sig: string | null;
   claimed_at: number | null;
   claimed_sig: string | null;
   last_update_slot: number;
   status: BetRecordStatus;
}

type DbBetRow = Omit<BetRecord, "selections" | "bet_id"> & {
   bet_id: string;
   selections: string;
};

function selectionFromMarketId(marketId: MarketId, side: number): Selection {
   return {
      sport_id: marketId.eventId.sport,
      league_id: marketId.eventId.league,
      event_id: Number(marketId.eventId.event),
      mkt_id: marketId.mkt,
      period_id: marketId.period,
      player_id: Number(marketId.player),
      is_pregame: marketId.isPregame ? 1 : 0,
      side,
   };
}

function selectionFromParlayLeg(leg: ParlayLegWire): Selection {
   return selectionFromMarketId(leg.marketId, leg.side);
}

function parseSelectionsJson(raw: string): Selection[] {
   const parsed = JSON.parse(raw) as Selection[];
   if (!Array.isArray(parsed)) {
      throw new Error("selections must be a JSON array");
   }
   return parsed;
}

function rowToBetRecord(row: DbBetRow): BetRecord {
   return {
      ...row,
      bet_id: row.bet_id,
      selections: parseSelectionsJson(row.selections),
   };
}

function initIndexerTable(): void {
   const database = getDb();
   database.run(`DROP TABLE IF EXISTS bet_accounts`);
   database.run(`CREATE TABLE bet_accounts (
      id TEXT PRIMARY KEY,
      bet_id TEXT NOT NULL,
      type TEXT NOT NULL,
      user_address TEXT NOT NULL,
      selections TEXT NOT NULL,
      amount_requested INTEGER NOT NULL,
      amount_filled INTEGER NOT NULL,
      min_odds_requested INTEGER NOT NULL,
      payout INTEGER NOT NULL,
      result INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      created_sig TEXT NOT NULL,
      graded_at INTEGER,
      graded_sig TEXT,
      claimed_at INTEGER,
      claimed_sig TEXT,
      last_update_slot INTEGER NOT NULL,
      status TEXT NOT NULL
   )`);
};

type BetAccountAddMeta = {
   createdAt: number;
   createdSig: string;
   lastUpdateSlot: number;
};

function addBetAccount(
   betAddress: string,
   userAddress: Address,
   type: BetRecord["type"],
   betId: bigint,
   selections: Selection[],
   amountRequested: bigint,
   amountFilled: bigint,
   minOddsRequested: bigint,
   payout: bigint,
   meta: BetAccountAddMeta,
): void {
   const database = getDb();
   database.run(`INSERT INTO bet_accounts 
      (id, bet_id, type, user_address, selections, amount_requested, amount_filled, min_odds_requested, payout,
      result, created_at, created_sig, last_update_slot, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [
         betAddress, 
         betId.toString(), 
         type,
         userAddress,
         JSON.stringify(selections),
         Number(amountRequested), 
         Number(amountFilled), 
         Number(minOddsRequested),
         Number(payout),
         BetResult.Pending, 
         meta.createdAt,
         meta.createdSig,
         meta.lastUpdateSlot,
         BetRecordStatus.Pending
      ]
   );
};

function updateAccountResult(betAddress: string, result: BetResult, gradedAt: number, gradedSig: string, slot: number): void {
   const database = getDb();
   database.run(`UPDATE bet_accounts SET result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`, [result, gradedAt, gradedSig, BetRecordStatus.Graded, slot, betAddress]);
};

function updateAccountClaimed(betAddress: string, claimedAt: number, claimedSig: string, slot: number): void {
   const database = getDb();
   database.run(`UPDATE bet_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`, [claimedAt, claimedSig, BetRecordStatus.Claimed, slot, betAddress]);
};


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
};

// getSigsSinceLatestSig(null, null, null)
async function getSigsSinceLatestSig(latestSig: string | null): Promise<SigMeta[]> {
   const sigs = [];
   let isEnd = false;
   while (!isEnd) {
      const sigsRes = await client.rpc.getSignaturesForAddress(AGGREGATOR_PROGRAM_ID, {
         ...(latestSig ? { until: latestSig as Signature } : {}),
         commitment: "confirmed",
         limit: 1000,
      }).send();
      sigs.push(...sigsRes)
      if (sigsRes.length < 1000) {
         isEnd = true;
      }
   }
   //order oldest to newest
   const orderedSigs = sigs
      .filter((sig) => sig.slot > 462636165n) //last program update slot
      .sort((a, b) => Number(a.slot) - Number(b.slot));
   
   return orderedSigs;
}

async function getTransactionFromSig(sig: SigMeta): Promise<TransactionMeta> {
   try {
      const transaction = await withRpcRetry(() =>
         client.rpc.getTransaction(sig.signature, {
            commitment: "confirmed",
            encoding: "base64",
            maxSupportedTransactionVersion: 0,
         }).send(),
      );
      if (transaction && !transaction.meta?.err) {
         return {
            ...sig,
            transaction: transaction.transaction,
         };
      }
      return {
         ...sig,
         transaction: null,
      };
   } catch {
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
   const parsedIxs = [];
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
   }
   return parsedIxs;
}

function getBetRecords(): BetRecord[] {
   const database = getDb();
   const betAccounts = database.query<DbBetRow, string[]>(`SELECT * FROM bet_accounts`).all();
   return betAccounts
      .filter((row) => row.status !== BetRecordStatus.Pending)
      .map(rowToBetRecord);
}

export function getClosedBetRecordsByUser(userAddress: string): BetRecord[] {
   const database = getDb();
   const betAccounts = database.query<DbBetRow, string[]>(`SELECT * FROM bet_accounts WHERE user_address = ? AND status = ? ORDER BY created_at DESC`).all(userAddress, BetRecordStatus.Claimed);
   return betAccounts.map(rowToBetRecord);
}

const nullFiller: BetFiller = {
   mmAddress: SYSTEM_PROGRAM_ID,
   amount: 0n,
   oddsScaled: 0n,
   isPotentiallyNetted: false,
   encumbranceDelta: 0n,
}

// runIndexer()
async function runIndexer() {
   console.log("Running indexer...");
   const latestSigs = getLatestUpdate();
   console.log("Latest sig:", latestSigs);
   const sigs = await getSigsSinceLatestSig(latestSigs.created ?? latestSigs.graded ?? latestSigs.claimed ?? null);
   console.log("Sigs:", sigs.length);
   let count = 0;
   for (const sig of sigs) {
      count++;
      console.log("Processing sig:", count, sig.signature);
      const transactionMeta = await getTransactionFromSig(sig);
      if (!transactionMeta.transaction) {
         console.log("No transaction found for sig:", sig.signature);
         continue;
      }
      const parsedTxData = parseTxData(transactionMeta.transaction)
      for (const ix of parsedTxData) {
         let decodedTransaction;
         try {
            decodedTransaction = decodeAggregatorInstructionData(ix.data);
         } catch (error: any) {
            console.error("Error decoding transaction:", error);
            console.error("Data:", ix.data);
            continue;
         }
         const meta: BetAccountAddMeta = {
            createdAt: Number(transactionMeta.blockTime!),
            createdSig: transactionMeta.signature,
            lastUpdateSlot: Number(transactionMeta.slot),
         };
         if (decodedTransaction.kind === "fillBet") {
            let betAccount: BetAccountData;
            try {
               betAccount = await getBetData(client.rpc, ix.accounts[3]!);
            } catch (error: any) {
               betAccount = {
                  betId: decodedTransaction.data.betId,
                  discriminator: 0,
                  bump: 0,
                  owner: ix.accounts[1]!,
                  feepayer: ix.accounts[1]!,
                  marketId: decodedTransaction.data.marketId,
                  amount: decodedTransaction.data.amount,
                  payout: decodedTransaction.data.amount * decodedTransaction.data.minOddsScaled / ODDS_SCALE,
                  result: BetResult.Pending,
                  side: decodedTransaction.data.side,
                  eventStateSequence: decodedTransaction.data.eventStateSequence,
                  eventGameState: decodedTransaction.data.eventGameState,
                  filler0: nullFiller,
                  filler1: nullFiller,
                  filler2: nullFiller,
                  filler3: nullFiller,
                  filler4: nullFiller,
               }
            }
            addBetAccount(
               ix.accounts[3]!, 
               ix.accounts[1]!,
               "single",
               betAccount.betId,
               [selectionFromMarketId(betAccount.marketId, betAccount.side)],
               decodedTransaction.data.amount,
               betAccount.amount,
               decodedTransaction.data.minOddsScaled,
               betAccount.payout,
               meta,
            );
         } else if (decodedTransaction.kind === "fillParlay") {
            let parlayAccount: ParlayBetAccountData;
            try {
               parlayAccount = await getParlayData(client.rpc, ix.accounts[3]!);
            } catch (error: any) {
               parlayAccount = {
                  betId: decodedTransaction.data.betId,
                  discriminator: 0,
                  bump: 0,
                  owner: ix.accounts[1]!,
                  feepayer: ix.accounts[1]!,
                  amount: decodedTransaction.data.amount,
                  payout: decodedTransaction.data.amount * decodedTransaction.data.minOddsScaled / ODDS_SCALE,
                  result: BetResult.Pending,
                  fillerAddress: SYSTEM_PROGRAM_ID,
                  numLegs: decodedTransaction.data.numLegs,
                  legs: decodedTransaction.data.legs,
               };
            }
            const activeLegs = parlayAccount.legs.slice(0, parlayAccount.numLegs);
            addBetAccount(
               ix.accounts[3]!,
               ix.accounts[1]!,
               "parlay",
               parlayAccount.betId,
               activeLegs.map(selectionFromParlayLeg),
               decodedTransaction.data.amount,
               parlayAccount.amount,
               decodedTransaction.data.minOddsScaled,
               parlayAccount.payout,
               meta,
            );
         } else if (decodedTransaction.kind === "gradeBets") {
            const gradedCount = ix.accounts.length - 2;
            for (let i = 0; i < gradedCount; i++) {
               const betAddress = ix.accounts[2 + i]!;
               const result = decodedTransaction.betResults[i]!;
               updateAccountResult(betAddress, result, 
                  Number(transactionMeta.blockTime!), transactionMeta.signature, Number(transactionMeta.slot));
            }
         } else if (decodedTransaction.kind === "settleBet" || decodedTransaction.kind === "settleParlay") {
            const betAddress = ix.accounts[1]!;
            updateAccountClaimed(betAddress, 
               Number(transactionMeta.blockTime!), transactionMeta.signature, Number(transactionMeta.slot));
         }
      }
   };
   console.log("Indexer finished");
}
