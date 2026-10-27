/**
 * Scrape historical mainnet bet placements from the aggregator program.
 *
 * The program that produced these bets is the June 2026 deploy (before RFQ).
 * That build is not the instruction layout in the current tree:
 *   - single fill discriminator 3, 55-byte payload (no market operator)
 *   - parlay fill discriminator 4, 192-byte payload (fixed 5-leg table)
 * Filled odds come from the market-maker quote return (`u64` max amount, `u32` odds),
 * not from `min_odds` on the instruction. Stake is the bettor's USDC debit.
 *
 *   HELIUS_API_KEY=... bun scrapeMainnetBets.ts
 *   bun scrapeMainnetBets.ts --check tx.json
 *
 * Writes `mainnet-bets.sqlite` next to this file. Re-runs resume from the saved page token.
 */

import { Database } from "bun:sqlite";
import { getBase58Encoder } from "@solana/kit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROGRAM_ID = "5pammQjfw9f1oWtL9rLipVuYf5ufmzeKVeRwrXcA961H";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ODDS_SCALE = 10_000n;
const SINGLE_DISC = 3;
const PARLAY_DISC = 4;
const SINGLE_LEN = 55;
const PARLAY_LEN = 192;
const USDC_DECIMALS = 6;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const b58 = getBase58Encoder();

type Quote = { maxAmount: bigint; oddsScaled: number };

export type BetRow = {
   signature: string;
   slot: number;
   blockTime: number | null;
   kind: "single" | "parlay";
   bettor: string;
   betId: string;
   filledAmount: bigint;
   oddsScaled: number;
   numLegs: number;
};

type TxEntry = {
   slot?: number;
   blockTime?: number | null;
   transaction?: {
      signatures?: string[];
      message?: {
         accountKeys?: unknown[];
         instructions?: RawIx[];
      };
   };
   meta?: {
      err?: unknown;
      logMessages?: string[] | null;
      preTokenBalances?: TokenBal[] | null;
      postTokenBalances?: TokenBal[] | null;
      loadedAddresses?: { writable?: string[]; readonly?: string[] } | null;
   };
};

type RawIx = {
   programIdIndex: number;
   accounts?: number[];
   data?: string;
};

type TokenBal = {
   accountIndex: number;
   mint: string;
   uiTokenAmount?: { amount?: string };
};

function u64le(b: Uint8Array, o: number): bigint {
   let n = 0n;
   for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(b[o + i]!);
   return n;
}

