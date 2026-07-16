import { fetchAddressLookupTable } from "@solana-program/address-lookup-table";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import {
   address,
   addSignersToTransactionMessage,
   appendTransactionMessageInstructions,
   compileTransaction,
   compressTransactionMessageUsingAddressLookupTables,
   createNoopSigner,
   createSolanaRpc,
   createTransactionMessage,
   getBase64EncodedWireTransaction,
   pipe,
   setTransactionMessageFeePayerSigner,
   setTransactionMessageLifetimeUsingBlockhash,
   type Address,
   type Rpc,
   type SolanaRpcApi,
} from "@solana/kit";
import {
   BetResult,
   BinaryExpression,
   Comparison,
   HOME_BEATS_AWAY_PREDICATE,
   HOME_EQUALS_AWAY_PREDICATE,
   HOME_NOT_BEATS_AWAY_PREDICATE,
   LOOKUP_TABLE_ID,
   TXLINE_PROGRAM_ID_DEVNET,
   getBetData,
   getRequiredTxlinePeriod,
   getSettleWithTxLineIx,
   settleWithTxLineIxDataFromValidateStat,
   validateStatIxDataFromApiResponse,
   type BetAccountData,
   type SettleWithTxLineIxData,
   type TraderPredicate,
   type TxlineStatValidationApiResponse,
} from "spamm-aggregator-sdk";
import { getBetResult } from "./solana";
import { safeJSONStringify } from "./utils";

const TXLINE_BASE_URL = process.env.TXLINE_BASE_URL?.trim() ?? "https://txline-dev.txodds.com";
const TXLINE_JWT = process.env.JWT_devnet?.trim() ?? process.env.TXLINE_JWT?.trim();
const TXLINE_API_KEY = process.env.API_KEY_devnet?.trim() ?? process.env.TXLINE_API_KEY?.trim();
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL?.trim() ?? "https://api.devnet.solana.com";
export const SETTLE_WITH_TXLINE_COMPUTE_UNIT_LIMIT = 500_000;

type TxlineScoreEvent = {
   Seq: number;
   Action?: string;
   StatusId?: number;
   Score?: {
      Participant1?: { Total?: { Goals?: number } };
      Participant2?: { Total?: { Goals?: number } };
   };
   /** TxLINE stat keys: `1` = home goals, `2` = away goals. */
   Stats?: Record<string, number>;
};

export type SettleWithTxlineProofMeta = {
   fixtureId: string;
   seq: number;
   txlinePeriod: number;
   betPeriod: number;
   score: { home: number; away: number };
};

/** JSON-safe payload for the UI to build `settle_with_tx_line` locally. */
export type SettleWithTxlineBuildPayload = {
   expectedResult: BetResult.Won | BetResult.Lost;
   /** Base64-encoded TxLINE `validate_stat` anchor instruction (8-byte disc + Borsh). */
   validateStatIxData: string;
   computeUnitLimit: number;
   proof: SettleWithTxlineProofMeta;
};

export type SettleWithTxlineResponse = SettleWithTxlineBuildPayload | { error: string };

function txlineAuthHeaders(): Record<string, string> {
   if (!TXLINE_JWT || !TXLINE_API_KEY) {
      throw new Error("Missing TxLINE credentials (JWT_devnet / API_KEY_devnet)");
   }
   return {
      "Accept-Encoding": "gzip, deflate, br",
      Authorization: `Bearer ${TXLINE_JWT}`,
      "X-Api-Token": TXLINE_API_KEY,
   };
}

function bytesToBase64(bytes: Uint8Array): string {
   return Buffer.from(bytes).toString("base64");
}

function goalsFromValidation(validation: TxlineStatValidationApiResponse): { home: number; away: number } {
   const home = validation.statToProve.value;
   const away = validation.statToProve2?.value ?? 0;
   return { home, away };
}

function validationMatchesTxlinePeriod(
   validation: TxlineStatValidationApiResponse,
   txlinePeriod: number,
): boolean {
   if (validation.statToProve.period !== txlinePeriod) {
      return false;
   }
   if (validation.statToProve2 != null && validation.statToProve2.period !== txlinePeriod) {
      return false;
   }
   return true;
}

async function fetchTxlineSettlementProof(
   fixtureId: string,
   txlinePeriod: number,
   scoreEvent: TxlineScoreEvent,
): Promise<TxlineStatValidationApiResponse | null> {
   const validation = await fetchStatValidation(fixtureId, scoreEvent.Seq, txlinePeriod);
   if (!validation || !validationMatchesTxlinePeriod(validation, txlinePeriod)) {
      return null;
   }
   return validation;
}

