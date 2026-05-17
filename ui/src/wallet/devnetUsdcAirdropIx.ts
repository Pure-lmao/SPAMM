import { AccountRole, type Instruction } from "@solana/instructions";
import { address, type Address } from "@solana/kit";
import {
   getAta,
   MINT_ID,
   SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
   SPL_TOKEN_PROGRAM_ID,
   SYSTEM_PROGRAM_ID,
} from "spamm-aggregator-sdk";

const DEVNET_USDC_AIRDROP_PROGRAM: Address = address("4sN8PnN2ki2W4TFXAfzR645FWs8nimmsYeNtxM8RBK6A");

const SYSVAR_RENT: Address = address("SysvarRent111111111111111111111111111111111");

/** Instruction data for devnet USDC airdrop (discriminator + payload). */
const AIRDROP_IX_DATA = new Uint8Array(
   "71ad24ee26981675ff00e1f50500000000".match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
);

const ro = (a: Address) => ({ address: a, role: AccountRole.READONLY });
const rw = (a: Address) => ({ address: a, role: AccountRole.WRITABLE });
const ws = (a: Address) => ({ address: a, role: AccountRole.WRITABLE_SIGNER });

/**
 * Devnet faucet-style transfer into the user's USDC ATA (`MINT_ID`).
 * Account order and `data` match the on-chain program layout.
 */
export async function buildDevnetUsdcAirdropIx(user: Address): Promise<Instruction> {
   const userAta = await getAta(user);
   return {
      programAddress: DEVNET_USDC_AIRDROP_PROGRAM,
      accounts: [
         rw(MINT_ID),
         rw(userAta),
         ws(user),
         ws(user),
         ro(SYSTEM_PROGRAM_ID),
         ro(SPL_TOKEN_PROGRAM_ID),
         ro(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
         ro(SYSVAR_RENT),
      ],
      data: AIRDROP_IX_DATA,
   };
}
