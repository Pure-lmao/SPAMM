import { join } from "node:path";
import { AccountRole, type Instruction } from "@solana/instructions";
import { address, getU32Encoder, getU64Encoder, sol, solToLamports, type Address } from "@solana/kit";
import { buildSignV0Transaction, createRpcClients, sendAndConfirmSignedTransaction } from "../aggregator/client/txSend";
import { loadKeypairSignerFromJsonFile } from "../aggregator/client/utils";

const SYSTEM_PROGRAM_ID: Address = address("11111111111111111111111111111111");

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

      const clients = createRpcClients({ httpUrl: process.env.SOLANA_RPC_URL });
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
