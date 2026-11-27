import { type AppNetwork } from "./constants";

function required(name: string): string {
   const value = process.env[name]?.trim() ?? "";
   if (value === "") {
      throw new Error(`Missing ${name}`);
   }
   return value;
}

export function readNetwork(): AppNetwork {
   const raw = (process.env.NETWORK ?? "").trim().toLowerCase();
   if (raw === "" || raw === "devnet") {
      return "devnet";
   }
   if (raw === "mainnet" || raw === "mainnet-beta") {
      return "mainnet";
   }
   throw new Error(`NETWORK must be "devnet" or "mainnet" (got ${JSON.stringify(process.env.NETWORK)})`);
}

export const NETWORK = readNetwork();

export const TELEGRAM_BOT_TOKEN = required("TELEGRAM_BOT_TOKEN");
export const PRIVY_APP_ID = required("PRIVY_APP_ID");
export const PRIVY_APP_SECRET = required("PRIVY_APP_SECRET");
export const PRIVY_AUTHORIZATION_PRIVATE_KEY = required("PRIVY_AUTHORIZATION_PRIVATE_KEY");
export const HELIUS_API_KEY = process.env.HELIUS_API_KEY?.trim() ?? "";
export const PRIVY_SIGNER_ID = required("PRIVY_SIGNER_ID");

function flag(name: string): boolean {
   const raw = (process.env[name] ?? "").trim().toLowerCase();
   return raw === "1" || raw === "true" || raw === "yes";
}

/** Verbose console trace. Errors are always printed; this adds each step. */
export const DEBUG = flag("DEBUG");
