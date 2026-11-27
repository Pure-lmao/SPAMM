import { AccountRole, address, type Address, type Instruction } from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token";
import {
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
   SYSTEM_PROGRAM_ID,
   SYSVAR_RENT_ID,
   getAta,
} from "spamm-aggregator-sdk";
import { DEVNET_USDC_AIRDROP_PROGRAM, USDC_DECIMALS } from "../constants";
import { rpc } from "../chain/rpc";
import { IS_DEVNET, MINT } from "../network";
import { sendInstructions } from "./send";
import { feePayerFor, solFreeAddress } from "./solFree";
import { signerFor, type BotWallet } from "./privy";

export async function readBalances(owner: Address): Promise<{ sol: bigint; usdc: bigint }> {
   const [{ value: sol }, usdc] = await Promise.all([
      rpc.getBalance(owner).send(),
      (async () => {
         try {
            const ata = await getAta(owner, MINT);
            const bal = await rpc.getTokenAccountBalance(ata).send();
            return BigInt(bal.value.amount);
         } catch {
            return 0n;
         }
      })(),
   ]);
   return { sol, usdc };
}

function createAtaIx(payer: Address, owner: Address, ata: Address): Instruction {
   return {
      programAddress: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
      accounts: [
         { address: payer, role: AccountRole.WRITABLE_SIGNER },
         { address: ata, role: AccountRole.WRITABLE },
         { address: owner, role: AccountRole.READONLY },
         { address: MINT, role: AccountRole.READONLY },
         { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
         { address: SPL_TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1]),
   };
}

export async function withdrawUsdc(wallet: BotWallet, destination: Address, amount: bigint): Promise<string> {
   const source = await getAta(wallet.address, MINT);
   const dest = await getAta(destination, MINT);
   const ix = getTransferCheckedInstruction({
      source,
      mint: MINT,
      destination: dest,
      authority: signerFor(wallet),
      amount,
      decimals: USDC_DECIMALS,
   });
   const info = await rpc.getAccountInfo(dest, { encoding: "base64" }).send();
   const feePayer = await feePayerFor(wallet.address);
   const instructions: Instruction[] = info.value == null
      ? [createAtaIx(feePayer, destination, dest), ix]
      : [ix];
   void SYSVAR_RENT_ID;
   return String(await sendInstructions(wallet, instructions));
}

const AIRDROP_DATA = new Uint8Array(
   "71ad24ee26981675ff00e1f50500000000".match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
);

export async function airdropDevnetUsdc(wallet: BotWallet): Promise<string> {
   if (!IS_DEVNET) {
      throw new Error("Test USDC is only on devnet");
   }
   const userAta = await getAta(wallet.address, MINT);
   const feePayer = await solFreeAddress();
   const ro = (addr: Address) => ({ address: addr, role: AccountRole.READONLY });
   const rw = (addr: Address) => ({ address: addr, role: AccountRole.WRITABLE });
   const ws = (addr: Address) => ({ address: addr, role: AccountRole.WRITABLE_SIGNER });
   const ix: Instruction = {
      programAddress: address(DEVNET_USDC_AIRDROP_PROGRAM),
      accounts: [
         rw(MINT),
         rw(userAta),
         ws(feePayer),
         ws(wallet.address),
         ro(SYSTEM_PROGRAM_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT_ID),
      ],
      data: AIRDROP_DATA,
   };
   return String(await sendInstructions(wallet, [ix], { sponsor: "always" }));
}