async function fetchTxlineJson<T>(path: string, params?: Record<string, string | number>): Promise<T> {
   const url = new URL(`${TXLINE_BASE_URL}${path}`);
   if (params) {
      for (const [key, value] of Object.entries(params)) {
         url.searchParams.set(key, String(value));
      }
   }
   const response = await fetch(url, { headers: txlineAuthHeaders() });
   const contentType = response.headers.get("content-type") ?? "";
   const text = await response.text();
   if (!response.ok) {
      throw new Error(`TxLINE ${path} ${response.status}: ${text}`);
   }
   if (contentType.includes("text/event-stream") || text.startsWith("data:")) {
      throw new Error(
         `TxLINE ${path} returned SSE; use /api/scores/snapshot/{fixtureId} for JSON score history`,
      );
   }
   try {
      return JSON.parse(text) as T;
   } catch {
      throw new Error(`TxLINE ${path} returned non-JSON: ${text.slice(0, 200)}`);
   }
}

async function fetchScoreSnapshot(fixtureId: string): Promise<TxlineScoreEvent[]> {
   return fetchTxlineJson<TxlineScoreEvent[]>(`/api/scores/snapshot/${fixtureId}`);
}

async function fetchStatValidation(
   fixtureId: string,
   seq: number,
   txlinePeriod: number,
): Promise<TxlineStatValidationApiResponse | null> {
   const url = new URL(`${TXLINE_BASE_URL}/api/scores/stat-validation`);
   url.searchParams.set("fixtureId", fixtureId);
   url.searchParams.set("seq", String(seq));
   url.searchParams.set("statKey", "1");
   url.searchParams.set("statKey2", "2");
   url.searchParams.set("period", String(txlinePeriod));
   const response = await fetch(url, { headers: txlineAuthHeaders() });
   if (!response.ok) {
      return null;
   }
   return (await response.json()) as TxlineStatValidationApiResponse;
}

function settlePredicateFor1x2(
   side: number,
   expected: BetResult.Won | BetResult.Lost,
   home: number,
   away: number,
): TraderPredicate {
   if (side === 0) {
      return expected === BetResult.Won ? HOME_BEATS_AWAY_PREDICATE : HOME_NOT_BEATS_AWAY_PREDICATE;
   }
   if (side === 1) {
      if (expected === BetResult.Won) {
         return { threshold: 0, comparison: Comparison.LessThan };
      }
      return { threshold: -1, comparison: Comparison.GreaterThan };
   }
   if (side === 2) {
      if (expected === BetResult.Won) {
         return HOME_EQUALS_AWAY_PREDICATE;
      }
      if (home > away) {
         return HOME_BEATS_AWAY_PREDICATE;
      }
      if (away > home) {
         return { threshold: 0, comparison: Comparison.LessThan };
      }
      throw new Error("Draw bet cannot settle as lost when score is still a draw");
   }
   throw new Error(`Unsupported 1X2 side ${side}`);
}

function gradedResultForBet(bet: BetAccountData, home: number, away: number): BetResult.Won | BetResult.Lost {
   const result = getBetResult(
      bet.marketId.eventId.sport,
      bet.marketId.period,
      bet.marketId.mkt,
      bet.marketId.player,
      bet.side,
      home,
      away,
   );
   if (result === BetResult.Won || result === BetResult.Lost) {
      return result;
   }
   throw new Error(`Bet result ${result ?? "unknown"} is not supported for TxLINE settlement`);
}

function buildPayloadFromSettleData(
   settleData: SettleWithTxLineIxData,
   proof: SettleWithTxlineProofMeta,
): SettleWithTxlineBuildPayload {
   const { expectedResult } = settleData;
   if (expectedResult === BetResult.Pending) {
      throw new Error("expectedResult must not be Pending");
   }
   if (expectedResult !== BetResult.Won && expectedResult !== BetResult.Lost) {
      throw new Error(`expectedResult ${expectedResult} is not supported for TxLINE settlement`);
   }
   return {
      expectedResult,
      validateStatIxData: bytesToBase64(settleData.validateStatIxData),
      computeUnitLimit: SETTLE_WITH_TXLINE_COMPUTE_UNIT_LIMIT,
      proof,
   };
}

