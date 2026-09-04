import { getAta, getCloseEventIx, getForceClosePdaIx, getInitEventIx, getInitMarketIx, getInitProgramIx, getEventGameState, getMmConfigData, getMmConfigPda, getMmMarketData, getMmQuoteBufferData, getMmReturnDataDecoder, getSetRfqSignerIx, getUpdateEventStateIx, getUpdateOracleIx, MARKET_MAKER_PROGRAM_ID, ODDS_SCALE, type EventId, type MarketId, type Sport, getMmQuoteBufferPda, getMmParlayQuoteBufferPda, getWithdrawFromTokenAccountIx } from 'spamm-market-maker-sdk';
import { getCloseNettingAccountIx, getCreateNettingAccountIx, getEventStateData, getMmEncumbranceData, getRegisterMmIx, getNettingAccountData, getMmGetQuoteIx, getAddLineToNettingAccountIx, getRemoveLineFromNettingAccountIx, getMmLiabilityAtaBalance, getWithdrawFromLiabilityAccountIx, getMmTokenAtaBalance, getEventStatePda } from 'spamm-aggregator-sdk';
import { loadKeypairSignerFromJsonFile } from './utils';
import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from './txSend.ts';
import { getU32Encoder, getU64Encoder, type Address } from '@solana/kit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ADMIN_SIGNER = await loadKeypairSignerFromJsonFile(
   path.join(__dirname, 'admin_keypair.json'),
);
const clients = createRpcClients();


async function initProgram() {
   const ix = await getInitProgramIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// initProgram().catch(console.error);

async function withdrawFromTokenAccount() {
   const ix = await getWithdrawFromTokenAccountIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, 
      "5ahzN9xmBBEyFfMxEUw4X6X6FYGDPfQPq8BSqCSKcULm" as Address);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// withdrawFromTokenAccount().catch(console.error);

async function registerMM() {
   const ix = await getRegisterMmIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// registerMM().catch(console.error);

// getMmEncumbranceData(clients.rpc, MARKET_MAKER_PROGRAM_ID).then(console.log).catch(console.error);
// getMmConfigData(clients.rpc, MARKET_MAKER_PROGRAM_ID).then(console.log).catch(console.error);

const sport = 1 as Sport;
const league = 1;
const event = 1n;
const eventId = {
   sport,
   league,
   event,
} as EventId;
async function initEvent() {
   const eventStateIx = await getInitEventIx(ADMIN_SIGNER.address, eventId, MARKET_MAKER_PROGRAM_ID);
   const nettingPdaIx = await getCreateNettingAccountIx(eventId, ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID);
   const txResult = await sendAndConfirmInstructions([
      eventStateIx, 
      nettingPdaIx
   ], [ADMIN_SIGNER]);
   console.log(txResult);
}
// initEvent().catch(console.error);
// getEventStateData(clients.rpc, MARKET_MAKER_PROGRAM_ID, eventId).then(console.log).catch(console.error);

// getNettingAccountData(clients.rpc, MARKET_MAKER_PROGRAM_ID, eventId).then(console.log).catch(console.error);
async function addLineToNettingAccount() {
   const ix = await getAddLineToNettingAccountIx(
      eventId,
      1, 4, 
      ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, 
   );
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// addLineToNettingAccount().catch(console.error);

async function removeLineFromNettingAccount() {
   const ix = await getRemoveLineFromNettingAccountIx(
      eventId,
      1, 4, 
      ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, 
   );
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// removeLineFromNettingAccount().catch(console.error);

async function closeNettingAccount() {
   const ix = await getCloseNettingAccountIx(eventId, ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// closeNettingAccount().catch(console.error);

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

async function closeEvent() {
   const closeEventIx = await getCloseEventIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, eventId);
   const closeNettingPdaIx = await getCloseNettingAccountIx(eventId, ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID);
   const txResult = await sendAndConfirmInstructions([
      closeEventIx, 
      closeNettingPdaIx
   ], [ADMIN_SIGNER]);
   console.log(txResult);
}
// closeEvent().catch(console.error);

const period = 1;
const mkt = 1;
const player = 0n;
const marketId = {
   eventId,
   player,
   mkt,
   period,
   isPregame: true,
   operator: "BqQKZKbnYMpmQEtoCjvaDVTdhfpbaCQuBiSngNKu6YQW" as Address,
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
   const sequence = 2n;
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
// getMmMarketData(clients.rpc, MARKET_MAKER_PROGRAM_ID, marketId).then(console.log).catch(console.error);

const returnDataDecoder = getMmReturnDataDecoder();
async function getQuote() {
   const quote = await getMmGetQuoteIx(
      {
         amount: 1n * 10n * 6n,
         minOddsScaled: 20n*ODDS_SCALE/10n,
         side: 0,
         eventGameState: getEventGameState("PG", 0, 0, 0, 0),
         eventStateSequence: 1,
         marketId,
      },
      MARKET_MAKER_PROGRAM_ID,
      ADMIN_SIGNER.address,
   );
   const returnData = await simulateTransaction(clients.rpc, [quote], [ADMIN_SIGNER]);
   if (!returnData) {
      throw new Error("No return data");
   }
   const [b64] = returnData;
   const bin = atob(b64);
   const bytes = new Uint8Array(bin.length);
   for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
   }
   const parsedReturnData = returnDataDecoder.decode(bytes);
   console.log(parsedReturnData);
}
// getQuote().catch(console.error);

// getMmQuoteBufferData(clients.rpc, MARKET_MAKER_PROGRAM_ID).then(console.log).catch(console.error);

async function withdrawFreeBalance() {
   const balance = await getMmLiabilityAtaBalance(clients.rpc, MARKET_MAKER_PROGRAM_ID);
   const encumbrance = await getMmEncumbranceData(clients.rpc, MARKET_MAKER_PROGRAM_ID);
   const withdrawAmount = balance - encumbrance.encumbrance;
   const withdrawIx = await getWithdrawFromLiabilityAccountIx(withdrawAmount, ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID);
   const txResult = await sendAndConfirmInstructions([withdrawIx], [ADMIN_SIGNER]);
   console.log(txResult);
}
// withdrawFreeBalance().catch(console.error);

// getMmTokenAtaBalance(clients.rpc, MARKET_MAKER_PROGRAM_ID).then(console.log).catch(console.error);

async function forceClosePda(pda: Address) {
   const ix = await getForceClosePdaIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, pda);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// forceClosePda(
//    (await getMmConfigPda(MARKET_MAKER_PROGRAM_ID))[0]
// ).catch(console.error);

async function setRfqSigner(rfqSigner: Address) {
   const ix = await getSetRfqSignerIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, rfqSigner);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   const updated = await getMmConfigData(clients.rpc, MARKET_MAKER_PROGRAM_ID);
   console.log('config after set_rfq_signer:', updated);
   return txResult;
}

const RFQ_SIGNER = '95Zg5Wp4RWgUWghjkrGNReXVuNWU6tU9y26tkqnsPBgF' as Address;
// setRfqSigner(RFQ_SIGNER).catch(console.error);

