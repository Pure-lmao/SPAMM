import { join } from "node:path";
import { AccountRole, type Instruction } from "@solana/instructions";
import { address, getU32Encoder, getU64Encoder, sol, solToLamports, type Address } from "@solana/kit";
import { buildSignV0Transaction, createRpcClients, sendAndConfirmInstructions, sendAndConfirmSignedTransaction, simulateTransaction } from "../aggregator/client/txSend";
import { loadKeypairSignerFromJsonFile } from "../aggregator/client/utils";
import { fetchGradedStartedEvents, fetchUngradedStartedEvents } from "localDb";
import { BetResult, getBetsData, getGradeBetsIx, type BetAccountData } from "spamm-aggregator-sdk";
import type { Event } from "types";
import { round } from "utils";
import { ADMIN_SIGNER } from "../aggregator/client/admin";

const SYSTEM_PROGRAM_ID: Address = address("11111111111111111111111111111111");
const clients = createRpcClients({ httpUrl: process.env.SOLANA_RPC_URL });

/** System program: `Transfer` (instruction index 2) + `lamports` u64 LE. */
function buildSystemTransferSolInstruction(from: Address, to: Address, lamports: bigint): Instruction {
   const data = new Uint8Array(12);
   data.set(getU32Encoder().encode(2), 0);
   data.set(getU64Encoder().encode(lamports), 4);
   return {
      programAddress: SYSTEM_PROGRAM_ID,
      accounts: [
         { address: from, role: AccountRole.WRITABLE_SIGNER },
         { address: to, role: AccountRole.WRITABLE },
      ],
      data,
   };
}

const keypairPath = join(import.meta.dir, "sol_donor_keypair.json");
const SOL_DONOR_SIGNER = await loadKeypairSignerFromJsonFile(keypairPath);
const SOL_AMOUNT = solToLamports(sol("0.05"));

export async function airdropUser(user: string): Promise<{ success: boolean; error?: string }> {
   try {
      const userAddress = address(user);
      const donorAddress = SOL_DONOR_SIGNER.address;
      const ix = buildSystemTransferSolInstruction(donorAddress, userAddress, SOL_AMOUNT);

      const signed = await buildSignV0Transaction(clients.rpc, {
         feePayer: SOL_DONOR_SIGNER,
         instructions: [ix],
         signers: [SOL_DONOR_SIGNER],
         useALT: false,
      });
      await sendAndConfirmSignedTransaction(clients, signed, { commitment: "confirmed" });
      return { success: true };
   } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
   }
}

// gradeBets().catch(console.error);
export async function gradeBets() {
   console.log("Grading bets");
   const bets = await getBetsData(clients.rpc, {
      result: BetResult.Pending
   });
   console.log("Bets fetched", bets.length);
   const allEvents = fetchGradedStartedEvents();
   console.log("Events fetched", allEvents.size);

   const resultAddresses = [];
   for (const bet of bets) {
      const event = allEvents.get(`${bet.data.marketId.eventId.sport}:${bet.data.marketId.eventId.league}:${bet.data.marketId.eventId.event}`);
      if (event) {
         const result = getBetResult(bet.data, event);
         if (result) {
            resultAddresses.push([result, bet.address]);
         }
      }
   }

   const MAX_RESULTS_PER_TX = 25;
   if (resultAddresses.length > 0) {
      for (let i = 0; i < resultAddresses.length; i += MAX_RESULTS_PER_TX) {
         const results = resultAddresses.slice(i, i + MAX_RESULTS_PER_TX);
         const u8Results = results.map(result => result[0] as number);
         const addresses = results.map(result => result[1] as Address);
         const ix = await getGradeBetsIx(ADMIN_SIGNER.address, new Uint8Array(u8Results), addresses);
         await simulateTransaction(clients.rpc, [ix], [ADMIN_SIGNER]);
         const sig = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
         console.log(`Grade bets tx: ${sig}`);
      }
   }
   console.log("Bets graded");
}

