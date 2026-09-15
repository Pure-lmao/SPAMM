import { AGGREGATOR_PROGRAM_ID, BetResult, CONFIG_PDA, decodeAggregatorInstructionData, decodeMmAccountConfig, getBetPda, getBetsData, getCashoutData, getCashoutParlaysData, getCashoutsData, getChangeConfigStatusIx, getConfigPda, getDeregisterMmIx, getForceClosePdaIx, getFreebetFillBetIx, getGradeBetsIx, getGradeParlayIx, getInitFreebetIssuerIx, getInitProgramIx, getIssueFreebetIx, getMmAccountConfigDecoder, getMmConfigPda, getMmEncumbranceData, getMmListData, getMmListPda, getNettingPda, getParlayBetPda, getParlaysData, getSettleBetIx, getSettleParlayIx, getWriteArbitraryDataIx, ODDS_SCALE, readAccountDataRaw, type IssueFreebetIxData } from "spamm-aggregator-sdk";
import { loadKeypairSignerFromJsonFile } from "./utils.ts";
import { createRpcClients, sendAndConfirmInstructions, simulateTransaction } from "./txSend.ts";
import type { Address, Instruction } from "@solana/kit";
import { USER_SIGNER } from "./user.ts";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clients = createRpcClients();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ADMIN_SIGNER = await loadKeypairSignerFromJsonFile(
   path.join(__dirname, 'admin_devnet_keypair.json'),
);

async function initProgram() {
   const ix = await getInitProgramIx(ADMIN_SIGNER.address);
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
//    (await getBetPda(USER_SIGNER.address, 100006n))[0],
// ], new Uint8Array([BetResult.Lost])).catch(console.error);

async function gradeParlay(parlayPda: Address, legGradeMask: Uint8Array) {
   const ix = await getGradeParlayIx(ADMIN_SIGNER.address, legGradeMask, parlayPda);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// gradeParlay(
//    (await getParlayBetPda(USER_SIGNER.address, 100002n))[0],
//    new Uint8Array([255, BetResult.Won]),
// ).catch(console.error);

async function deregisterMm(mm: Address) {
   const allBets = await getBetsData(clients.rpc);
   const openBets = [];
   for (const bet of allBets) {
      if (bet.data.fillers.some((f) => f.mmAddress === mm)) {
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
      const txResult = await sendAndConfirmInstructions(txInstructions, [ADMIN_SIGNER]);
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
      const txResult = await sendAndConfirmInstructions(txInstructions, [ADMIN_SIGNER]);
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
// const [pda] = await getConfigPda();
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

// getBetsData(clients.rpc).then(async bets => {
//    console.log(bets.length);
//    const settleIxs = [];
//    for (const bet of bets) {
//       console.log(bet.data.owner);
//       console.log(bet.data.result);
//       if (bet.data.result != 0) {
//          const ix = await getSettleBetIx(ADMIN_SIGNER.address, bet.address, bet.data);
//          settleIxs.push(ix);
//       }
//    }
//    // const response = await sendAndConfirmInstructions(settleIxs, [ADMIN_SIGNER]);
//    // console.log(response);
// }).catch(console.error);

// const allParlays = await getParlaysData(clients.rpc);
// allParlays.forEach(parlay => {
//    console.log(parlay.data);
//    console.log(parlay.data.legs[0]);
//    console.log(parlay.data.legs[1]);
// });

// getAllAccounts().catch(console.error);
async function getAllAccounts() {
   const allAccounts = await clients.rpc.getProgramAccounts(AGGREGATOR_PROGRAM_ID, {commitment: 'confirmed', encoding: 'base64'}).send();
   console.log(allAccounts.length);
   const ixs: Instruction[] = [];
   for(const account of allAccounts) {
      const ix = await getForceClosePdaIx(ADMIN_SIGNER.address, account.pubkey);
      ixs.push(ix);
   }
   const ixsPerTx = 20;
   for(let i = 0; i < ixs.length; i += ixsPerTx) {
      const txIxs = ixs.slice(i, i + ixsPerTx);
      const txResult = await sendAndConfirmInstructions(txIxs, [ADMIN_SIGNER]);
      console.log(txResult);
   }
}

async function initFreebetIssuer() {
   const ix = await getInitFreebetIssuerIx(ADMIN_SIGNER.address);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// initFreebetIssuer().catch(console.error);

async function issueFreebet(user: Address, freebet: IssueFreebetIxData) {
   const { freebetId, expiry, amount, minOddsScaled, maxOddsScaled, minLegs, allowedMms, allowedOperators } = freebet;
   const ix = await getIssueFreebetIx(ADMIN_SIGNER.address, user, { freebetId, expiry, amount, minOddsScaled, maxOddsScaled, minLegs, allowedMms, allowedOperators });
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// issueFreebet("7WPLMihTFitMujMCiintKSnxBL51vQeTZPSvXpejnPCP" as Address, {
//    freebetId: 10003,
//    expiry: Math.floor(Date.now() / 1000) + 60*60*24*5,
//    amount: 5n*10n**6n,
//    minOddsScaled: 20n*ODDS_SCALE/10n,
//    maxOddsScaled: 100n*ODDS_SCALE,
//    minLegs: 2,
//    allowedMms: [],
//    allowedOperators: [],
// }).catch(console.error);

async function getBets() {
   const bets = await getBetsData(clients.rpc);
   console.log(bets.length);
   for(const bet of bets) {
      console.log(bet.data);
   }
}
// getBets().catch(console.error);

async function getParlays() {
   const parlays = await getParlaysData(clients.rpc);
   console.log(parlays.length);
   for(const parlay of parlays) {
      console.log(parlay.data);
   }
}
// getParlays().catch(console.error);

async function getCashoutAccounts() {
   const cashoutAccounts = await getCashoutsData(clients.rpc);
   console.log(cashoutAccounts.length);
   for(const cashoutAccount of cashoutAccounts) {
      console.log(cashoutAccount.data);
   }
}
// getCashoutAccounts().catch(console.error);

async function getCashoutParlays() {
   const cashoutParlays = await getCashoutParlaysData(clients.rpc);
   console.log(cashoutParlays.length);
   for(const cashoutParlay of cashoutParlays) {
      console.log(cashoutParlay.data);
   }
}
// getCashoutParlays().catch(console.error);