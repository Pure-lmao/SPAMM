import { getMmConfigPda, getMmParlayQuoteBufferPda, getMmQuoteBufferPda } from "spamm-aggregator-sdk";
import { getForceClosePdaIx, MARKET_MAKER_PROGRAM_ID } from "spamm-market-maker-sdk";
import { createSolanaRpc, type Address } from "@solana/kit";
import type { Instruction } from "@solana/instructions";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRpcClients, logSolanaError, sendAndConfirmInstructionGroups, withRpcRetry } from "../../aggregator/client/txSendV1";
import { loadKeypairSignerFromJsonFile } from "../client/utils";

// Force-closes every account owned by the MM program (event state + market data PDAs),
// returning rent to the admin. The config PDA and quote buffers are always kept.
//
//   bun closeAllPdas.ts            # dry run: count what would be closed
//   bun closeAllPdas.ts --execute  # send the close transactions
//
// Alchemy's free tier rejects getProgramAccounts, so listing uses SOLANA_SCAN_RPC_URL
// (default: public devnet) while transactions go through SOLANA_RPC_URL.

const KEYPAIR_PATH = path.join(
   path.dirname(fileURLToPath(import.meta.url)),
   "../client/admin_keypair.json",
);
const SCAN_RPC_URL = process.env.SOLANA_SCAN_RPC_URL ?? "https://api.devnet.solana.com";
const CHUNK_SIZE = 500;
const DRY_RUN_PREVIEW = 20;
const LAMPORTS_PER_SOL = 1_000_000_000n;

async function main() {
   const execute = process.argv.includes("--execute");
   const adminSigner = await loadKeypairSignerFromJsonFile(KEYPAIR_PATH);
   const clients = createRpcClients({
      httpUrl: process.env.SOLANA_RPC_URL,
      wsUrl: process.env.SOLANA_WS_URL,
   });

   const keep = new Set<Address>([
      (await getMmConfigPda(MARKET_MAKER_PROGRAM_ID))[0],
      (await getMmQuoteBufferPda(MARKET_MAKER_PROGRAM_ID))[0],
      (await getMmParlayQuoteBufferPda(MARKET_MAKER_PROGRAM_ID))[0],
   ]);

   const scanRpc = createSolanaRpc(SCAN_RPC_URL);
   const accounts = await withRpcRetry(() =>
      scanRpc.getProgramAccounts(MARKET_MAKER_PROGRAM_ID, {
         encoding: "base64",
         dataSlice: { offset: 0, length: 0 },
      }).send(),
   );
   const toClose = accounts.filter(({ pubkey }) => !keep.has(pubkey));
   const totalLamports = toClose.reduce((sum, { account }) => sum + BigInt(account.lamports), 0n);

   console.log(`Scan RPC: ${SCAN_RPC_URL}`);
   console.log(`Send RPC: ${clients.httpUrl}`);
   console.log(`MM program: ${MARKET_MAKER_PROGRAM_ID}`);
   console.log(`Admin: ${adminSigner.address}`);
   console.log(`Program-owned accounts: ${accounts.length} (keeping ${accounts.length - toClose.length})`);
   console.log(`To close: ${toClose.length}, reclaiming ${Number(totalLamports) / Number(LAMPORTS_PER_SOL)} SOL`);

   if (!execute) {
      for (const { pubkey } of toClose.slice(0, DRY_RUN_PREVIEW)) {
         console.log(`  ${pubkey}`);
      }
      if (toClose.length > DRY_RUN_PREVIEW) {
         console.log(`  ... and ${toClose.length - DRY_RUN_PREVIEW} more`);
      }
      console.log("Dry run. Re-run with --execute to close these accounts.");
      return;
   }

   let closed = 0;
   let failed = 0;
   for (let i = 0; i < toClose.length; i += CHUNK_SIZE) {
      const chunk = toClose.slice(i, i + CHUNK_SIZE);
      const ixs: Instruction[][] = [];
      for (const { pubkey } of chunk) {
         ixs.push([await getForceClosePdaIx(adminSigner.address, MARKET_MAKER_PROGRAM_ID, pubkey)]);
      }
      try {
         const signatures = await sendAndConfirmInstructionGroups(clients, ixs, [adminSigner], {
            maxInstructionsPerTransaction: 64,
         });
         closed += chunk.length;
         console.log(`Closed ${closed}/${toClose.length} (${signatures.length} txs)`);
      } catch (error) {
         failed += chunk.length;
         logSolanaError(`Failed to close chunk starting at ${i}:`, error);
      }
   }
   console.log(`Done. Closed ${closed}, failed ${failed}. Re-run to retry anything left open.`);
}

if (import.meta.main) {
   main().catch((error) => {
      logSolanaError("closeAllPdas failed:", error);
      process.exit(1);
   });
}
