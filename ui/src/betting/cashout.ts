import type { Address, Rpc, SolanaRpcApi, TransactionSigner } from "@solana/kit";
import {
   BetResult,
   LIVE_CASHOUT_DELAY,
   MAX_NUMBER_OF_MMS,
   MAX_NUMBER_OF_MMS_PROXY,
   MAX_PARLAY_LEGS,
   cashoutRequiresDelay,
   decodeProxyCashoutQuoteReturnData,
   decodeRfqSignatureBase64,
   getCashoutEscrowData,
   getClaimCashoutEscrowIx,
   getFillCashoutIx,
   getFillParlayCashoutIx,
   getFillRfqParlayCashoutIx,
   getGetCashoutQuoteProxyIx,
   getGetParlayCashoutQuoteProxyIx,
   parlayCashoutRequiresDelay,
   type CashoutEscrowAccountData,
   type FillRfqParlayCashoutIxData,
   type ParlayBetAccountData,
   type ProxyCashoutQuoteData,
   type RfqCashoutHttpRequestJson,
   type RfqCashoutHttpResponseJson,
   type RfqCashoutQuoteJson,
} from "spamm-aggregator-sdk";
import { getMmListCached } from "./mmCache";
import { nextBetId } from "./nextBetId";
import { resolveUserTxFeePayer, signUserInstructions, simulateInstructionReturnData } from "./txPipeline";
import type { WalletBetRow } from "../markets/fetchBetHistory";
import { LABS_DOMAIN } from "../network";

type SignedV1Tx = Awaited<ReturnType<typeof signUserInstructions>>;

export function walletRowFreebetId(row: WalletBetRow): number {
   if (row.kind === "single") {
      return row.data.promoType === 1 ? 1 : 0;
   }
   const type = row.promoType ?? row.account?.promoType ?? 0;
   return type === 1 ? 1 : 0;
}

export function canCashoutRow(row: WalletBetRow): boolean {
   if (row.kind === "single") {
      return row.data.result === BetResult.Pending && row.data.promoType === 0;
   }
   if (row.result !== BetResult.Pending) {
      return false;
   }
   if ((row.promoType ?? row.account?.promoType ?? 0) !== 0) {
      return false;
   }
   return row.account != null;
}

export function cashoutUsesRfq(row: WalletBetRow): boolean {
   if (row.kind === "single") {
      return false;
   }
   return row.legs.length > MAX_PARLAY_LEGS;
}

export function ticketAmountOfRow(row: WalletBetRow): bigint {
   return row.kind === "single" ? row.data.amount : row.amount;
}

function minPayoutFromQuote(maxPayment: bigint): bigint {
   if (maxPayment <= 1n) {
      return maxPayment > 0n ? maxPayment : 1n;
   }
   const floor = (maxPayment * 99n) / 100n;
   return floor < 1n ? 1n : floor;
}

function bestCashoutQuote(quotes: readonly ProxyCashoutQuoteData[]): ProxyCashoutQuoteData | null {
   const ok = quotes.filter((q) => q.maxPayment > 0n);
   if (ok.length === 0) {
      return null;
   }
   return [...ok].sort((a, b) => (b.maxPayment > a.maxPayment ? 1 : b.maxPayment < a.maxPayment ? -1 : 0))[0]!;
}

export async function quoteAuctionCashout(params: {
   rpc: Rpc<SolanaRpcApi>;
   user: Address;
   row: WalletBetRow;
   amount: bigint;
}): Promise<{ maxPayment: bigint; fillingMm: Address; mmPrograms: Address[] }> {
   const mmList = await getMmListCached(params.rpc);
   const mmPrograms = mmList.mmProgramAddresses.slice(0, MAX_NUMBER_OF_MMS_PROXY);
   if (mmPrograms.length === 0) {
      throw new Error("No market makers registered");
   }
   const origAmount = ticketAmountOfRow(params.row);
   if (params.amount <= 0n || params.amount > origAmount) {
      throw new Error("Invalid cashout amount");
   }
   const cashoutId = 1n;
   const minPayout = 0n;

   if (params.row.kind === "single") {
      const bet = params.row.data;
      const ix = await getGetCashoutQuoteProxyIx(
         {
            origBetId: bet.betId,
            cashoutId,
            amount: params.amount,
            minPayout,
            eventStateSequence: bet.eventStateSequence,
            eventGameState: bet.eventGameState,
         },
         params.user,
         bet.marketId,
         mmPrograms,
      );
      const feePayer = await resolveUserTxFeePayer(params.rpc, params.user);
      const ret = await simulateInstructionReturnData(params.rpc, ix, feePayer);
      if (ret == null || ret.length === 0) {
         throw new Error("No cashout quote");
      }
      const best = bestCashoutQuote(decodeProxyCashoutQuoteReturnData(ret));
      if (best == null) {
         throw new Error("No cashout quote");
      }
      const fillMms = mmPrograms.filter((m) => m === best.mmAddress).concat(mmPrograms.filter((m) => m !== best.mmAddress));
      return {
         maxPayment: best.maxPayment,
         fillingMm: best.mmAddress,
         mmPrograms: fillMms.slice(0, MAX_NUMBER_OF_MMS),
      };
   }

   const parlay = params.row.account;
   if (parlay == null) {
      throw new Error("Parlay account missing");
   }
   const snapshots = parlay.legs.map((leg) => ({
      eventStateSequence: leg.eventStateSequence,
      eventGameState: leg.eventGameState,
   }));
   const ix = await getGetParlayCashoutQuoteProxyIx(
      {
         origBetId: parlay.betId,
         cashoutId,
         amount: params.amount,
         minPayout,
         numLegs: parlay.numLegs,
         snapshots,
      },
      params.user,
      parlay.legs.map((leg) => ({ marketId: leg.marketId })),
      mmPrograms,
   );
   const feePayer = await resolveUserTxFeePayer(params.rpc, params.user);
   const ret = await simulateInstructionReturnData(params.rpc, ix, feePayer);
   if (ret == null || ret.length === 0) {
      throw new Error("No cashout quote");
   }
   const best = bestCashoutQuote(decodeProxyCashoutQuoteReturnData(ret));
   if (best == null) {
      throw new Error("No cashout quote");
   }
   return { maxPayment: best.maxPayment, fillingMm: best.mmAddress, mmPrograms: [best.mmAddress] };
}

