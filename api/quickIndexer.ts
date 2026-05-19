import { getDb } from "localDb";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder, SolanaError, type Address, type Base64EncodedDataResponse, type Commitment, type ReadonlyUint8Array, type Signature, type Slot, type Transaction, type TransactionError, type UnixTimestamp } from "@solana/kit";
import { AGGREGATOR_PROGRAM_ID, BetResult, decodeAggregatorInstructionData, getBetData, ODDS_SCALE, SYSTEM_PROGRAM_ID, type BetAccountData, type BetFiller, type FillBetIxData, type MarketId } from "spamm-aggregator-sdk";
import { createRpcClients } from "../aggregator/client/txSend";
import { sleep } from "bun";
const client = createRpcClients()

// initIndexerTable()
// console.log(getBetRecords());

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

export type BetRecord = {
   id: string;
   bet_id: number;
   user_address: string;
   sport_id: number;
   league_id: number;
   event_id: number;
   mkt_id: number;
   period_id: number;
   player_id: number;
   is_pregame: number;
   side: number;
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

function initIndexerTable(): void {
   const database = getDb();
   database.run(`DROP TABLE IF EXISTS bet_accounts`);
   database.run(`CREATE TABLE bet_accounts (
      id TEXT PRIMARY KEY,
      bet_id TEXT NOT NULL,
      user_address TEXT NOT NULL,
      sport_id INTEGER NOT NULL,
      league_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      mkt_id INTEGER NOT NULL,
      period_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      is_pregame BOOLEAN NOT NULL,
      side INTEGER NOT NULL,
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

function addBetAccount(betAddress: string, userAddress: Address, ixData: FillBetIxData, betAccount: BetAccountData, meta: BetAccountAddMeta): void {
   const database = getDb();
   database.run(`INSERT INTO bet_accounts 
      (id, bet_id, user_address, sport_id, league_id, event_id, mkt_id, period_id, player_id, is_pregame, side, 
      amount_requested, amount_filled, min_odds_requested, payout,
      result, created_at, created_sig, last_update_slot, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [
         betAddress, 
         betAccount.betId.toString(), 
         userAddress,
         betAccount.marketId.eventId.sport, 
         betAccount.marketId.eventId.league, 
         betAccount.marketId.eventId.event,
         betAccount.marketId.mkt,
         betAccount.marketId.period,
         betAccount.marketId.player,
         betAccount.marketId.isPregame,
         betAccount.side, 
         ixData.amount, 
         betAccount.amount, 
         ixData.minOddsScaled,
         betAccount.payout,
         BetResult.Pending, 
         meta.createdAt,
         meta.createdSig,
         meta.lastUpdateSlot,
         BetRecordStatus.Pending
      ]
   );
};

function updateBetAccountResult(betAddress: string, result: BetResult, gradedAt: number, gradedSig: string, slot: number): void {
   const database = getDb();
   database.run(`UPDATE bet_accounts SET result = ?, graded_at = ?, graded_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`, [result, gradedAt, gradedSig, BetRecordStatus.Graded, slot, betAddress]);
};

function updateBetAccountClaimed(betAddress: string, claimedAt: number, claimedSig: string, slot: number): void {
   const database = getDb();
   database.run(`UPDATE bet_accounts SET claimed_at = ?, claimed_sig = ?, status = ?, last_update_slot = ? WHERE id = ?`, [claimedAt, claimedSig, BetRecordStatus.Claimed, slot, betAddress]);
};

function getLatestUpdate(): [string | null, string | null, string | null] {
   const database = getDb();
   const bet = database.query<{ created_sig: string, graded_sig: string, claimed_sig: string }, string[]>(`SELECT created_sig, graded_sig, claimed_sig FROM bet_accounts ORDER BY last_update_slot DESC LIMIT 1`).get();
   if (!bet) {
      return [null, null, null];
   }
   return [bet.created_sig, bet.graded_sig, bet.claimed_sig];
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
async function getSigsSinceLatestSig(createdSig: string | null, gradedSig: string | null, claimedSig: string | null): Promise<SigMeta[]> {
   const latestSig = claimedSig ?? gradedSig ?? createdSig;
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

async function getTransactionFromSig(sig: SigMeta, attempts: number = 0): Promise<TransactionMeta> {
   if (attempts > 3) {
      return {
         ...sig,
         transaction: null,
      };
   }
   try {
      const transaction = await client.rpc.getTransaction(sig.signature, {
         commitment: "confirmed",
         encoding: "base64",
         maxSupportedTransactionVersion: 0
      }).send();
      if (transaction && !transaction.meta?.err) {
         return {
            ...sig,
            transaction: transaction.transaction,
         };
      } else {
         return {
            ...sig,
            transaction: null,
         };
      }
   } catch (error: any) {
      if (error.statusCode === 429) {
         await sleep(1000);
         return await getTransactionFromSig(sig, attempts + 1);
      }
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
   const betAccounts = database.query<BetRecord, string[]>(`SELECT * FROM bet_accounts`).all();
   return betAccounts.filter((betAccount) => betAccount.status !== BetRecordStatus.Pending);
}

export function getClosedBetRecordsByUser(userAddress: string): BetRecord[] {
   const database = getDb();
   const betAccounts = database.query<BetRecord, string[]>(`SELECT * FROM bet_accounts WHERE user_address = ? AND status = ? ORDER By created_at DESC`).all(userAddress, BetRecordStatus.Claimed);
   return betAccounts;
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
   const latestSig = getLatestUpdate();
   console.log("Latest sig:", latestSig);
   const sigs = await getSigsSinceLatestSig(latestSig[0], latestSig[1], latestSig[2]);
   console.log("Sigs:", sigs.length);
   console.log(...sigs.map((sig) => sig.signature));
   for (const sig of sigs) {
      const transactionMeta = await getTransactionFromSig(sig);
      if (!transactionMeta.transaction) {
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
         if (decodedTransaction.kind === "fillBet") {
            let betAccount: BetAccountData;
            try {
               betAccount = await getBetData(client.rpc, ix.accounts[3]!);
            } catch (error: any) {
               // console.error("Error getting bet data:", error);
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
               decodedTransaction.data,
               betAccount,
               {
                  createdAt: Number(transactionMeta.blockTime!),
                  createdSig: transactionMeta.signature,
                  lastUpdateSlot: Number(transactionMeta.slot),
               }
            )
         } else if (decodedTransaction.kind === "gradeBets") {
            const gradedCount = ix.accounts.length - 2;
            for (let i = 0; i < gradedCount; i++) {
               const betAddress = ix.accounts[2 + i]!;
               const result = decodedTransaction.betResults[i]!;
               updateBetAccountResult(betAddress, result, 
                  Number(transactionMeta.blockTime!), transactionMeta.signature, Number(transactionMeta.slot));
            }
         } else if (decodedTransaction.kind === "settleBet") {
            const betAddress = ix.accounts[1]!;
            updateBetAccountClaimed(betAddress, 
               Number(transactionMeta.blockTime!), transactionMeta.signature, Number(transactionMeta.slot));
         }
      }
   };
   console.log("Indexer finished");
}