import { address, type Address } from "@solana/kit";
import {
   LIVE_CASHOUT_DELAY,
   MAX_NUMBER_OF_MMS,
   MAX_NUMBER_OF_MMS_PROXY,
   MAX_PARLAY_LEGS,
   decodeProxyCashoutQuoteReturnData,
   decodeRfqSignatureBase64,
   getCashoutEscrowData,
   getClaimCashoutEscrowIx,
   getFillCashoutIx,
   getFillParlayCashoutIx,
   getFillRfqParlayCashoutIx,
   getGetCashoutQuoteProxyIx,
   getGetParlayCashoutQuoteProxyIx,
   getMmListData,
   type CashoutEscrowAccountData,
   type ProxyCashoutQuoteData,
   type RfqCashoutHttpRequestJson,
   type RfqCashoutQuoteJson,
} from "spamm-aggregator-sdk";
import { rpc, simulateReturnData } from "../chain/rpc";
import { nextBetId } from "../chain/ids";
import { LABS_DOMAIN } from "../network";
import { MINT } from "../network";
import { sendInstructions } from "../wallet/send";
import { feePayerFor } from "../wallet/solFree";
import type { BotWallet } from "../wallet/privy";
import { rowAmount, type WalletBetRow } from "./bets";

function bestQuote(quotes: readonly ProxyCashoutQuoteData[]): ProxyCashoutQuoteData | null {
   const ok = quotes.filter((quote) => quote.maxPayment > 0n);
   if (ok.length === 0) {
      return null;
   }
   return [...ok].sort((a, b) => (b.maxPayment > a.maxPayment ? 1 : b.maxPayment < a.maxPayment ? -1 : 0))[0]!;
}

function minPayout(maxPayment: bigint): bigint {
   if (maxPayment <= 1n) {
      return maxPayment > 0n ? maxPayment : 1n;
   }
   const floor = (maxPayment * 99n) / 100n;
   return floor < 1n ? 1n : floor;
}

export function cashoutUsesRfq(row: WalletBetRow): boolean {
   return row.kind === "parlay" && row.account.numLegs > MAX_PARLAY_LEGS;
}

export async function quoteCashout(user: Address, row: WalletBetRow, amount: bigint): Promise<{ maxPayment: bigint; fillingMm: Address; mmPrograms: Address[] }> {
   const list = await getMmListData(rpc);
   const programs = list.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);
   if (programs.length === 0) {
      throw new Error("No market makers registered");
   }
   if (amount <= 0n || amount > rowAmount(row)) {
      throw new Error("Invalid cashout amount");
   }
   const feePayer = await feePayerFor(user);
   if (row.kind === "single") {
      const bet = row.data;
      const ix = await getGetCashoutQuoteProxyIx({
         origBetId: bet.betId,
         cashoutId: 1n,
         amount,
         minPayout: 0n,
         eventStateSequence: bet.eventStateSequence,
         eventGameState: bet.eventGameState,
      }, user, bet.marketId, programs);
      const data = await simulateReturnData(ix, feePayer);
      const best = data == null ? null : bestQuote(decodeProxyCashoutQuoteReturnData(data));
      if (best == null) {
         throw new Error("No cashout quote");
      }
      const ordered = [best.mmAddress, ...programs.filter((mm) => mm !== best.mmAddress)];
      return { maxPayment: best.maxPayment, fillingMm: best.mmAddress, mmPrograms: ordered.slice(0, MAX_NUMBER_OF_MMS) };
   }
   const parlay = row.account;
   const snapshots = parlay.legs.slice(0, parlay.numLegs).map((leg) => ({
      eventStateSequence: leg.eventStateSequence,
      eventGameState: leg.eventGameState,
   }));
   const ix = await getGetParlayCashoutQuoteProxyIx({
      origBetId: parlay.betId,
      cashoutId: 1n,
      amount,
      minPayout: 0n,
      numLegs: parlay.numLegs,
      snapshots,
   }, user, parlay.legs.slice(0, parlay.numLegs).map((leg) => ({ marketId: leg.marketId })), programs);
   const data = await simulateReturnData(ix, feePayer);
   const best = data == null ? null : bestQuote(decodeProxyCashoutQuoteReturnData(data));
   if (best == null) {
      throw new Error("No cashout quote");
   }
   return { maxPayment: best.maxPayment, fillingMm: best.mmAddress, mmPrograms: [best.mmAddress] };
}