export async function buildSignAuctionCashoutTx(params: {
   rpc: Rpc<SolanaRpcApi>;
   walletSigner: TransactionSigner;
   user: Address;
   row: WalletBetRow;
   fillingMm: Address;
   mmPrograms: readonly Address[];
   maxPayment: bigint;
   amount: bigint;
}): Promise<SignedV1Tx> {
   const feePayer = await resolveUserTxFeePayer(params.rpc, params.walletSigner.address);
   const cashoutId = nextBetId();
   const minPayout = minPayoutFromQuote(params.maxPayment);
   if (params.row.kind === "single") {
      const bet = params.row.data;
      const ix = await getFillCashoutIx(
         {
            origBetId: bet.betId,
            cashoutId,
            amount: params.amount,
            minPayout,
            eventStateSequence: bet.eventStateSequence,
            eventGameState: bet.eventGameState,
         },
         feePayer,
         bet,
         bet.marketId,
         params.fillingMm,
         [...params.mmPrograms],
      );
      return signUserInstructions(params.rpc, {
         walletSigner: params.walletSigner,
         feePayer,
         instructions: [ix],
      });
   }
   const parlay = params.row.account;
   if (parlay == null) {
      throw new Error("Parlay account missing");
   }
   const snapshots = parlay.legs.map((leg) => ({
      eventStateSequence: leg.eventStateSequence,
      eventGameState: leg.eventGameState,
   }));
   const ix = await getFillParlayCashoutIx(
      {
         origBetId: parlay.betId,
         cashoutId,
         amount: params.amount,
         minPayout,
         numLegs: parlay.numLegs,
         snapshots,
      },
      feePayer,
      parlay,
      parlay.legs.map((leg) => leg.marketId),
      params.fillingMm,
   );
   return signUserInstructions(params.rpc, {
      walletSigner: params.walletSigner,
      feePayer,
      instructions: [ix],
   });
}

function pickBestRfqCashoutQuote(quotes: readonly RfqCashoutQuoteJson[]): RfqCashoutQuoteJson | null {
   const ok = quotes.filter((q) => {
      try {
         return BigInt(q.maxPayment) > 0n;
      } catch {
         return false;
      }
   });
   if (ok.length === 0) {
      return null;
   }
   return [...ok].sort((a, b) => {
      const d = BigInt(b.maxPayment) - BigInt(a.maxPayment);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
   })[0]!;
}

