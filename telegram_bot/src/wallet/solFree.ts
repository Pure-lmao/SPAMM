import { address, type Address } from "@solana/kit";
import { SOL_FREE_MIN_LAMPORTS, SOLFREE_TIMEOUT_MS } from "../constants";
import { debug } from "../debug";
import { rpc } from "../chain/rpc";
import { LABS_DOMAIN } from "../network";

let cached: Address | null = null;

function errorFromBody(raw: unknown, fallback: string): string {
   if (raw != null && typeof raw === "object" && "error" in raw && typeof (raw as { error: unknown }).error === "string") {
      const msg = (raw as { error: string }).error.trim();
      if (msg !== "") {
         return msg;
      }
   }
   return fallback;
}

async function labsFetch(path: string, init?: RequestInit): Promise<{ status: number; raw: unknown }> {
   debug("labs", path);
   let res: Response;
   try {
      res = await fetch(`${LABS_DOMAIN}${path}`, {
         ...init,
         signal: AbortSignal.timeout(SOLFREE_TIMEOUT_MS),
      });
   } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
         throw new Error(`Sol-free request timed out after ${SOLFREE_TIMEOUT_MS}ms`);
      }
      throw error;
   }
   const raw: unknown = await res.json().catch(() => null);
   if (!res.ok) {
      console.error("[solfree]", path, res.status, raw);
   } else {
      debug("labs", { path, status: res.status });
   }
   return { status: res.status, raw };
}

export async function solFreeAddress(): Promise<Address> {
   if (cached != null) {
      return cached;
   }
   const { status, raw } = await labsFetch("/api/solfreeAddress");
   const res = { ok: status >= 200 && status < 300 };
   if (!res.ok) {
      throw new Error(errorFromBody(raw, "Sol-free signer is unavailable"));
   }
   const addr = raw != null && typeof raw === "object" && "address" in raw ? String((raw as { address: unknown }).address) : "";
   if (addr === "") {
      throw new Error("Sol-free signer address missing");
   }
   cached = address(addr);
   return cached;
}

export async function needsSponsor(wallet: Address): Promise<boolean> {
   const { value } = await rpc.getBalance(wallet).send();
   return value < SOL_FREE_MIN_LAMPORTS;
}

export async function feePayerFor(wallet: Address): Promise<Address> {
   if (!(await needsSponsor(wallet))) {
      return wallet;
   }
   return solFreeAddress();
}

export async function requestSolFreeSignature(messageB64: string): Promise<string> {
   debug("solfree sign", { bytes: messageB64.length });
   const { status, raw } = await labsFetch("/api/solfree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: messageB64 }),
   });
   const res = { ok: status >= 200 && status < 300 };
   if (!res.ok) {
      console.error("[solfree] message", messageB64);
      throw new Error(errorFromBody(raw, "Sol-free signing failed"));
   }
   if (
      raw == null
      || typeof raw !== "object"
      || (raw as { success?: unknown }).success !== true
      || typeof (raw as { tx?: unknown }).tx !== "string"
      || (raw as { tx: string }).tx === ""
   ) {
      throw new Error(errorFromBody(raw, "Sol-free signing failed"));
   }
   return (raw as { tx: string }).tx;
}
