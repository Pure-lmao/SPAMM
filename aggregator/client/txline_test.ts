//get tx line fixtures from txline api
//quote a market from DUMB mm
//bet it from user
//claim it from user on new settle instruction 

const JWT = "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3ODQzMDA1MDcsInNlc3Npb25JZCI6ImM1MGU0MzRiLWE1MmMtNDc2OS05NWNmLWEzNjNjYWE5YzMxZiIsInJvbGUiOiJndWVzdCIsIm1heWJlQ2xpZW50SXAiOiIxNS4xNTguNDQuMTc0In0.aUjPIT2M54yZZ2A_T4IWFjRCic-gOzWGQXvk32id4hI8znpVPaLBHPumQDImWHiO1-3UTWOW7r1eDzjNjCiuNg";
const subTx = "4jWCYXLMfyga4NxZi473kfSV6eVNjHAVg8NTFECetRP8oysfPohoVfsqPLu52xghVQNLJuLx45p51zQpWZvCUzaA";
const API_TOKEN = "txoracle_api_c1bdaa8dd05b49dfb205003f6c71b83f";
const TXLINE_BASE_URL = "https://txline-dev.txodds.com";

const POR_DRC = "17926703";
const ENG_CRO = "17588228";
const MEX_KOR = "17588223";

async function getAllFixtures() {
   const URL = `${TXLINE_BASE_URL}/api/fixtures/snapshot`;
   const response = await fetch(URL, {
      method: 'GET',
      headers: {
         'Accept-Encoding': 'gzip, deflate, br',
         'X-Api-Token': API_TOKEN,
         'Authorization': `Bearer ${JWT}`,
      },
   });
   if (!response.ok) {
      const text = await response.text();
      console.log('text', text);
      // const body = await response.json();
      // console.log('body', body);
      console.log('response', response);
      throw new Error(`fixtures snapshot ${response.status}: ${text}`);
   }
   const data = await response.json() as any[];
   return data.filter((fixture: any) => fixture.Participant1 == "Mexico");
}
// console.log(await getAllFixtures());

async function latestOdds(fixtureId: string) {
   const URL = `${TXLINE_BASE_URL}/api/odds/snapshot/${fixtureId}`;
   const response = await fetch(URL, {
      method: 'GET',
      headers: {
         'Accept-Encoding': 'gzip, deflate, br',
         'X-Api-Token': API_TOKEN,
         'Authorization': `Bearer ${JWT}`,
      },
   });
   if (!response.ok) {
      const text = await response.text();
      console.log('text', text);
      throw new Error(`latest odds ${response.status}: ${text}`);
   }
   const data = await response.json() as any;
   return data;
}
// console.log(await latestOdds(ENG_CRO));


async function getScore(fixtureId: string) {
   const URL = `${TXLINE_BASE_URL}/api/scores/historical/${fixtureId}`;
   const response = await fetch(URL, {
      method: 'GET',
      headers: {
         'Accept-Encoding': 'gzip, deflate, br',
         'X-Api-Token': API_TOKEN,
         'Authorization': `Bearer ${JWT}`,
      },
   });
   if (!response.ok) {
      const text = await response.text();
      console.log('text', text);
      throw new Error(`get score ${response.status}: ${text}`);
   }
   const data = await response.json() as any;
   return data;
}
// console.log((await getScore(MEX_KOR)));

async function getScoreUpdates(fixtureId: string) {
   const URL = `${TXLINE_BASE_URL}/api/scores/updates/${fixtureId}`;
   const response = await fetch(URL, {
      method: 'GET',
      headers: {
         'Accept-Encoding': 'gzip, deflate, br',
         'X-Api-Token': API_TOKEN,
         'Authorization': `Bearer ${JWT}`,
      },
   });
   if (!response.ok) {
      const text = await response.text();
      console.log('text', text);
      throw new Error(`get score updates ${response.status}: ${text}`);
   }
   return await response.json() as any[];
}

async function getScoreAt(fixtureId: string) {
   const data = await getScoreUpdates(fixtureId);
   // console.log('data', data);
   for (const item of data) {
      // console.log(item.Seq, item.Score?.Participant1?.Total, item.Score?.Participant2?.Total);
      if (item.Score?.Participant1?.Total > item.Score?.Participant2?.Total) {
         break
      }
      // if (item.Seq == 348){
      //    return [item.Seq, item.Score];
      // }
   }
   return [data.at(60).Seq, data.at(60).Score];
}
// getScoreAt(MEX_KOR).then(r => console.log(r[0], r[1])).catch(console.error);

/**
 * The score stays 0-0 from the start of the fixture until the first goal. This
 * returns the seq of the first score update where the score is no longer 0-0,
 * so the highest 0-0 seq to test is `firstNonZeroSeq - 1`.
 */
