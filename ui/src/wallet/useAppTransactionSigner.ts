import { useEffect, useMemo, useState } from "react";
import { useCluster } from "@solana/connector/react";
import type { TransactionSigner } from "@solana/kit";
import { createEphemeralKitSigner, EPHEMERAL_DEVNET_WALLET_NAME } from "./ephemeralDevnetWallet";
import { useAppWallet } from "./useAppWallet";
import { SOLANA_CHAIN_ID } from "../network";
import { createWalletStandardV1Signer } from "./walletStandardV1Signer";

export function useAppTransactionSigner(): {
   signer: TransactionSigner | null;
   ready: boolean;
   walletName: string | null;
} {
   const { isConnected, account, walletName, standardWallet } = useAppWallet();
   const { cluster } = useCluster();
   const [ephemeralSigner, setEphemeralSigner] = useState<TransactionSigner | null>(null);
   const isEphemeral = isConnected && walletName === EPHEMERAL_DEVNET_WALLET_NAME;

   useEffect(() => {
      if (!isEphemeral) {
         setEphemeralSigner(null);
         return;
      }
      let cancelled = false;
      void createEphemeralKitSigner()
         .then((signer) => {
            if (!cancelled) {
               setEphemeralSigner(signer);
            }
         })
         .catch(() => {
            if (!cancelled) {
               setEphemeralSigner(null);
            }
         });
      return () => {
         cancelled = true;
      };
   }, [isEphemeral]);

   const extensionSigner = useMemo((): TransactionSigner | null => {
      if (!isConnected || account == null || standardWallet == null || isEphemeral) {
         return null;
      }
      try {
         return createWalletStandardV1Signer({
            wallet: standardWallet,
            accountAddress: account,
            chain: cluster?.id ?? SOLANA_CHAIN_ID,
         });
      } catch {
         return null;
      }
   }, [account, cluster?.id, isConnected, isEphemeral, standardWallet]);

   if (isEphemeral) {
      return {
         signer: ephemeralSigner,
         ready: ephemeralSigner != null,
         walletName,
      };
   }
   return {
      signer: extensionSigner,
      ready: extensionSigner != null,
      walletName,
   };
}
