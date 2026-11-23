import { useCallback, useEffect, useMemo, useState } from "react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet } from "@wallet-standard/base";
import {
   useConnectWallet,
   useDisconnectWallet,
   useWallet,
   useWalletConnectors,
   useWalletInfo,
} from "@solana/connector/react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { PRIVY_LOGIN_METHODS } from "./privyLoginMethods";

function shortAddress(value: string): string {
   if (value.length <= 8) {
      return value;
   }
   return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function findStandardWallet(name: string | null, accountAddress: string): Wallet | null {
   const wallets = getWallets().get();
   const byAccount = wallets.find((wallet) => wallet.accounts.some((account) => account.address === accountAddress));
   if (byAccount != null) {
      return byAccount;
   }
   if (name == null || name === "") {
      return null;
   }
   return wallets.find((wallet) => wallet.name === name) ?? null;
}

export function useAppWallet(): {
   ready: boolean;
   isConnected: boolean;
   account: string | null;
   formatted: string | null;
   walletName: string | null;
   standardWallet: Wallet | null;
   connectors: ReturnType<typeof useWalletConnectors>;
   connectBusy: boolean;
   connectError: string | null;
   loginError: string | null;
   connectWallet: (connectorId: ReturnType<typeof useWalletConnectors>[number]["id"]) => Promise<void>;
   connectFirstWallet: () => Promise<void>;
   loginSocial: () => void;
   logout: () => Promise<void>;
} {
   const { ready, authenticated, logout: logoutPrivy } = usePrivy();
   const { wallets, ready: walletsReady } = useWallets();
   const { isConnected: connectorConnected, account: connectorAccount } = useWallet();
   const { name: connectorName } = useWalletInfo();
   const connectors = useWalletConnectors();
   const { connect, isConnecting, error: connectorError, resetError } = useConnectWallet();
   const { disconnect, isDisconnecting } = useDisconnectWallet();
   const [registryTick, setRegistryTick] = useState(0);
   const [loginError, setLoginError] = useState<string | null>(null);
   const [socialPending, setSocialPending] = useState(false);
   const { login } = useLogin({
      onComplete: () => {
         setLoginError(null);
      },
      onError: (error) => {
         const code = String(error);
         if (code === "exited_auth_flow") {
            setLoginError(null);
            return;
         }
         setLoginError(code);
      },
   });

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

   const embedded = useMemo(() => {
      if (!authenticated) {
         return null;
      }
      return wallets.find((wallet) => wallet.standardWallet.name.toLowerCase() === "privy") ?? null;
   }, [authenticated, wallets]);

   const connectorAddress = connectorConnected && connectorAccount != null ? String(connectorAccount) : "";
   const connectorWallet = useMemo(() => {
      if (embedded != null || connectorAddress === "") {
         return null;
      }
      return findStandardWallet(connectorName, connectorAddress);
   }, [connectorAddress, connectorName, embedded, registryTick]);

   const usingPrivy = embedded != null;
   const account = usingPrivy ? embedded.address : connectorAddress === "" ? null : connectorAddress;
   const walletName = usingPrivy ? embedded.standardWallet.name : connectorName;
   const standardWallet = usingPrivy ? embedded.standardWallet : connectorWallet;

   const connectWallet = useCallback(
      async (connectorId: ReturnType<typeof useWalletConnectors>[number]["id"]) => {
         resetError();
         setLoginError(null);
         if (authenticated) {
            await logoutPrivy();
         }
         await connect(connectorId);
      },
      [authenticated, connect, logoutPrivy, resetError],
   );

   const connectFirstWallet = useCallback(async () => {
      const readyConnector = connectors.find((connector) => connector.ready) ?? connectors[0];
      if (readyConnector == null) {
         return;
      }
      await connectWallet(readyConnector.id);
   }, [connectWallet, connectors]);

   const loginSocial = useCallback(() => {
      setLoginError(null);
      resetError();
      if (connectorConnected) {
         void disconnect();
      }
      if (!ready) {
         setSocialPending(true);
         return;
      }
      login({ loginMethods: [...PRIVY_LOGIN_METHODS] });
   }, [connectorConnected, disconnect, login, ready, resetError]);

   useEffect(() => {
      if (!socialPending || !ready) {
         return;
      }
      setSocialPending(false);
      login({ loginMethods: [...PRIVY_LOGIN_METHODS] });
   }, [login, ready, socialPending]);

   const logout = useCallback(async () => {
      if (authenticated) {
         await logoutPrivy();
      }
      if (connectorConnected) {
         await disconnect();
      }
   }, [authenticated, connectorConnected, disconnect, logoutPrivy]);

   return {
      ready: ready && walletsReady,
      isConnected: account != null,
      account,
      formatted: account == null ? null : shortAddress(account),
      walletName,
      standardWallet,
      connectors,
      connectBusy: isConnecting || isDisconnecting,
      connectError: connectorError == null ? null : connectorError.message,
      loginError,
      connectWallet,
      connectFirstWallet,
      loginSocial,
      logout,
   };
}