async function getFirstNonZeroSeq(fixtureId: string): Promise<number> {
   const data = await getScoreUpdates(fixtureId);
   for (const item of data) {
      const home = item.Score?.Participant1?.Total.Goals ?? 0;
      const away = item.Score?.Participant2?.Total.Goals ?? 0;
      if (home !== 0 || away !== 0) {
         console.log(item.Seq, data, home, away);
         return Number(item.Seq);
      }
   }
   // Never left 0-0; treat everything up to the last update as 0-0.
   return Number(data.at(-1).Seq) + 1;
}
// getFirstNonZeroSeq(MEX_KOR).then(r => console.log(r)).catch(console.error);

import {
   BetResult,
   BinaryExpression,
   getBetData,
   getEventGameState,
   getFillBetIx,
   getSettleWithTxLineIx,
   HOME_BEATS_AWAY_PREDICATE,
   HOME_EQUALS_AWAY_PREDICATE,
   HOME_NOT_BEATS_AWAY_PREDICATE,
   ODDS_SCALE,
   settleWithTxLineIxDataFromValidateStat,
   TXLINE_PROGRAM_ID_DEVNET,
   validateStatIxDataFromApiResponse,
   type EventId,
   type MarketId,
   type TraderPredicate,
} from "spamm-aggregator-sdk";

/**
 * Fetch a TxLINE score Merkle proof for a fixture at a given score sequence.
 *
 * `statKey` 1 = home goals, `statKey` 2 = away goals (per the txline stat keys).
 * Returns the raw `/api/scores/stat-validation` JSON that the SDK maps into the
 * `validate_stat` CPI payload.
 */
async function fetchStatValidation(fixtureId: string, seq: number, statKey: number, statKey2?: number) {
   let URL = `${TXLINE_BASE_URL}/api/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKey=${statKey}`;
   if (statKey2 != null) {
      URL += `&statKey2=${statKey2}`;
   }
   const response = await fetch(URL, {
      method: 'GET',
      headers: {
         'Accept-Encoding': 'gzip, deflate, br',
         'X-Api-Token': API_TOKEN,
         'Authorization': `Bearer ${JWT}`,
      },
   });
   if (!response.ok) {
      return false;
      const text = await response.text();
      console.log('text', text);
      throw new Error(`stat validation ${response.status}: ${text}`);
   }
   return await response.json() as any;
}

//===============MM SET UP===============

import { ADMIN_SIGNER } from "../../market_maker/client/admin"
import { MARKET_MAKER_PROGRAM_ID } from "../../market_maker/sdk/ts/src/constants"
import { getInitEventIx, getInitMarketIx, getUpdateEventStateIx, getUpdateOracleIx } from "../../market_maker/sdk/ts/src/instructions"
import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from "txSend";
import { getU32Encoder, type Address } from "@solana/kit";

const eventId: EventId = {sport: 1, league: 21900, event: BigInt(MEX_KOR)};
async function initEvent(eventId: EventId) {
   const initEventIx = await getInitEventIx(ADMIN_SIGNER.address, eventId, MARKET_MAKER_PROGRAM_ID);
   const txResult = await sendAndConfirmInstructions([
      initEventIx, 
   ], [ADMIN_SIGNER]);
   console.log(txResult);
}
// initEvent(eventId);

async function updateEventState( 
   eventId: EventId, sequence: number, 
   timePeriod: string, gameInfo: {
   homeScore?: number,
   awayScore?: number,
   homeReds?: number,
   awayReds?: number,
}) {
   const gameState = getEventGameState(
      timePeriod,
      gameInfo.homeScore ?? 0,
      gameInfo.awayScore ?? 0,
      gameInfo.homeReds ?? 0,
      gameInfo.awayReds ?? 0,
   );
   const eventStateIx = await getUpdateEventStateIx(
      ADMIN_SIGNER.address,
      MARKET_MAKER_PROGRAM_ID,
      eventId,
      sequence,
      gameState,
   );
   const txResult = await sendAndConfirmInstructions([eventStateIx], [ADMIN_SIGNER]);
   console.log(txResult);
}
// updateEventState(
//    eventId, 1, "PG", { homeScore: 0, awayScore: 0, homeReds: 0, awayReds: 0 }
// ).catch(console.error);

const marketId = {
   eventId,
   player: 0n,
   mkt: 1,
   period: 1,
   isPregame: true,
} as MarketId;
const oracleBody = new Uint8Array([
   ...getU32Encoder().encode(20n*ODDS_SCALE/10n), //odds0 = 2.0
   ...getU32Encoder().encode(19n*ODDS_SCALE/10n), //odds1 = 1.9
   ...getU32Encoder().encode(21n*ODDS_SCALE/10n), //odds2 = 2.1
]);
async function initMarket() {
   const marketDataIx = await getInitMarketIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, oracleBody);
   const txResult = await sendAndConfirmInstructions([marketDataIx], [ADMIN_SIGNER]);
   console.log(txResult);
}
// initMarket().catch(console.error);

