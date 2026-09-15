import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
   address,
   getTransactionDecoder,
   getTransactionEncoder,
   type Transaction,
   type TransactionModifyingSigner,
} from "@solana/kit";

type SignTransactionFeature = {
   supportedTransactionVersions?: readonly (string | number)[];
   signTransaction: (input: Record<string, unknown>) => Promise<unknown>;
};

function asBytes(value: unknown): Uint8Array | null {
   if (value instanceof Uint8Array) {
      return value;
   }
   if (value != null && typeof value === "object" && "signedTransaction" in value) {
      const inner = (value as { signedTransaction: unknown }).signedTransaction;
      if (inner instanceof Uint8Array) {
         return inner;
      }
   }
   return null;
}

function extractSignedBytes(result: unknown): Uint8Array {
   const direct = asBytes(result);
   if (direct != null) {
      return direct;
   }
   if (Array.isArray(result) && result.length > 0) {
      const first = asBytes(result[0]) ?? extractSignedBytes(result[0]);
      return first;
   }
   if (result != null && typeof result === "object") {
      const rec = result as {
         signedTransaction?: unknown;
         signedTransactions?: unknown;
      };
      if (Array.isArray(rec.signedTransactions) && rec.signedTransactions[0] != null) {
         const b = asBytes(rec.signedTransactions[0]);
         if (b != null) {
            return b;
         }
      }
      const one = asBytes(rec.signedTransaction);
      if (one != null) {
         return one;
      }
   }
   throw new Error("Wallet returned an unexpected signTransaction payload");
}

function errorText(error: unknown): string {
   return error instanceof Error ? error.message : String(error);
}

function isWalletV1DeserializeFailure(error: unknown): boolean {
   const lower = errorText(error).toLowerCase();
   return (
      lower.includes("reached end of buffer") ||
      lower.includes("failed to deserialize") ||
      lower.includes("cannot deserialize") ||
      lower.includes("unable to deserialize") ||
      lower.includes("unsupported transaction version") ||
      lower.includes("unexpected transaction version")
   );
}

async function walletSignTransactionBytes(
   feature: SignTransactionFeature,
   account: WalletAccount,
   wire: Uint8Array,
   chain: string | undefined,
   walletName: string,
): Promise<Uint8Array> {
   const base = {
      account,
      ...(chain != null && chain !== "" ? { chain } : {}),
   };
   try {
      return extractSignedBytes(
         await feature.signTransaction({
            ...base,
            transactions: [wire],
         }),
      );
   } catch (first) {
      try {
         return extractSignedBytes(
            await feature.signTransaction({
               ...base,
               transaction: wire,
            }),
         );
      } catch (second) {
         if (isWalletV1DeserializeFailure(first) || isWalletV1DeserializeFailure(second)) {
            throw new Error(formatV1UnsupportedWalletError(walletName));
         }
         throw second instanceof Error ? second : first;
      }
   }
}

export function formatV1UnsupportedWalletError(walletName: string): string {
   return `V1 transactions not possible with ${walletName}. Disconnect and create a Temporary Wallet for now.`;
}

export function signErrorMessageForUi(
   error: unknown,
   options?: Readonly<{ walletName?: string | null }>,
): string {
   const raw = errorText(error);
   if (raw.startsWith("V1 transactions not possible with ")) {
      return raw;
   }
   if (isWalletV1DeserializeFailure(error)) {
      return formatV1UnsupportedWalletError(options?.walletName?.trim() || "this wallet");
   }
   return raw;
}

export function createWalletStandardV1Signer(params: {
   wallet: Wallet;
   accountAddress: string;
   chain?: string;
}): TransactionModifyingSigner {
   const signerAddress = address(params.accountAddress);
   const feature = params.wallet.features["solana:signTransaction"] as SignTransactionFeature | undefined;
   if (feature == null || typeof feature.signTransaction !== "function") {
      throw new Error(`${params.wallet.name} does not support solana:signTransaction`);
   }
   const account =
      params.wallet.accounts.find((a) => a.address === params.accountAddress) ??
      ({
         address: params.accountAddress,
         publicKey: new Uint8Array(32),
         chains: [],
         features: [],
      } as WalletAccount);

   return {
      address: signerAddress,
      modifyAndSignTransactions: async (transactions) => {
         const encoder = getTransactionEncoder();
         const decoder = getTransactionDecoder();
         const signed: Transaction[] = [];
         for (const tx of transactions) {
            const wire = new Uint8Array(encoder.encode(tx));
            const signedBytes = await walletSignTransactionBytes(
               feature,
               account,
               wire,
               params.chain,
               params.wallet.name,
            );
            const decoded = decoder.decode(signedBytes);
            const original = tx as Transaction & { lifetimeConstraint?: unknown };
            signed.push({
               ...decoded,
               ...(original.lifetimeConstraint != null
                  ? { lifetimeConstraint: original.lifetimeConstraint }
                  : {}),
            } as Transaction);
         }
         return signed as never;
      },
   };
}
