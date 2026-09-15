import { loadKeypairSignerFromJsonFile } from "./utils.ts";
import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from "./txSend.ts";
import { decodeMmReturnData, getBetData, getBetPda, getFillBetIx, getFillParlayIx, getMmGetQuoteIx, getMmListData, getParlayBetPda, getParlayData, getSettleBetIx, getSettleParlayIx, getEventGameState, ODDS_SCALE, Sport, getGetQuoteProxyIx, decodeProxyQuoteReturnData, getGetMarketQuotesProxyIx, decodeMarketQuotesProxyReturnData, numSidesForMkt, type MarketId, getGetParlayQuoteProxyIx, decodeProxyParlayQuoteReturnData, getFillCashoutIx, getGetCashoutQuoteProxyIx, decodeGetCashoutQuoteIxData, decodeProxyCashoutQuoteReturnData, getFreebetFillBetIx, RFQ_NETWORK_DEVNET, getFillRfqBetIx, getFillRfqParlayIx, getFillParlayCashoutIx } from "spamm-aggregator-sdk";
import type { Address, Base64EncodedDataResponse } from "@solana/kit";
import { getBase64Encoder } from "@solana/kit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signRfqBet, signRfqParlayBet } from "../../market_maker/client/admin.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clients = createRpcClients();


export const USER_SIGNER = await loadKeypairSignerFromJsonFile(
   path.join(__dirname, "user_devnet_keypair.json"),
);
export const ADMIN_SIGNER = await loadKeypairSignerFromJsonFile(
   path.join(__dirname, 'admin_devnet_keypair.json'),
);
const DumbMarketMaker = "DUMBu4faqgx9KJWKAp8xRzKMiHEcBUvuH7pMkvMneMTt" as Address;
const WCMarketMaker = "WCMM5EzCxZAEC3JhMa7zt3mTJ6jUGJCf7BB26Tw87jr" as Address;
const operator = "3z6QBMEUjJubCwbKUsMKFnKnf1twyc5bZ9gaWHNAn1nP" as Address;

const betId = 100004n;
const sport = 1 as Sport;
const marketId: MarketId = {
   eventId: {
      event: 1n,
      league: 1,
      sport,
   },
   mkt: 1,
   period: 1,
   isPregame: true,
   player: 0n,
   operator,
};
const marketId2: MarketId = {
   eventId: {
      event: 2n,
      league: 1,
      sport,
   },
   mkt: 1,
   period: 1,
   isPregame: true,
   player: 0n,
   operator,
};
const marketIdSame: MarketId = {
   eventId: {
      event: 2n,
      league: 1,
      sport,
   },
   mkt: 60,
   period: 1,
   isPregame: true,
   player: 0n,
   operator,
}

const side = 0;
const eventStateSequence = 1;
const eventGameState = getEventGameState("PG", 0, 0, 0, 0);
const legs = [
   {
      marketId: marketId2,
      side: 0,
      eventStateSequence,
      eventGameState,
      oddsScaled: 4n*ODDS_SCALE,
   },
   {
      marketId: marketIdSame,
      side: 0,
      eventStateSequence,
      eventGameState,
      oddsScaled: 0n*ODDS_SCALE,
   },
   {
      marketId: marketId,
      side: 1,
      eventStateSequence,
      eventGameState,
      oddsScaled: 2n*ODDS_SCALE,
   }
]
const amount = 10n * 10n ** 6n;
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
      true,
   );

   // const simResult = await simulateTransaction(clients.rpc, [ix], [USER_SIGNER]);
   // console.log(simResult);

   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// placeBet().catch(console.error);

async function getQuotesFromProxy() {
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
      throw new Error("No return data");
   }
   const parsedReturnData = decodeProxyQuoteReturnData(Buffer.from(...returnData));
   return parsedReturnData;
}
// getQuotesFromProxy().then(console.log).catch(console.error);

async function getQuote() {
   const quote = await getMmGetQuoteIx({
      marketId,
      side,
      amount,
      minOddsScaled,
      eventGameState,
      eventStateSequence,
   }, WCMarketMaker, USER_SIGNER.address);
   console.log(quote.accounts);
   const returnData = await simulateTransaction(clients.rpc, [quote], [USER_SIGNER]);
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
   const returnData = await simulateTransaction(clients.rpc, [marketQuotesProxyIx], [USER_SIGNER]);
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
   // console.log(parsedReturnData);
   const validMms = parsedReturnData
      .filter((mm) => mm.maxAmount > 0n && mm.oddsScaled > 0n)
      .sort((a, b) => Number(b.oddsScaled - a.oddsScaled) || Number(b.maxAmount - a.maxAmount));
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
      }, USER_SIGNER.address, USER_SIGNER.address, validMms.slice(0, 5).map((mm) => mm.mmAddress), false,
   );
   // console.log(ix.accounts);
   // const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   // console.log(txResult);
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

   // const simResult = await simulateTransaction(clients.rpc, [ix], [USER_SIGNER]);
   // console.log(simResult);

   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// placeParlayBet().catch(console.error);