async function updateOracle() {
   const sequence = 1n;
   const odds0 = 20n*ODDS_SCALE/10n;
   const odds1 = 20n*ODDS_SCALE/10n;
   const odds2 = 20n*ODDS_SCALE/10n;
   const marketDataIx = await getUpdateOracleIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, 
      marketId, sequence, odds0, odds1, odds2
   );
   const txResult = await sendAndConfirmInstructions([marketDataIx], [ADMIN_SIGNER]);
   console.log(txResult);
}
// updateOracle().catch(console.error);

//============ USER BET AND CLAIM ===============

import { USER_SIGNER } from "./user";
import { sleep } from "bun";

async function bet() {
   const betIx = await getFillBetIx({
      betId: 1n,
      marketId,
      side: 0,
      amount: 1n*10n**6n,
      minOddsScaled: (10n/10n)*10n**6n,
      eventStateSequence: 1,
      eventGameState: getEventGameState("PG", 0, 0, 0, 0),
   },
      USER_SIGNER.address,
      USER_SIGNER.address,
      [MARKET_MAKER_PROGRAM_ID],
   );
   const txResult = await sendAndConfirmInstructions([betIx], [USER_SIGNER]);
   console.log(txResult);
}
// bet().catch(console.error);
const clients = createRpcClients();
const betPda = "AB4CE7fMGKyYXeceCNwtQUA1hTY8u6jvvu3SrciqcmJo" as Address;
const betData = await getBetData(clients.rpc, betPda);
const expectedResult = BetResult.Won;
const predicate: TraderPredicate = HOME_EQUALS_AWAY_PREDICATE;
async function claim(seq: number) {


   // Score sequence to prove against (latest settled score update for the fixture).
   // const [seq] = await getScoreAt(MEX_KOR);
   // console.log(seq);
   // const seq = 1024;
   // const seq = 325;

   // Pull the proof parts from the txline API, then stick them together into the
   // `validate_stat` CPI payload via the SDK codecs (no hand-rolled byte fiddling).
   const validation = await fetchStatValidation(MEX_KOR, Number(seq), 1, 2);
   if (!validation) {
      console.log(`fetchStatValidation ${seq} failed`);
      return false;
   }
   const validateStat = validateStatIxDataFromApiResponse(validation, predicate, {
      statKey2: 2,
      op: BinaryExpression.Subtract,
   });
   const settleData = settleWithTxLineIxDataFromValidateStat(expectedResult, validateStat);

   const claimIx = await getSettleWithTxLineIx(
      USER_SIGNER.address,
      betPda,
      betData,
      settleData,
      TXLINE_PROGRAM_ID_DEVNET,
   );
   // Building/signing a v0 tx throws if it exceeds the size limit, so treat that
   // (the "tx too big" failure mode) the same way as a missing validation.
   try {
      const simResult = await simulateTransaction(clients.rpc, [claimIx], [USER_SIGNER], true);
      // return simResult;
   } catch (err) {
      console.log(`seq ${seq} tx build/sim threw:`, err instanceof Error ? err.message : err);
      return false;
   }
   const txResult = await sendAndConfirmInstructions([claimIx], [USER_SIGNER], true);
   console.log(txResult);
}
// claim(532).then(r => console.log(r)).catch(console.error);

/**
 * Walk the 0-0 score window from the latest 0-0 seq backwards toward earlier
 * seqs, looking for one where (a) the txline API has a validation and (b) the
 * resulting claim tx builds and simulates without error.
 */
async function findValid0to0Claim(maxTries = 1024) {
   const firstNonZeroSeq = 578//await getFirstNonZeroSeq(MEX_KOR);
   const upperSeq = firstNonZeroSeq - 1;
   console.log(`score leaves 0-0 at seq ${firstNonZeroSeq}; testing 0-0 seqs <= ${upperSeq}`);

   const lowerSeq = Math.max(1, upperSeq - maxTries + 1);
   for (let seq = upperSeq; seq >= lowerSeq; seq--) {
      console.log(`trying seq ${seq}...`);
      const result = await claim(seq);
      if (result && (result as any).err == null) {
         console.log(`found valid 0-0 validation + tx at seq ${seq}`);
         return { seq, result };
      }
      await sleep(1000);
   }
   console.log(`no valid 0-0 seq found in [${lowerSeq}, ${upperSeq}]`);
   return null;
}
// findValid0to0Claim().then(r => console.log(r)).catch(console.error);