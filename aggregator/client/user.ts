import { loadKeypairSignerFromJsonFile } from "utils";
import { createRpcClients, sendAndConfirmInstructions } from "./txSend.ts";
import { getBetData, getBetPda, getEventHash, getFillBetIx, getSettleBetIx, ODDS_SCALE, Sport } from "spamm-aggregator-sdk";
import type { Address } from "@solana/kit";
const clients = createRpcClients();


export const USER_SIGNER = await loadKeypairSignerFromJsonFile('./user_keypair.json');
const DumbMarketMaker = "DUMBu4faqgx9KJWKAp8xRzKMiHEcBUvuH7pMkvMneMTt" as Address;
const betId = 1n;
const sport = 1 as Sport;
const marketId = {
   eventId: {
      event: 1n,
      league: 1,
      sport,
   },
   mkt: 1,
   period: 1,
   isPregame: true,
   player: 0n,
};
async function placeBet() {
   const eventStateHash = await getEventHash(sport, "PG", {
      homeScore: 0,
      awayScore: 0,
      homeReds: 0,
      awayReds: 0,
   });
   const ix = await getFillBetIx(
      {
         betId,
         marketId,
         side: 0,
         amount: 5n * 10n ** 6n,
         minOddsScaled: 20n* ODDS_SCALE / 10n,
         eventStateSequence: 1,
         eventStateHash,
      },
      USER_SIGNER.address,
      USER_SIGNER.address,
      [DumbMarketMaker],
   );
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// placeBet().catch(console.error);

async function getBet() {
   const bet = await getBetData(clients.rpc, {
      user: USER_SIGNER.address,
      betId,
   });
   console.log(bet);
}
// getBet().catch(console.error);

async function settleBet() {
   const [betPda] = await getBetPda(USER_SIGNER.address, betId);
   const bet = await getBetData(clients.rpc, betPda);
   const ix = await getSettleBetIx(USER_SIGNER.address, betPda, bet);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// settleBet().catch(console.error);