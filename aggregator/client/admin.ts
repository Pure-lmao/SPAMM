import { getBetPda, getChangeConfigStatusIx, getEventHash, getForceClosePdaIx, getGradeBetsIx, getInitProgramIx, getParlayBetPda, getWriteArbitraryDataIx } from "spamm-aggregator-sdk";
import { loadKeypairSignerFromJsonFile } from "utils";
import { sendAndConfirmInstructions } from "./txSend.ts"
import type { Address } from "@solana/kit";
import { USER_SIGNER } from "user.ts";


const ADMIN_SIGNER = await loadKeypairSignerFromJsonFile('./admin_keypair.json');

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
gradeBets([
   (await getParlayBetPda(USER_SIGNER.address, 10n))[0],
   (await getParlayBetPda(USER_SIGNER.address, 11n))[0],
], new Uint8Array([1, 2])).catch(console.error);


async function forceClosePda(pda: Address) {
   const ix = await getForceClosePdaIx(ADMIN_SIGNER.address, pda);
   const txResult = await sendAndConfirmInstructions([ix], [ADMIN_SIGNER]);
   console.log(txResult);
}
// const [parlayPda] = await getParlayBetPda(USER_SIGNER.address, 2n);
// forceClosePda(parlayPda).catch(console.error);

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