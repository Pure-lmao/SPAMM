import { loadKeypairSignerFromJsonFile } from "utils";
import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from "./txSend.ts";
import { decodeMmReturnData, getBetData, getBetPda, getEventHash, getFillBetIx, getMmGetQuoteIx, getMmListData, getSettleBetIx, ODDS_SCALE, Sport } from "spamm-aggregator-sdk";
import type { Address } from "@solana/kit";
const clients = createRpcClients();


export const USER_SIGNER = await loadKeypairSignerFromJsonFile('./user_keypair.json');
const DumbMarketMaker = "DUMBu4faqgx9KJWKAp8xRzKMiHEcBUvuH7pMkvMneMTt" as Address;
const betId = 2n;
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
const side = 0;
const eventStateSequence = 1;
const eventStateHash = await getEventHash(sport, "PG", {
   homeScore: 0,
   awayScore: 0,
   homeReds: 0,
   awayReds: 0,
});
const amount = 5n * 10n ** 6n;
const minOddsScaled = 20n* ODDS_SCALE / 10n;
async function placeBet() {
   const ix = await getFillBetIx(
      {
         betId,
         marketId,
         side,
         amount,
         minOddsScaled,
         eventStateSequence,
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

async function placeBetWithBestMm() {
   const mmList = await getMmListData(clients.rpc);
   const mmPromises = mmList.mmProgramAddresses.map(async (mmProgramAddress: Address) => {
      const quoteIx = await getMmGetQuoteIx({
         marketId,
         side,
         amount,
         minOddsScaled,
         eventStateHash,
         eventStateSequence,
      }, mmProgramAddress, USER_SIGNER.address);

      const returnData = await simulateTransaction(clients.rpc, [quoteIx], [USER_SIGNER]);
      if (!returnData) {
         return undefined;
      }
      const parsedReturnData = decodeMmReturnData(Buffer.from(...returnData));
      if (parsedReturnData.maxAmount > 0n && parsedReturnData.oddsScaled > 0n) {
         return {
            mmProgramAddress,
            ...parsedReturnData,
         };
      }
   });
   const validMms = await Promise.all(mmPromises);

   // should do a smarter sort then just this to avoid filling high odds but not the full amount
   const validMmsSorted = validMms.filter((mm) => mm !== undefined).sort((a, b) => Number(a.maxAmount) - Number(b.maxAmount));
   const ix = await getFillBetIx(
      {
         betId,
         marketId,
         side,
         amount,
         minOddsScaled,
         eventStateSequence,
         eventStateHash,
      },
      USER_SIGNER.address,
      USER_SIGNER.address,
      validMmsSorted.slice(0, 5).map((mm) => mm.mmProgramAddress),
   );
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// placeBetWithBestMm().catch(console.error);

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