function u32le(b: Uint8Array, o: number): number {
   return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

function accountKeysOf(entry: TxEntry): string[] {
   const raw = entry.transaction?.message?.accountKeys ?? [];
   const staticKeys = raw.map((k) => (typeof k === "string" ? k : (k as { pubkey: string }).pubkey));
   const loaded = entry.meta?.loadedAddresses;
   return [...staticKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
}

function tokenAmount(balances: TokenBal[] | null | undefined, index: number, mint: string): bigint {
   const row = balances?.find((b) => b.accountIndex === index && b.mint === mint);
   return BigInt(row?.uiTokenAmount?.amount ?? "0");
}

/** First 12-byte return from each program, in log order. Quote wire is `max_amount: u64` + `odds_scaled: u32`. */
function quoteReturns(logs: string[] | null | undefined): Map<string, Quote> {
   const out = new Map<string, Quote>();
   if (!logs) return out;
   for (const line of logs) {
      if (!line.startsWith("Program return: ")) continue;
      const rest = line.slice("Program return: ".length);
      const sp = rest.indexOf(" ");
      if (sp < 0) continue;
      const program = rest.slice(0, sp);
      if (out.has(program)) continue;
      const bytes = Buffer.from(rest.slice(sp + 1), "base64");
      if (bytes.length !== 12) continue;
      const maxAmount = u64le(bytes, 0);
      const oddsScaled = u32le(bytes, 8);
      if (maxAmount === 0n || oddsScaled === 0) continue;
      out.set(program, { maxAmount, oddsScaled });
   }
   return out;
}

/**
 * Same fill order as the old program: highest odds first, each MM takes up to its quoted max.
 * Effective odds are `payout * ODDS_SCALE / filled`, which equals the quote when one MM fills the stake.
 */
function effectiveOdds(filled: bigint, quotes: Quote[]): number | null {
   if (filled <= 0n || quotes.length === 0) return null;
   const ranked = [...quotes].sort((a, b) => b.oddsScaled - a.oddsScaled);
   let remaining = filled;
   let payout = 0n;
   for (const q of ranked) {
      if (remaining === 0n) break;
      const take = q.maxAmount < remaining ? q.maxAmount : remaining;
      payout += (take * BigInt(q.oddsScaled)) / ODDS_SCALE;
      remaining -= take;
   }
   if (payout === 0n) return null;
   return Number((payout * ODDS_SCALE) / filled);
}

export function parseBet(entry: TxEntry): BetRow | null {
   if (entry.meta?.err) return null;
   const keys = accountKeysOf(entry);
   const ixs = entry.transaction?.message?.instructions ?? [];
   for (const ix of ixs) {
      if (keys[ix.programIdIndex] !== PROGRAM_ID) continue;
      if (!ix.data || !ix.accounts) continue;
      const data = new Uint8Array(b58.encode(ix.data));
      const disc = data[0];
      if (disc === SINGLE_DISC && data.length === SINGLE_LEN) {
         return finish(entry, keys, ix.accounts, data, "single", 1);
      }
      if (disc === PARLAY_DISC && data.length === PARLAY_LEN) {
         return finish(entry, keys, ix.accounts, data, "parlay", data[21]!);
      }
   }
   return null;
}

function finish(
   entry: TxEntry,
   keys: string[],
   accounts: number[],
   data: Uint8Array,
   kind: "single" | "parlay",
   numLegs: number,
): BetRow | null {
   const bettor = keys[accounts[1]!];
   const userAta = accounts[2]!;
   const debit = tokenAmount(entry.meta?.preTokenBalances, userAta, USDC_MINT)
      - tokenAmount(entry.meta?.postTokenBalances, userAta, USDC_MINT);
   const requested = kind === "single" ? u64le(data, 33) : u64le(data, 9);
   const filled = debit > 0n ? debit : requested;
   const minOdds = kind === "single" ? u32le(data, 41) : u32le(data, 17);
   const returns = quoteReturns(entry.meta?.logMessages);
   const mmPrograms = kind === "single" ? singleMmPrograms(keys, accounts) : [keys[accounts[12]!]].filter(Boolean);
   const quotes = mmPrograms.flatMap((id) => {
      const q = id ? returns.get(id) : undefined;
      return q ? [q] : [];
   });
   const odds = effectiveOdds(filled, quotes) ?? (minOdds > 0 ? minOdds : null);
   if (!bettor || odds == null || filled <= 0n) return null;
   const signature = entry.transaction?.signatures?.[0];
   if (!signature || entry.slot == null) return null;
   return {
      signature,
      slot: entry.slot,
      blockTime: entry.blockTime ?? null,
      kind,
      bettor,
      betId: u64le(data, 1).toString(),
      filledAmount: filled,
      oddsScaled: odds,
      numLegs,
   };
}

function singleMmPrograms(keys: string[], accounts: number[]): string[] {
   const ids: string[] = [];
   for (let i = 12; i + 8 < accounts.length; i += 9) {
      const id = keys[accounts[i]!];
      if (id) ids.push(id);
   }
   return ids;
}

function openDb(file: string): Database {
   const db = new Database(file);
   db.run(`
      CREATE TABLE IF NOT EXISTS bets (
         signature TEXT PRIMARY KEY,
         slot INTEGER NOT NULL,
         block_time INTEGER,
         kind TEXT NOT NULL,
         bettor TEXT NOT NULL,
         bet_id TEXT NOT NULL,
         filled_amount TEXT NOT NULL,
         filled_usdc REAL NOT NULL,
         odds_scaled INTEGER NOT NULL,
         decimal_odds REAL NOT NULL,
         num_legs INTEGER NOT NULL
      )
   `);
   db.run(`
      CREATE TABLE IF NOT EXISTS scrape_cursor (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         pagination_token TEXT,
         finished INTEGER NOT NULL DEFAULT 0
      )
   `);
   return db;
}

function rpcUrl(): string {
   if (process.env.HELIUS_RPC_URL) return process.env.HELIUS_RPC_URL;
   const key = process.env.HELIUS_API_KEY;
   if (!key) {
      throw new Error("Set HELIUS_API_KEY or HELIUS_RPC_URL");
   }
   return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

async function rpcCall(url: string, params: unknown): Promise<{ data: TxEntry[]; paginationToken: string | null }> {
   for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(url, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTransactionsForAddress",
            params: [PROGRAM_ID, params],
         }),
      });
      if (res.status === 429 || res.status >= 500) {
         await Bun.sleep(400 * 2 ** attempt);
         continue;
      }
      const json = await res.json() as { result?: { data?: TxEntry[]; paginationToken?: string | null }; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "RPC error");
      return {
         data: json.result?.data ?? [],
         paginationToken: json.result?.paginationToken ?? null,
      };
   }
   throw new Error("getTransactionsForAddress failed after retries");
}

