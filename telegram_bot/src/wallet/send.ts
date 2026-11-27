import type { Address, Instruction, Signature } from "@solana/kit";
import { attachSigner, broadcast, compileUserTx, decodeWire, errorText, previewSponsor } from "../chain/rpc";
import { debug } from "../debug";
import { feePayerFor, requestSolFreeSignature, solFreeAddress } from "./solFree";
import { signerFor, type BotWallet } from "./privy";

async function sponsoredMessage(feePayer: Address, instructions: readonly Instruction[]): Promise<string> {
   const preview = await previewSponsor(feePayer, instructions);
   debug("solfree message", preview.message);
   if (preview.err == null) {
      return preview.message;
   }
   console.error("[solfree] message", preview.message);
   console.error("[solfree] simulation", preview.err);
   if (preview.logs != null && preview.logs.length > 0) {
      console.error("[solfree] logs\n" + preview.logs.join("\n"));
   }
   throw new Error(`Transaction simulation failed: ${errorText(preview.err)}`);
}

export async function sendInstructions(
   wallet: BotWallet,
   instructions: readonly Instruction[],
   options?: { sponsor?: boolean | "always" },
): Promise<Signature> {
   const signer = signerFor(wallet);
   const sponsor = options?.sponsor !== false;
   const feePayer = options?.sponsor === "always"
      ? await solFreeAddress()
      : sponsor ? await feePayerFor(wallet.address) : wallet.address;
   debug("send", {
      wallet: wallet.address,
      feePayer,
      sponsored: feePayer !== wallet.address,
      instructions: instructions.map((ix) => ix.programAddress),
   });
   const signed = feePayer === wallet.address
      ? await attachSigner(signer, await compileUserTx(feePayer, instructions))
      : await attachSigner(signer, await decodeWire(await requestSolFreeSignature(await sponsoredMessage(feePayer, instructions))));
   const signature = await broadcast(signed);
   debug("sent", String(signature));
   return signature;
}
