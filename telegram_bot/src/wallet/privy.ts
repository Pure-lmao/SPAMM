import { PrivyClient, type User } from "@privy-io/node";
import { createSolanaKitSigner, type SolanaKitSigner } from "@privy-io/node/solana-kit";
import { address, type Address } from "@solana/kit";
import { PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_PRIVATE_KEY, PRIVY_SIGNER_ID } from "../env";
import { CAIP2 } from "../network";

export const privy = new PrivyClient({
   appId: PRIVY_APP_ID,
   appSecret: PRIVY_APP_SECRET,
});

export type BotWallet = {
   userId: string;
   walletId: string;
   address: Address;
};

const byTelegram = new Map<string, BotWallet>();

function solanaWallet(user: User): { id: string; address: string } | null {
   for (const account of user.linked_accounts) {
      if (
         account.type === "wallet"
         && "chain_type" in account
         && account.chain_type === "solana"
         && "id" in account
         && typeof account.id === "string"
         && account.id !== ""
         && typeof account.address === "string"
      ) {
         return { id: account.id, address: account.address };
      }
   }
   return null;
}

export async function ensureWallet(telegramUserId: number): Promise<BotWallet> {
   const key = String(telegramUserId);
   const cached = byTelegram.get(key);
   if (cached != null) {
      return cached;
   }
   let user: User;
   try {
      user = await privy.users().getByTelegramUserID({ telegram_user_id: key });
   } catch {
      user = await privy.users().create({
         linked_accounts: [{ type: "telegram", telegram_user_id: key }],
      });
   }
   let found = solanaWallet(user);
   if (found == null) {
      for await (const item of privy.wallets().list({ user_id: user.id, chain_type: "solana" })) {
         if (item.chain_type === "solana" && item.id !== "") {
            found = { id: item.id, address: item.address };
            break;
         }
      }
   }
   if (found == null) {
      const created = await privy.wallets().create({
         chain_type: "solana",
         owner: { user_id: user.id },
         additional_signers: [{ signer_id: PRIVY_SIGNER_ID, override_policy_ids: [] }],
      });
      found = { id: created.id, address: created.address };
   }
   const wallet: BotWallet = {
      userId: user.id,
      walletId: found.id,
      address: address(found.address),
   };
   byTelegram.set(key, wallet);
   return wallet;
}

export function signerFor(wallet: BotWallet): SolanaKitSigner {
   return createSolanaKitSigner(privy, {
      walletId: wallet.walletId,
      address: wallet.address,
      caip2: CAIP2,
      authorizationContext: {
         authorization_private_keys: [PRIVY_AUTHORIZATION_PRIVATE_KEY],
      },
   });
}