async function getParlayQuote() {
   const mmList = await getMmListData(clients.rpc);
   const parlayQuoteProxyIx = await getGetParlayQuoteProxyIx({
      betId,
      amount,
      minOddsScaled,
      numLegs: legs.length,
      legs,
   }, USER_SIGNER.address, mmList.mmProgramAddresses);
   const returnData = await simulateTransaction(clients.rpc, [parlayQuoteProxyIx], [USER_SIGNER]);
   if (!returnData) {
      throw new Error("No return data");
   }
   const parsedReturnData = decodeProxyParlayQuoteReturnData(Buffer.from(...returnData));
   return parsedReturnData;
}
// getParlayQuote().then(console.log).catch(console.error);

async function getBet() {
   const bet = await getBetData(clients.rpc, {
      user: USER_SIGNER.address,
      betId: 100004n,
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
   const [betPda] = await getBetPda(USER_SIGNER.address, 100006n);
   const bet = await getBetData(clients.rpc, betPda);
   const ix = await getSettleBetIx(USER_SIGNER.address, betPda, bet);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// settleBet().catch(console.error);

async function settleParlay() {
   const [betPda] = await getParlayBetPda(USER_SIGNER.address, 100002n);
   const bet = await getParlayData(clients.rpc, betPda);
   const ix = await getSettleParlayIx(USER_SIGNER.address, betPda, bet);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// settleParlay().catch(console.error);

async function cashoutBet() {
   const betPda = await getBetData(clients.rpc, {
      user: USER_SIGNER.address,
      betId,
   });
   const ix = await getFillCashoutIx({
      origBetId: betId,
      cashoutId: 2n,
      amount,
      minPayout: 0n,
      eventGameState,
      eventStateSequence,
   }, USER_SIGNER.address, betPda, marketId, DumbMarketMaker, [DumbMarketMaker]);

   // const simResult = await simulateTransaction(clients.rpc, [ix], [USER_SIGNER]);
   // console.log(simResult);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// cashoutBet().catch(console.error);

async function getCashoutQuote() {
   const mmList = await getMmListData(clients.rpc);
   const cashoutQuoteProxyIx = await getGetCashoutQuoteProxyIx({
      origBetId: betId,
      cashoutId: 2n,
      amount,
      minPayout: 0n,
      eventGameState,
      eventStateSequence,
   }, USER_SIGNER.address, marketId, mmList.mmProgramAddresses);
   const returnData = await simulateTransaction(clients.rpc, [cashoutQuoteProxyIx], [USER_SIGNER]);
   if (!returnData) {
      throw new Error("No return data");
   }
   const parsedReturnData = decodeProxyCashoutQuoteReturnData(Buffer.from(...returnData));
   return parsedReturnData;
}
// getCashoutQuote().then(console.log).catch(console.error);

async function cashoutParlay() {
   const parlayPda = await getParlayData(clients.rpc, {
      user: USER_SIGNER.address,
      betId: 100006n,
   });
   const ix = await getFillParlayCashoutIx({
      origBetId: parlayPda.betId,
      cashoutId: 2n,
      amount: 10n*10n**6n,
      minPayout: 10n*10n**6n,
      numLegs: parlayPda.legs.length,
      snapshots: parlayPda.legs.map((l) => ({eventGameState, eventStateSequence})),
   }, USER_SIGNER.address, parlayPda, parlayPda.legs.map((l) => l.marketId), DumbMarketMaker);
   // const simResult = await simulateTransaction(clients.rpc, [ix], [USER_SIGNER]);
   // console.log(simResult);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// cashoutParlay().catch(console.error);

async function placeFreebet() {
   const ix = await getFreebetFillBetIx({
      betId: 100004n,
      marketId: marketId,
      side: 2,
      amount: 10n*10n**6n,
      minOddsScaled: 11n*ODDS_SCALE/10n,
      eventStateSequence,
      eventGameState,
   }, USER_SIGNER.address, USER_SIGNER.address, ADMIN_SIGNER.address, 1, [DumbMarketMaker], true);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// placeFreebet().catch(console.error);

async function placeRfqBet() {
   const signedRfq = await signRfqBet({
      networkDomain: RFQ_NETWORK_DEVNET,
      user: USER_SIGNER.address,
      betId: 100006n,
      marketId: marketId,
      eventGameState: eventGameState,
      eventStateSequence: eventStateSequence,
      side: 1,
      maxStake: amount,
      oddsScaled: minOddsScaled,
      offerExpiry: Math.floor(Date.now() / 1000) + 30,
      mmProgramId: DumbMarketMaker,
   })

   const ix = await getFillRfqBetIx({
      ...signedRfq.offer,
      amount: amount,
      signature: signedRfq.signature,
   }, USER_SIGNER.address, USER_SIGNER.address, DumbMarketMaker, true);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// placeRfqBet().catch(console.error);

async function placeRfqParlayBet() {
   const signedRfq = await signRfqParlayBet({
      networkDomain: RFQ_NETWORK_DEVNET,
      user: USER_SIGNER.address,
      betId: 100006n,
      maxStake: amount,
      oddsScaled: 8n*ODDS_SCALE,
      offerExpiry: Math.floor(Date.now() / 1000) + 30,
      mmProgramId: DumbMarketMaker,
      numLegs: legs.length,
      legs,
   })
   const ix = await getFillRfqParlayIx({
      ...signedRfq.offer,
      amount: amount,
      signature: signedRfq.signature,
   }, USER_SIGNER.address, USER_SIGNER.address, DumbMarketMaker);
   const txResult = await sendAndConfirmInstructions([ix], [USER_SIGNER]);
   console.log(txResult);
}
// placeRfqParlayBet().catch(console.error);