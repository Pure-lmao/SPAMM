import { loadKeypairSignerFromJsonFile } from "./utils.ts";
import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from "./txSend.ts";
import { decodeMmReturnData, getBetData, getBetPda, getFillBetIx, getFillParlayIx, getMmGetQuoteIx, getMmListData, getParlayBetPda, getParlayData, getSettleBetIx, getSettleParlayIx, getEventGameState, LOOKUP_TABLE_ID, ODDS_SCALE, Sport, getGetQuoteProxyIx, decodeProxyQuoteReturnData, getGetMarketQuotesProxyIx, decodeMarketQuotesProxyReturnData, numSidesForMkt } from "spamm-aggregator-sdk";
import type { Address } from "@solana/kit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clients = createRpcClients();


export const USER_SIGNER = await loadKeypairSignerFromJsonFile(
   path.join(__dirname, "user_devnet_keypair.json"),
);
const DumbMarketMaker = "DUMBu4faqgx9KJWKAp8xRzKMiHEcBUvuH7pMkvMneMTt" as Address;
const WCMarketMaker = "WCMM5EzCxZAEC3JhMa7zt3mTJ6jUGJCf7BB26Tw87jr" as Address;

const betId = 10n;
const sport = 1 as Sport;
const marketId = {
   eventId: {
      event: BigInt(17588223),
      league: 21900,
      sport,
   },
   mkt: 1,
   period: 1,
   isPregame: true,
   player: 0n,
};
const marketId2 = {
   eventId: {
      event: 2n,
      league: 1,
      sport,
   },
   mkt: 1,
   period: 1,
   isPregame: true,
   player: 0n,
};

const side = 2;
const eventStateSequence = 1;
const eventGameState = getEventGameState("PG", 0, 0, 0, 0);
const legs = [
   {
      marketId: marketId,
      side: 0,
      eventStateSequence,
      eventGameState,
   },
   {
      marketId: marketId2,
      side: 0,
      eventStateSequence,
      eventGameState,
   },
]
const amount = 5n * 10n ** 6n;
const minOddsScaled = 11n* ODDS_SCALE / 10n;
async function placeBet() {
   const ix = await getFillBetIx(
      {
         betId,
         marketId,
         side,
         amount,
         minOddsScaled,
         eventStateSequence,
         eventGameState,
      },
      USER_SIGNER.address,
      USER_SIGNER.address,
      [DumbMarketMaker],
   );

   const simResult = await simulateTransaction(clients.rpc, [ix], [USER_SIGNER], false);
   console.log(simResult);

   // const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER], addressesByLookupTable);
   // console.log(txResult);
}
// placeBet().catch(console.error);

async function getQuotesFromProxy() {
   const mmList = await getMmListData(clients.rpc);
   console.log(mmList.mmProgramAddresses);
   const quoteProxyIx = await getGetQuoteProxyIx(
      {
         betId,
         marketId,
         side,
         amount,
         minOddsScaled,
         eventGameState,
         eventStateSequence,
      },
      USER_SIGNER.address,
      mmList.mmProgramAddresses,
   )

   const returnData = await simulateTransaction(clients.rpc, [quoteProxyIx], [USER_SIGNER], true);
   if (!returnData) {
      throw new Error("No return data");
   }
   const parsedReturnData = decodeProxyQuoteReturnData(Buffer.from(...returnData));
   return parsedReturnData;
}
getQuotesFromProxy().then(console.log).catch(console.error);

async function getQuote() {
   const quote = await getMmGetQuoteIx({
      marketId,
      side,
      amount,
      minOddsScaled,
      eventGameState,
      eventStateSequence,
   }, DumbMarketMaker, USER_SIGNER.address);
   console.log(quote.accounts);
   const returnData = await simulateTransaction(clients.rpc, [quote], [USER_SIGNER], true);
   if (!returnData) {
      throw new Error("No return data");
   }
   const parsedReturnData = decodeMmReturnData(Buffer.from(...returnData));
   console.log(parsedReturnData);
}
// getQuote().catch(console.error);

async function getMarketQuotesFromProxy() {
   const mmList = await getMmListData(clients.rpc);
   const marketQuotesProxyIx = await getGetMarketQuotesProxyIx(
      {
         betId,
         marketId,
         side,
         amount,
         minOddsScaled,
         eventGameState,
         eventStateSequence,
      },
      USER_SIGNER.address,
      mmList.mmProgramAddresses,
   );
   const returnData = await simulateTransaction(clients.rpc, [marketQuotesProxyIx], [USER_SIGNER], true);
   if (!returnData) {
      throw new Error("No return data");
   }
   const parsedReturnData = decodeMarketQuotesProxyReturnData(Buffer.from(...returnData), numSidesForMkt(marketId.mkt)!);
   return parsedReturnData;
}
// getMarketQuotesFromProxy().then(console.log).catch(console.error);

async function placeBetWithBestMm() {
   const mmList = await getMmListData(clients.rpc);
   const quoteProxyIx = await getGetQuoteProxyIx(
      {
         betId,
         marketId,
         side,
         amount,
         minOddsScaled,
         eventGameState,
         eventStateSequence,
      },
      USER_SIGNER.address,
      mmList.mmProgramAddresses,
   )

   const returnData = await simulateTransaction(clients.rpc, [quoteProxyIx], [USER_SIGNER]);
   if (!returnData) {
      return undefined;
   }
   const parsedReturnData = decodeProxyQuoteReturnData(Buffer.from(...returnData));

   const validMms = parsedReturnData.filter((mm) => mm.maxAmount > 0n && mm.oddsScaled > 0n).sort((a, b) => Number(a.maxAmount) - Number(b.maxAmount));
   if (validMms.length === 0) {
      throw new Error("No valid MMs found");
   }
   const ix = await getFillBetIx(
      {
         betId,
         marketId,
         side,
         amount,
         minOddsScaled,
         eventStateSequence,
         eventGameState,
      }, USER_SIGNER.address, USER_SIGNER.address, validMms.slice(0, 5).map((mm) => mm.mmAddress),
   );
   // console.log(ix.accounts);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// placeBetWithBestMm().catch(console.error);

async function placeParlayBet() {
   const ix = await getFillParlayIx(
      {
         betId,
         amount,
         minOddsScaled,
         numLegs: legs.length,
         legs,
      },
      USER_SIGNER.address,
      USER_SIGNER.address,
      DumbMarketMaker,
   );

   // const simResult = await simulateTransaction(clients.rpc, [ix], [USER_SIGNER], false);
   // console.log(simResult);

   // const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   // console.log(txResult);
}
// placeParlayBet().catch(console.error);

async function getBet() {
   const bet = await getBetData(clients.rpc, {
      user: USER_SIGNER.address,
      betId,
   });
   console.log(bet);
}
// getBet().catch(console.error);

async function getParlayBet() {
   const parlayBet = await getParlayData(clients.rpc, {
      user: USER_SIGNER.address,
      betId,
   });
   console.log(parlayBet);
}
// getParlayBet().catch(console.error);

async function settleBet() {
   const [betPda] = await getBetPda(USER_SIGNER.address, betId);
   const bet = await getBetData(clients.rpc, betPda);
   const ix = await getSettleBetIx(USER_SIGNER.address, betPda, bet);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// settleBet().catch(console.error);

async function settleParlay() {
   const [betPda] = await getParlayBetPda(USER_SIGNER.address, betId);
   const bet = await getParlayData(clients.rpc, betPda);
   const ix = await getSettleParlayIx(USER_SIGNER.address, betPda, bet);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// settleParlay().catch(console.error);