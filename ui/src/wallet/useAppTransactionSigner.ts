import { useEffect, useMemo, useState } from "react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet } from "@wallet-standard/base";
import { useCluster, useWallet, useWalletInfo } from "@solana/connector/react";
import type { TransactionSigner } from "@solana/kit";
import { createEphemeralKitSigner, EPHEMERAL_DEVNET_WALLET_NAME } from "./ephemeralDevnetWallet";
import { createWalletStandardV1Signer } from "./walletStandardV1Signer";

function findStandardWallet(name: string | null, accountAddress: string): Wallet | null {
   const wallets = getWallets().get();
   const byAccount = wallets.find((w) => w.accounts.some((a) => a.address === accountAddress));
   if (byAccount != null) {
      return byAccount;
   }
   if (name == null || name === "") {
      return null;
   }
   return wallets.find((w) => w.name === name) ?? null;
}

export function useAppTransactionSigner(): {
   signer: TransactionSigner | null;
   ready: boolean;
   walletName: string | null;
} {
   const { isConnected, account } = useWallet();
   const { name } = useWalletInfo();
   const { cluster } = useCluster();
   const [ephemeralSigner, setEphemeralSigner] = useState<TransactionSigner | null>(null);
   const [registryTick, setRegistryTick] = useState(0);
   const isEphemeral = isConnected && name === EPHEMERAL_DEVNET_WALLET_NAME;
   const accountAddress = account != null ? String(account) : "";

   useEffect(() => {
      const api = getWallets();
      const bump = () => setRegistryTick((n) => n + 1);
      const offRegister = api.on("register", bump);
      const offUnregister = api.on("unregister", bump);
      return () => {
         offRegister();
         offUnregister();
      };
   }, []);

   useEffect(() => {
      if (!isEphemeral) {
         setEphemeralSigner(null);
         return;
      }
      let cancelled = false;
      void createEphemeralKitSigner()
         .then((s) => {
            if (!cancelled) {
               setEphemeralSigner(s);
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
      if (!isConnected || accountAddress === "" || isEphemeral) {
         return null;
      }
      const wallet = findStandardWallet(name, accountAddress);
      if (wallet == null) {
         return null;
      }
      try {
         return createWalletStandardV1Signer({
            wallet,
            accountAddress,
            chain: cluster?.id,
         });
      } catch {
         return null;
      }
   }, [accountAddress, cluster?.id, isConnected, isEphemeral, name, registryTick]);

   if (isEphemeral) {
      return {
         signer: ephemeralSigner,
         ready: ephemeralSigner != null,
         walletName: name,
      };
   }
   return {
      signer: extensionSigner,
      ready: extensionSigner != null,
      walletName: name,
   };
}
