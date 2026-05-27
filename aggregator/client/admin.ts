import { decodeAggregatorInstructionData, decodeMmAccountConfig, getBetPda, getBetsData, getChangeConfigStatusIx, getConfigPda, getDeregisterMmIx, getForceClosePdaIx, getGradeBetsIx, getInitProgramIx, getMmAccountConfigDecoder, getMmConfigPda, getMmEncumbranceData, getMmListData, getMmListPda, getNettingPda, getParlayBetPda, getParlaysData, getRecentSlot, getSettleBetIx, getSettleParlayIx, getWriteArbitraryDataIx, readAccountDataRaw } from "spamm-aggregator-sdk";
import { loadKeypairSignerFromJsonFile } from "./utils.ts";
import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from "./txSend.ts";
import type { Address } from "@solana/kit";
import { USER_SIGNER } from "./user.ts";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clients = createRpcClients();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ADMIN_SIGNER = await loadKeypairSignerFromJsonFile(
   path.join(__dirname, 'admin_keypair.json'),
);

async function initProgram() {
   const clients = createRpcClients();
   const currentSlot = await getRecentSlot(clients.rpc);
   const recentSlot = currentSlot - 5n;
   const ix = await getInitProgramIx(ADMIN_SIGNER.address, recentSlot);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// initProgram().catch(console.error);

async function changeConfigStatus() {
   const ix = await getChangeConfigStatusIx(ADMIN_SIGNER.address, 1);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// changeConfigStatus().catch(console.error);

async function gradeBets(bets: Address[], results: Uint8Array) {
   const ix = await getGradeBetsIx(ADMIN_SIGNER.address, results, bets);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// gradeBets([
//    (await getParlayBetPda(USER_SIGNER.address, 10n))[0],
//    (await getParlayBetPda(USER_SIGNER.address, 11n))[0],
// ], new Uint8Array([1, 2])).catch(console.error);

async function deregisterMm(mm: Address) {
   const allBets = await getBetsData(clients.rpc);
   const openBets = [];
   for (const bet of allBets) {
      if (bet.data.filler0.mmAddress === mm
         || bet.data.filler1.mmAddress === mm 
         || bet.data.filler2.mmAddress === mm
         || bet.data.filler3.mmAddress === mm
         || bet.data.filler4.mmAddress === mm) {
         console.log(bet.data.betId, bet.data.result);
         openBets.push(bet);
      }
   }
   const instructions = [];
   for (const bet of openBets) {
      const ix = await getSettleBetIx(ADMIN_SIGNER.address, bet.address, bet.data);
      instructions.push(ix);
   }

   const IXS_PER_TX = 6;
   for (let i = 0; i < instructions.length; i += IXS_PER_TX) {
      const txInstructions = instructions.slice(i, i + IXS_PER_TX);
      // const simResult = await simulateTransaction(clients.rpc, txInstructions, [ADMIN_SIGNER], true);
      // console.log(simResult);
      const txResult = await sendAndConfirmInstructions(txInstructions, [ADMIN_SIGNER], true);
      console.log(txResult);
   }

   const allParlays = await getParlaysData(clients.rpc);
   const openParlays = [];
   for (const parlay of allParlays) {
      if (parlay.data.fillerAddress === mm) {
         console.log(parlay.data.betId, parlay.data.result);
         openParlays.push(parlay);
      }
   }
   console.log(openParlays.length);
   const instructions2 = [];
   let liabilityAmount = 0n;
   for (const parlay of openParlays) {
      const ix = await getSettleParlayIx(ADMIN_SIGNER.address, parlay.address, parlay.data);
      instructions2.push(ix);
      liabilityAmount += (parlay.data.payout - parlay.data.amount);
   }
   console.log(liabilityAmount);
   const IXS_PER_TX2 = 6;
   for (let i = 0; i < instructions2.length; i += IXS_PER_TX2) {
      const txInstructions = instructions2.slice(i, i + IXS_PER_TX2);
      // const simResult = await simulateTransaction(clients.rpc, txInstructions, [ADMIN_SIGNER], true);
      // console.log(simResult);
      const txResult = await sendAndConfirmInstructions(txInstructions, [ADMIN_SIGNER], true);
      console.log(txResult);
   }


   const [mmConfigPda] = await getMmConfigPda(mm);
   const mmConfigRaw = await readAccountDataRaw(clients.rpc, mmConfigPda);
   if (mmConfigRaw === null) {
      throw new Error('MM config account not found');
   }
   const mmConfig = decodeMmAccountConfig(mmConfigRaw);
   const ix = await getDeregisterMmIx(ADMIN_SIGNER.address, mmConfig.admin, mm);
   // const simResult = await simulateTransaction(clients.rpc, [ix], [ADMIN_SIGNER]);
   // console.log(simResult);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// deregisterMm("DUMBu4faqgx9KJWKAp8xRzKMiHEcBUvuH7pMkvMneMTt" as Address).catch(console.error);

async function forceClosePda(pda: Address) {
   const ix = await getForceClosePdaIx(ADMIN_SIGNER.address, pda);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
const [pda] = await getConfigPda();
// forceClosePda(pda).catch(console.error);

async function writeArbitraryData(
   account: Address,
   data: Uint8Array,
) {
   const ix = await getWriteArbitraryDataIx(ADMIN_SIGNER.address, account, data);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// writeArbitraryData("CpmHPq7wwEpFibQ6LcFmuwhgNayonyDbne8jRwMGumP7" as Address, 
//    new Uint8Array([4, 255, 0, 0, 0, 0, 0, 0, 0, 0])).catch(console.error);

// getMmListData(clients.rpc).then(console.log).catch(console.error);

// getBetsData(clients.rpc).then(bets => {
//    console.log(bets.length);
//    for (const bet of bets) {
//       console.log(bet.data.owner);
//    }
// }).catch(console.error);
