import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { getAddressFromPublicKey } from "@solana/addresses";
import { getBase58Decoder } from "@solana/kit";
import { createKeyPairFromPrivateKeyBytes, signBytes } from "@solana/keys";
import {
   getBase64EncodedWireTransaction,
   getTransactionDecoder,
   getTransactionEncoder,
   partiallySignTransaction,
} from "@solana/transactions";

/** Wallet Standard display name (ConnectorKit derives connector id from this). */
export const EPHEMERAL_DEVNET_WALLET_NAME = "Temporary Wallet (Devnet)";

const STORAGE_KEY = "asm:devnet-ephemeral-private-seed-b64";

/** Minimal valid icon (purple tile) for Wallet Standard. */
const EPHEMERAL_ICON =
   "data:image/svg+xml;base64," +
   btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#7c3aed"/><text x="16" y="21" text-anchor="middle" fill="#fff" font-size="11" font-family="system-ui,sans-serif">E</text></svg>',
   );

const TX_VERSIONS = ["legacy", 0] as const;

function bytesToB64(bytes: Uint8Array): string {
   let s = "";
   for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]!);
   }
   return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array | null {
   try {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
         out[i] = bin.charCodeAt(i);
      }
      return out;
   } catch {
      return null;
   }
}

export function readEphemeralSeedFromStorage(): Uint8Array | null {
   if (typeof localStorage === "undefined") {
      return null;
   }
   const raw = localStorage.getItem(STORAGE_KEY)?.trim();
   if (!raw) {
      return null;
   }
   const bytes = b64ToBytes(raw);
   if (bytes == null || bytes.length !== 32) {
      return null;
   }
   return bytes;
}

/** Generate a new 32-byte seed, persist it, and return it (replaces any prior ephemeral key). */
function createAndStoreEphemeralSeed(): Uint8Array {
   const seed = new Uint8Array(32);
   crypto.getRandomValues(seed);
   localStorage.setItem(STORAGE_KEY, bytesToB64(seed));
   return seed;
}

export function clearEphemeralSeedFromStorage(): void {
   if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
   }
}

function assertDevnetChain(chain: string | undefined): void {
   if (chain != null && chain !== "" && chain !== "solana:devnet") {
      throw new Error("Ephemeral (Devnet) wallet only supports solana:devnet");
   }
}

async function sendSignedBase64Tx(
   base64Tx: string,
   chain: string | undefined,
   options?: { skipPreflight?: boolean; maxRetries?: number },
): Promise<string> {
   assertDevnetChain(chain);
   const fromEnv =
      typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_SOLANA_RPC_URL === "string"
         ? import.meta.env.VITE_SOLANA_RPC_URL.trim()
         : "";
   const url = fromEnv !== "" ? fromEnv : "https://api.devnet.solana.com";
   const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
         jsonrpc: "2.0",
         id: 1,
         method: "sendTransaction",
         params: [
            base64Tx,
            {
               encoding: "base64",
               skipPreflight: options?.skipPreflight ?? false,
               maxRetries: options?.maxRetries,
            },
         ],
      }),
   });
   const json: unknown = await res.json();
   if (!json || typeof json !== "object") {
      throw new Error("sendTransaction: invalid JSON-RPC response");
   }
   const rec = json as { error?: { message?: string }; result?: string };
   if (rec.error) {
      throw new Error(rec.error.message ?? "sendTransaction failed");
   }
   if (typeof rec.result !== "string") {
      throw new Error("sendTransaction: missing signature result");
   }
   return rec.result;
}

async function accountFromKeyPair(keyPair: CryptoKeyPair): Promise<WalletAccount> {
   const rawPk = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
   const addr = await getAddressFromPublicKey(keyPair.publicKey);
   return {
      address: addr,
      publicKey: rawPk,
      chains: ["solana:devnet"],
      features: [],
   };
}

/**
 * Registers a devnet-only in-browser wallet backed by a 32-byte seed in `localStorage`.
 * Call from `useLayoutEffect` before or while the connector mounts so it can be discovered.
 */