export async function requestRfqCashoutQuotes(body: RfqCashoutHttpRequestJson): Promise<RfqCashoutHttpResponseJson> {
   const res = await fetch(`${LABS_DOMAIN}/api/rfq/cashout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
   });
   if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `${res.status} ${res.statusText}`);
   }
   return (await res.json()) as RfqCashoutHttpResponseJson;
}

export async function quoteRfqParlayCashout(params: {
   user: Address;
   parlay: ParlayBetAccountData;
   amount: bigint;
}): Promise<{ maxPayment: bigint }> {
   if (params.amount <= 0n || params.amount > params.parlay.amount) {
      throw new Error("Invalid cashout amount");
   }
   const cashoutId = nextBetId();
   const snapshots = params.parlay.legs.map((leg) => ({
      eventStateSequence: leg.eventStateSequence,
      eventGameState: leg.eventGameState,
   }));
   const body: RfqCashoutHttpRequestJson = {
      user: String(params.user),
      origBetId: params.parlay.betId.toString(),
      cashoutId: cashoutId.toString(),
      amount: params.amount.toString(),
      minPayout: "0",
      snapshots,
   };
   const res = await requestRfqCashoutQuotes(body);
   const quote = pickBestRfqCashoutQuote(res.quotes);
   if (quote == null) {
      throw new Error(res.mmCount === 0 ? "No RFQ market makers connected" : "No RFQ cashout quote");
   }
   return { maxPayment: BigInt(quote.maxPayment) };
}

export async function quoteAndSignRfqParlayCashout(params: {
   rpc: Rpc<SolanaRpcApi>;
   walletSigner: TransactionSigner;
   user: Address;
   parlay: ParlayBetAccountData;
   amount: bigint;
}): Promise<{ signed: SignedV1Tx; maxPayment: bigint }> {
   if (params.amount <= 0n || params.amount > params.parlay.amount) {
      throw new Error("Invalid cashout amount");
   }
   const cashoutId = nextBetId();
   const snapshots = params.parlay.legs.map((leg) => ({
      eventStateSequence: leg.eventStateSequence,
      eventGameState: leg.eventGameState,
   }));
   const body: RfqCashoutHttpRequestJson = {
      user: String(params.user),
      origBetId: params.parlay.betId.toString(),
      cashoutId: cashoutId.toString(),
      amount: params.amount.toString(),
      minPayout: "0",
      snapshots,
   };
   const res = await requestRfqCashoutQuotes(body);
   const quote = pickBestRfqCashoutQuote(res.quotes);
   if (quote == null) {
      throw new Error(res.mmCount === 0 ? "No RFQ market makers connected" : "No RFQ cashout quote");
   }
   const maxPayment = BigInt(quote.maxPayment);
   const minPayout = minPayoutFromQuote(maxPayment);
   const feePayer = await resolveUserTxFeePayer(params.rpc, params.walletSigner.address);
   const fill: FillRfqParlayCashoutIxData = {
      origBetId: params.parlay.betId,
      cashoutId,
      amount: params.amount,
      minPayout,
      maxPayment,
      offerExpiry: quote.offerExpiry,
      numLegs: params.parlay.numLegs,
      snapshots,
      signature: decodeRfqSignatureBase64(quote.signature),
   };
   const ix = await getFillRfqParlayCashoutIx(
      fill,
      feePayer,
      params.parlay,
      params.parlay.legs.map((leg) => leg.marketId),
      quote.mmProgramId as Address,
   );
   const signed = await signUserInstructions(params.rpc, {
      walletSigner: params.walletSigner,
      feePayer,
      instructions: [ix],
   });
   return { signed, maxPayment };
}

export function cashoutNeedsDelay(row: WalletBetRow): boolean {
   if (row.kind === "single") {
      return cashoutRequiresDelay(row.data.marketId.isPregame, row.data.eventStateSequence, row.data.eventStateSequence);
   }
   const parlay = row.account;
   if (parlay == null) {
      return true;
   }
   const snaps = parlay.legs.map((leg) => ({
      eventStateSequence: leg.eventStateSequence,
      eventGameState: leg.eventGameState,
   }));
   return parlayCashoutRequiresDelay(parlay.legs, snaps);
}

export async function loadEscrowForOrigBet(
   rpc: Rpc<SolanaRpcApi>,
   user: Address,
   origBetId: bigint,
): Promise<CashoutEscrowAccountData | null> {
   try {
      return await getCashoutEscrowData(rpc, { user, origBetId });
   } catch {
      return null;
   }
}

export function escrowClaimReady(escrow: CashoutEscrowAccountData, nowUnix: number = Math.floor(Date.now() / 1000)): boolean {
   return nowUnix >= escrow.timestamp + LIVE_CASHOUT_DELAY;
}

export async function buildSignClaimCashoutTx(params: {
   rpc: Rpc<SolanaRpcApi>;
   walletSigner: TransactionSigner;
   escrow: CashoutEscrowAccountData;
   ticketFeepayer: Address;
   mint: Address;
}): Promise<SignedV1Tx> {
   const feePayer = await resolveUserTxFeePayer(params.rpc, params.walletSigner.address);
   const ix = await getClaimCashoutEscrowIx(feePayer, params.escrow, {
      feepayer: params.ticketFeepayer,
   }, params.mint);
   return signUserInstructions(params.rpc, {
      walletSigner: params.walletSigner,
      feePayer,
      instructions: [ix],
   });
}

export function origBetIdOfRow(row: WalletBetRow): bigint {
   return row.kind === "single" ? row.data.betId : row.betId;
}

export function ticketFeepayerOfRow(row: WalletBetRow): Address {
   if (row.kind === "single") {
      return row.data.feepayer;
   }
   if (row.account == null) {
      throw new Error("Parlay account missing");
   }
   return row.account.feepayer;
}
