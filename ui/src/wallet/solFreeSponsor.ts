import { address, type Address } from "@solana/kit";
import { LABS_DOMAIN } from "../network";

/**
 * Wallets below this pay no SOL; the labs sol-free signer is the fee payer.
 * Change this value to move the sponsorship cutoff everywhere it is used.
 */
export const SOL_FREE_MIN_LAMPORTS = 10_000_000n;

export function solBalanceNeedsSponsor(lamports: bigint): boolean {
   return lamports < SOL_FREE_MIN_LAMPORTS;
}

let cachedAddress: Address | null = null;
let pendingAddress: Promise<Address> | null = null;

function errorFromBody(raw: unknown, fallback: string): string {
   if (
      raw != null &&
      typeof raw === "object" &&
      "error" in raw &&
      typeof (raw as { error: unknown }).error === "string"
   ) {
      const msg = (raw as { error: string }).error.trim();
      if (msg !== "") {
         return msg;
      }
   }
   return fallback;
}

async function fetchSolFreeAddress(): Promise<Address> {
   if (LABS_DOMAIN === "") {
      throw new Error("Labs API is not configured");
   }
   const res = await fetch(`${LABS_DOMAIN}/api/solfreeAddress`);
   const raw: unknown = await res.json().catch(() => null);
   if (!res.ok) {
      throw new Error(errorFromBody(raw, res.statusText || "Sol-free signer is unavailable"));
   }
   if (
      raw == null ||
      typeof raw !== "object" ||
      !("address" in raw) ||
      typeof (raw as { address: unknown }).address !== "string" ||
      (raw as { address: string }).address === ""
   ) {
      throw new Error("Sol-free signer address missing");
   }
   return address((raw as { address: string }).address);
}

/** GET /api/solfreeAddress once per session. Later callers share the stored address. */
export function ensureSolFreeAddress(): Promise<Address> {
   if (cachedAddress != null) {
      return Promise.resolve(cachedAddress);
   }
   if (pendingAddress != null) {
      return pendingAddress;
   }
   pendingAddress = fetchSolFreeAddress()
      .then((addr) => {
         cachedAddress = addr;
         return addr;
      })
      .finally(() => {
         pendingAddress = null;
      });
   return pendingAddress;
}

/** On connect, load the sponsor address when the wallet cannot pay fees. */
export function prefetchSolFreeAddressIfLow(lamports: bigint): void {
   if (!solBalanceNeedsSponsor(lamports) || cachedAddress != null) {
      return;
   }
   void ensureSolFreeAddress().catch((error: unknown) => {
      console.warn("sol-free signer address unavailable", error);
   });
}

/** POST the compiled message. The server sets the blockhash, signs, and returns a wire transaction. */
export async function requestSolFreeSignature(messageB64: string): Promise<string> {
   if (LABS_DOMAIN === "") {
      throw new Error("Labs API is not configured");
   }
   const res = await fetch(`${LABS_DOMAIN}/api/solfree`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: messageB64 }),
   });
   const raw: unknown = await res.json().catch(() => null);
   if (!res.ok) {
      throw new Error(errorFromBody(raw, res.statusText || "Sol-free signing failed"));
   }
   if (
      raw == null ||
      typeof raw !== "object" ||
      !("success" in raw) ||
      (raw as { success: unknown }).success !== true ||
      !("tx" in raw) ||
      typeof (raw as { tx: unknown }).tx !== "string" ||
      (raw as { tx: string }).tx === ""
   ) {
      throw new Error(errorFromBody(raw, "Sol-free signing failed"));
   }
   return (raw as { tx: string }).tx;
}