function getBetResult(bet: BetAccountData, event: Event): BetResult | null {
   const period = bet.marketId.period;
   const sport = bet.marketId.eventId.sport;
   const mkt = bet.marketId.mkt;
   const player = bet.marketId.player;
   const side = bet.side;
   const home = event.home_score;
   const away = event.away_score;

   //invalid bet
   if (
      (player !== 0n) || //no player props
      (sport === 0) || //invalid sport
      (sport === 1) && (period !== 1) || //invalid soccer period
      (sport !== 1) && (period !== 0) //invalid non-soccer period
   ) {
      return null;
   };

   if (home === null || away === null) {
      return null;
   };
   const total = home + away;
   const homeDom = home - away;

   if (sport === 1) {
      if (mkt === 1) { //1X2
         if (side === 0) { //home win
            if (home > away) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else if (side === 1) { //away win
            if (away > home) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else if (side === 2) { //draw
            if (home === away) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else {
            return null;
         }
      }

      if (mkt === 4) { //btts
         if (side === 0) { //btts yes
            if (home > 0 && away > 0) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else if (side === 1) { //btts no
            if (home === 0 || away === 0) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else {
            return null;
         }
      }

      if (mkt > 50 && mkt < 100) { //ou (x.25)
         let line = mkt - 50;
         line = line / 4;
         line = round(line, 2);
         if (total === line) { //push on x.0
            return BetResult.Push;
         }
         if (side === 0) { //over
           if (total + 0.25 === line) { //half lost on x.25
               return BetResult.HalfLost;
            } else if (total - 0.25 === line) { //half won on x.75
               return BetResult.HalfWon;
            } else if (total > line) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else if (side === 1) { //under
            if (total + 0.25 === line) { //half won on x.25
               return BetResult.HalfWon;
            } else if (total - 0.25 === line) { //half lost on x.75
               return BetResult.HalfLost;
            } else if (total < line) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else {
            return null;
         }
      }

      if (mkt > 300 && mkt < 500) { //ah (x.25)
         let line = mkt - 400;
         line = line / 4;
         line = round(line, 2);
         if (homeDom === -line) { //push on x.0
            return BetResult.Push;
         }
         if (side === 0) { //home
            if (homeDom + 0.25 === -line) { //half lost on x.25
               return BetResult.HalfLost;
            } else if (homeDom - 0.25 === -line) { //half won on x.75
               return BetResult.HalfWon;
            } else if (homeDom > -line) { // home covers
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else if (side === 1) { //away
           if (homeDom + 0.25 === -line) { //half won on x.25
               return BetResult.HalfWon;
            } else if (homeDom - 0.25 === -line) { //half lost on x.75
               return BetResult.HalfLost;
            } else if (homeDom < -line) { // away covers
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else {
            return null;
         }
      }
   } else {
      if (mkt === 0) { // ML
         if (home === away) {
            return null;
         }
         if (side === 0) { //home
            if (home > away) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else if (side === 1) { //away
            if (away > home) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else {
            return null;
         }
      }

      if (mkt > 100 && mkt < 300) { //spread (x.5)
         let line = mkt - 200;
         line = line / 2;
         line = round(line, 1);
         if (homeDom === -line) { //push on x.0
            return BetResult.Push;
         }
         if (side === 0) { //home
            if (homeDom > -line) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else if (side === 1) { //away
            if (homeDom < -line) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else {
            return null;
         }
      }

      if (mkt > 1000 && mkt < 2000) { //ou (x.5)
         let line = mkt - 1000;
         line = line / 2;
         line = round(line, 1);
         if (total === line) { //push on x.0
            return BetResult.Push;
         }
         if (side === 0) { //over
            if (total > line) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else if (side === 1) { //under
            if (total < line) {
               return BetResult.Won;
            } else {
               return BetResult.Lost;
            }
         } else {
            return null;
         }
      }
   }

   return null;
}