export function registerSpammEphemeralDevnetWallet(): () => void {
   const changeListeners = new Set<(e: { accounts: readonly WalletAccount[] }) => void>();
   const state: { accounts: WalletAccount[]; cachedKeyPair: CryptoKeyPair | null } = {
      accounts: [],
      cachedKeyPair: null,
   };

   function emitChange() {
      const snap = [...state.accounts];
      changeListeners.forEach((fn) => fn({ accounts: snap }));
   }

   async function ensureKeyPair(): Promise<CryptoKeyPair> {
      if (state.cachedKeyPair) {
         return state.cachedKeyPair;
      }
      const seed = readEphemeralSeedFromStorage();
      if (!seed) {
         throw new Error("Ephemeral (Devnet): no key in storage; connect again to create one.");
      }
      state.cachedKeyPair = await createKeyPairFromPrivateKeyBytes(seed);
      return state.cachedKeyPair;
   }

   async function refreshAccountsFromStorage(): Promise<void> {
      const seed = readEphemeralSeedFromStorage();
      if (!seed) {
         state.accounts = [];
         state.cachedKeyPair = null;
         emitChange();
         return;
      }
      state.cachedKeyPair = await createKeyPairFromPrivateKeyBytes(seed);
      state.accounts = [await accountFromKeyPair(state.cachedKeyPair)];
      emitChange();
   }

   const wallet: Wallet = {
      version: "1.0.0",
      name: EPHEMERAL_DEVNET_WALLET_NAME,
      icon: EPHEMERAL_ICON as Wallet["icon"],
      chains: ["solana:devnet"],
      get accounts() {
         return state.accounts;
      },
      features: {
         "standard:connect": {
            version: "1.0.0",
            connect: async (input) => {
               const silent = input?.silent === true;
               if (!readEphemeralSeedFromStorage()) {
                  if (silent) {
                     state.accounts = [];
                     state.cachedKeyPair = null;
                     emitChange();
                     return { accounts: [] };
                  }
                  createAndStoreEphemeralSeed();
               }
               await refreshAccountsFromStorage();
               return { accounts: state.accounts };
            },
         },
         "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
               state.accounts = [];
               state.cachedKeyPair = null;
               emitChange();
            },
         },
         "standard:events": {
            version: "1.0.0",
            on: (event, listener) => {
               if (event !== "change") {
                  return () => {};
               }
               changeListeners.add(listener);
               return () => changeListeners.delete(listener);
            },
         },
         "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: TX_VERSIONS,
            signTransaction: async (...inputs) => {
               const kp = await ensureKeyPair();
               return Promise.all(
                  inputs.map(async (input) => {
                     assertDevnetChain(input.chain);
                     const txBytes = new Uint8Array(input.transaction);
                     const tx = getTransactionDecoder().decode(txBytes);
                     const signed = await partiallySignTransaction([kp], tx);
                     const wire = new Uint8Array(getTransactionEncoder().encode(signed));
                     return { signedTransaction: wire };
                  }),
               );
            },
         },
         "solana:signAndSendTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: TX_VERSIONS,
            signAndSendTransaction: async (...inputs) => {
               const kp = await ensureKeyPair();
               return Promise.all(
                  inputs.map(async (input) => {
                     const txBytes = new Uint8Array(input.transaction);
                     const tx = getTransactionDecoder().decode(txBytes);
                     const signed = await partiallySignTransaction([kp], tx);
                     const b64 = getBase64EncodedWireTransaction(signed);
                     const sigStr = await sendSignedBase64Tx(b64, input.chain, input.options);
                     const sigBytes = getBase58Decoder().decode(sigStr);
                     return { signature: new Uint8Array(sigBytes) };
                  }),
               );
            },
         },
         "solana:signMessage": {
            version: "1.0.0",
            signMessage: async (...inputs) => {
               const kp = await ensureKeyPair();
               return Promise.all(
                  inputs.map(async (input) => {
                     const sig = await signBytes(kp.privateKey, input.message);
                     return {
                        signedMessage: input.message,
                        signature: new Uint8Array(sig),
                        signatureType: "ed25519" as const,
                     };
                  }),
               );
            },
         },
      },
   };

   const { unregister } = getWallets().register(wallet);
   return unregister;
}