function insertBet(db: Database, row: BetRow) {
   const usdc = Number(row.filledAmount) / 10 ** USDC_DECIMALS;
   const decimal = row.oddsScaled / Number(ODDS_SCALE);
   db.query(`
      INSERT INTO bets (
         signature, slot, block_time, kind, bettor, bet_id,
         filled_amount, filled_usdc, odds_scaled, decimal_odds, num_legs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signature) DO UPDATE SET
         filled_amount = excluded.filled_amount,
         filled_usdc = excluded.filled_usdc,
         odds_scaled = excluded.odds_scaled,
         decimal_odds = excluded.decimal_odds
   `).run(
      row.signature,
      row.slot,
      row.blockTime,
      row.kind,
      row.bettor,
      row.betId,
      row.filledAmount.toString(),
      usdc,
      row.oddsScaled,
      decimal,
      row.numLegs,
   );
}

async function scrape(dbPath: string, pageSize: number, maxPages: number | null) {
   const url = rpcUrl();
   const db = openDb(dbPath);
   const cursor = db.query("SELECT pagination_token, finished FROM scrape_cursor WHERE id = 1").get() as
      | { pagination_token: string | null; finished: number }
      | null;
   if (cursor?.finished) {
      console.log(`Already finished. ${count(db)} bets in ${dbPath}`);
      return;
   }
   let token = cursor?.pagination_token ?? null;
   let pages = 0;
   for (;;) {
      if (maxPages != null && pages >= maxPages) break;
      const page = await rpcCall(url, {
         transactionDetails: "full",
         sortOrder: "desc",
         limit: pageSize,
         encoding: "json",
         maxSupportedTransactionVersion: 0,
         filters: { status: "succeeded" },
         ...(token ? { paginationToken: token } : {}),
      });
      let bets = 0;
      const write = db.transaction((rows: TxEntry[]) => {
         for (const entry of rows) {
            const bet = parseBet(entry);
            if (!bet) continue;
            insertBet(db, bet);
            bets++;
         }
      });
      write(page.data);
      pages++;
      token = page.paginationToken;
      db.query(`
         INSERT INTO scrape_cursor (id, pagination_token, finished) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET pagination_token = excluded.pagination_token, finished = excluded.finished
      `).run(token, token ? 0 : 1);
      console.log(`page ${pages}: ${page.data.length} txs, ${bets} bets, total ${count(db)}`);
      if (!token || page.data.length === 0) break;
      await Bun.sleep(200);
   }
   console.log(`Done. ${count(db)} bets in ${dbPath}`);
}

function count(db: Database): number {
   const row = db.query("SELECT COUNT(*) AS n FROM bets").get() as { n: number };
   return row.n;
}

async function check(files: string[]) {
   for (const file of files) {
      const text = await Bun.file(file).text();
      const json = JSON.parse(text.replace(/^\uFEFF/, ""));
      const bet = parseBet((json.result ?? json) as TxEntry);
      if (!bet) {
         console.log(file, "not a bet");
         continue;
      }
      const usdc = Number(bet.filledAmount) / 10 ** USDC_DECIMALS;
      console.log(
         `${bet.kind} $${usdc} @ ${bet.oddsScaled / Number(ODDS_SCALE)} (${bet.oddsScaled}) legs=${bet.numLegs} bettor=${bet.bettor} sig=${bet.signature}`,
      );
   }
}

function arg(name: string): string | undefined {
   const i = process.argv.indexOf(name);
   return i >= 0 ? process.argv[i + 1] : undefined;
}

const checkAt = process.argv.indexOf("--check");
if (checkAt >= 0) {
   const files = process.argv.slice(checkAt + 1).filter((a) => !a.startsWith("--"));
   await check(files);
} else {
   const out = arg("--out") ?? path.join(__dirname, "mainnet-bets.sqlite");
   const pageSize = Number(arg("--page-size") ?? 100);
   const maxRaw = arg("--max-pages");
   await scrape(out, pageSize, maxRaw ? Number(maxRaw) : null);
}