async function simulateSettleWithTxLine(
   rpc: Rpc<SolanaRpcApi>,
   signer: Address,
   betPda: Address,
   bet: BetAccountData,
   settleData: SettleWithTxLineIxData,
): Promise<void> {
   const settleIx = await getSettleWithTxLineIx(signer, betPda, bet, settleData, TXLINE_PROGRAM_ID_DEVNET);
   const computeBudgetIx = getSetComputeUnitLimitInstruction({
      units: SETTLE_WITH_TXLINE_COMPUTE_UNIT_LIMIT,
   });

   const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
   const feePayer = createNoopSigner(signer);
   let txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([computeBudgetIx, settleIx], m),
   );

   const {
      data: { addresses: lookupAddresses },
   } = await fetchAddressLookupTable(rpc, LOOKUP_TABLE_ID);
   txMessage = compressTransactionMessageUsingAddressLookupTables(txMessage, {
      [LOOKUP_TABLE_ID]: lookupAddresses,
   }) as typeof txMessage;

   const txMessageWithSigners = addSignersToTransactionMessage([feePayer], txMessage);
   const wire = getBase64EncodedWireTransaction(compileTransaction(txMessageWithSigners));
   const simulation = await rpc.simulateTransaction(wire, { encoding: "base64", sigVerify: false }).send();
   if (simulation.value.err) {
      throw new Error(`Simulation failed: ${safeJSONStringify(simulation.value.err)}`);
   }
}

async function resolveSettleWithTxLineBuildPayload(
   rpc: Rpc<SolanaRpcApi>,
   signer: Address,
   betPda: Address,
   bet: BetAccountData,
): Promise<SettleWithTxlineBuildPayload> {
   const fixtureId = bet.marketId.eventId.event.toString();
   const txlinePeriod = getRequiredTxlinePeriod(
      bet.marketId.period,
      bet.marketId.eventId.sport,
   );
   const scoreEvents = await fetchScoreSnapshot(fixtureId);
   if (scoreEvents.length === 0) {
      throw new Error(`No TxLINE score snapshot for fixture ${fixtureId}`);
   }

   const sortedScoreEvents = [...scoreEvents].sort((a, b) => b.Seq - a.Seq);
   let lastError: Error | null = null;
   let sawTxlinePeriodProof = false;

   for (const scoreEvent of sortedScoreEvents) {
      const validation = await fetchTxlineSettlementProof(fixtureId, txlinePeriod, scoreEvent);
      if (!validation) {
         continue;
      }
      sawTxlinePeriodProof = true;

      try {
         const { home, away } = goalsFromValidation(validation);
         const expectedResult = gradedResultForBet(bet, home, away);
         const predicate = settlePredicateFor1x2(bet.side, expectedResult, home, away);

         const validateStat = validateStatIxDataFromApiResponse(validation, predicate, {
            statKey2: 2,
            op: BinaryExpression.Subtract,
         });
         const settleData = settleWithTxLineIxDataFromValidateStat(expectedResult, validateStat);
         const proof: SettleWithTxlineProofMeta = {
            fixtureId,
            seq: scoreEvent.Seq,
            txlinePeriod,
            betPeriod: bet.marketId.period,
            score: { home, away },
         };

         await simulateSettleWithTxLine(rpc, signer, betPda, bet, settleData);
         return buildPayloadFromSettleData(settleData, proof);
      } catch (error) {
         const message = error instanceof Error ? error.message : String(error);
         if (message.startsWith("Simulation failed")) {
            const { home, away } = goalsFromValidation(validation);
            console.error("[settleWithTxline] simulation failed", {
               fixtureId,
               seq: scoreEvent.Seq,
               action: scoreEvent.Action,
               txlinePeriod,
               betPeriod: bet.marketId.period,
               proofPeriod: validation.statToProve.period,
               score: { home, away },
               betSide: bet.side,
               err: message,
            });
         }
         lastError = error instanceof Error ? error : new Error(message);
      }
   }

   if (!sawTxlinePeriodProof) {
      throw new Error(
         `No TxLINE period-${txlinePeriod} score proof for fixture ${fixtureId} (bet period ${bet.marketId.period})`,
      );
   }

   throw lastError ?? new Error(`No valid TxLINE settlement proof found for fixture ${fixtureId}`);
}

/**
 * Resolve TxLINE proofs and return JSON the UI uses to build `settle_with_tx_line` locally.
 */
export async function buildSettleWithTxlineTransaction(
   betPda: string,
   signer: string,
): Promise<SettleWithTxlineResponse> {
   try {
      const betPdaAddr = address(betPda);
      const signerAddr = address(signer);
      const rpc = createSolanaRpc(SOLANA_RPC_URL) as Rpc<SolanaRpcApi>;
      const bet = await getBetData(rpc, betPdaAddr);

      if (bet.result !== BetResult.Pending) {
         return { error: "Bet is not pending" };
      }
      if (bet.owner !== signerAddr) {
         return { error: "Signer must be the bet owner" };
      }

      const payload = await resolveSettleWithTxLineBuildPayload(rpc, signerAddr, betPdaAddr, bet);
      return payload;
   } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: message };
   }
}