export async function fillCashout(wallet: BotWallet, row: WalletBetRow, amount: bigint, quote: { maxPayment: bigint; fillingMm: Address; mmPrograms: Address[] }): Promise<string> {
   const feePayer = await feePayerFor(wallet.address);
   const cashoutId = nextBetId();
   const floor = minPayout(quote.maxPayment);
   if (row.kind === "single") {
      const bet = row.data;
      const ix = await getFillCashoutIx({
         origBetId: bet.betId,
         cashoutId,
         amount,
         minPayout: floor,
         eventStateSequence: bet.eventStateSequence,
         eventGameState: bet.eventGameState,
      }, feePayer, bet, bet.marketId, quote.fillingMm, quote.mmPrograms);
      return String(await sendInstructions(wallet, [ix]));
   }
   const parlay = row.account;
   const snapshots = parlay.legs.slice(0, parlay.numLegs).map((leg) => ({
      eventStateSequence: leg.eventStateSequence,
      eventGameState: leg.eventGameState,
   }));
   const ix = await getFillParlayCashoutIx({
      origBetId: parlay.betId,
      cashoutId,
      amount,
      minPayout: floor,
      numLegs: parlay.numLegs,
      snapshots,
   }, feePayer, parlay, parlay.legs.slice(0, parlay.numLegs).map((leg) => leg.marketId), quote.fillingMm);
   return String(await sendInstructions(wallet, [ix]));
}

async function rfqCashout(user: Address, row: WalletBetRow, amount: bigint): Promise<{ quote: RfqCashoutQuoteJson; cashoutId: bigint }> {
   if (row.kind !== "parlay") {
      throw new Error("RFQ cashout is for long parlays");
   }
   const parlay = row.account;
   const cashoutId = nextBetId();
   const snapshots = parlay.legs.slice(0, parlay.numLegs).map((leg) => ({
      eventStateSequence: leg.eventStateSequence,
      eventGameState: leg.eventGameState,
   }));
   const body: RfqCashoutHttpRequestJson = {
      user: String(user),
      origBetId: parlay.betId.toString(),
      cashoutId: cashoutId.toString(),
      amount: amount.toString(),
      minPayout: "0",
      snapshots,
   };
   const res = await fetch(`${LABS_DOMAIN}/api/rfq/cashout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
   });
   if (!res.ok) {
      throw new Error((await res.text()) || "RFQ cashout failed");
   }
   const data = (await res.json()) as { quotes?: RfqCashoutQuoteJson[]; mmCount?: number };
   const quote = [...(data.quotes ?? [])].sort((a, b) => (BigInt(b.maxPayment) > BigInt(a.maxPayment) ? 1 : -1))[0];
   if (quote == null || BigInt(quote.maxPayment) <= 0n) {
      throw new Error(data.mmCount === 0 ? "No RFQ market makers connected" : "No RFQ cashout quote");
   }
   return { quote, cashoutId };
}

export async function fillRfqCashout(wallet: BotWallet, row: WalletBetRow, amount: bigint): Promise<{ signature: string; maxPayment: bigint }> {
   if (row.kind !== "parlay") {
      throw new Error("RFQ cashout is for long parlays");
   }
   const { quote, cashoutId } = await rfqCashout(wallet.address, row, amount);
   const maxPayment = BigInt(quote.maxPayment);
   const parlay = row.account;
   const snapshots = parlay.legs.slice(0, parlay.numLegs).map((leg) => ({
      eventStateSequence: leg.eventStateSequence,
      eventGameState: leg.eventGameState,
   }));
   const feePayer = await feePayerFor(wallet.address);
   const ix = await getFillRfqParlayCashoutIx({
      origBetId: parlay.betId,
      cashoutId,
      amount,
      minPayout: minPayout(maxPayment),
      maxPayment,
      offerExpiry: quote.offerExpiry,
      numLegs: parlay.numLegs,
      snapshots,
      signature: decodeRfqSignatureBase64(quote.signature),
   }, feePayer, parlay, parlay.legs.slice(0, parlay.numLegs).map((leg) => leg.marketId), address(quote.mmProgramId));
   const signature = String(await sendInstructions(wallet, [ix]));
   return { signature, maxPayment };
}

export async function loadEscrow(user: Address, origBetId: bigint): Promise<CashoutEscrowAccountData | null> {
   try {
      return await getCashoutEscrowData(rpc, { user, origBetId });
   } catch {
      return null;
   }
}

export function escrowReady(escrow: CashoutEscrowAccountData, now = Math.floor(Date.now() / 1000)): boolean {
   return now >= escrow.timestamp + LIVE_CASHOUT_DELAY;
}

export async function claimEscrow(wallet: BotWallet, escrow: CashoutEscrowAccountData, ticketFeepayer: Address): Promise<string> {
   const feePayer = await feePayerFor(wallet.address);
   const ix = await getClaimCashoutEscrowIx(feePayer, escrow, { feepayer: ticketFeepayer }, MINT);
   return String(await sendInstructions(wallet, [ix]));
}
