import { address, type Address, type Rpc, type SolanaRpcApi } from "@solana/kit";
import {
   BetResult,
   ODDS_SCALE,
   SYSTEM_PROGRAM_ID,
   decodeAggregatorInstructionData,
   getBetData,
   getCashoutData,
   getCashoutEscrowData,
   getCashoutParlayData,
   getParlayData,
   type AggregatorInstructionData,
   type BetAccountData,
   type CashoutAccountData,
   type CashoutEscrowAccountData,
   type CashoutParlayAccountData,
   type FillBetIxData,
   type FillParlayIxData,
   type FillRfqBetIxData,
   type FillRfqParlayIxData,
   type ParlayBetAccountData,
   type ParlayLegQuoted,
} from "spamm-aggregator-sdk";
import { withRpcRetry } from "../aggregator/client/txSendV1";
import {
   addBetAccount,
   addCashoutAccount,
   addCashoutEscrowAccount,
   applyOrigBetCashoutFill,
   escrowPaymentForAddress,
   fillersFromBetAccount,
   isAccountNotFound,
   isInstructionApplied,
   listUnresolvedBets,
   listUnresolvedCashouts,
   listUnresolvedEscrows,
   marketOperatorAndMint,
   noteUnresolvedAttempt,
   refreshBetFromChain,
   refreshCashoutFromChain,
   refreshEscrowFromChain,
   revertBetCashout,
   selectionFromMarketId,
   selectionFromParlayLeg,
   updateBetAccountCashedOut,
   updateBetOrCashoutAccountResult,
   updateBetOrCashoutAccountSettled,
   updateCashoutAccountReverted,
   updateCashoutEscrowClaimed,
   updateCashoutEscrowReverted,
   updateParlayOrCashoutAccountResult,
   withInstructionWrite,
   type Selection,
   type UpdateMeta,
} from "./indexerDb";

const CASHOUT_IX_MINT_INDEX = 11;

export type IndexedInstruction = {
   ixIndex: number;
   accounts: Address[];
   data: Uint8Array;
};

export type IndexedTxContext = {
   signature: string;
   slot: number;
   blockTime: number;
   meta: unknown;
};

export const V1_FROM_SLOT = 517875938n;

function ticketOddsScaled(amount: bigint, payout: bigint, fallback: bigint): bigint {
   if (fallback > 0n) {
      return fallback;
   }
   if (amount <= 0n || payout <= 0n) {
      return 0n;
   }
   return (payout * ODDS_SCALE) / amount;
}

function isFreebetFillKind(kind: AggregatorInstructionData["kind"]): boolean {
   return kind === "freebetFillBet"
      || kind === "freebetFillRfqBet"
      || kind === "freebetFillParlay"
      || kind === "freebetFillRfqParlay";
}

function isBoostFillKind(kind: AggregatorInstructionData["kind"]): boolean {
   return kind === "boostedFillBet"
      || kind === "boostedFillRfqBet"
      || kind === "boostedFillParlay"
      || kind === "boostedFillRfqParlay";
}

function fillBetPdaIndex(kind: AggregatorInstructionData["kind"]): number {
   if (isBoostFillKind(kind)) {
      return 6;
   }
   return isFreebetFillKind(kind) ? 5 : 3;
}

function promoFromFill(decoded: AggregatorInstructionData): { promoType: number; promoId: number } {
   if (isFreebetFillKind(decoded.kind) && "freebetId" in decoded) {
      return { promoType: 1, promoId: decoded.freebetId };
   }
   if (isBoostFillKind(decoded.kind) && "boostId" in decoded) {
      return { promoType: 2, promoId: decoded.boostId };
   }
   return { promoType: 0, promoId: 0 };
}

function parseUiTokenAmount(raw: unknown): bigint {
   if (raw == null || typeof raw !== "object") {
      return 0n;
   }
   const amount = (raw as { amount?: unknown }).amount;
   if (typeof amount === "string" || typeof amount === "number" || typeof amount === "bigint") {
      try {
         return BigInt(amount);
      } catch {
         return 0n;
      }
   }
   return 0n;
}

function tokenIncreaseForOwner(meta: unknown, owner: string, mint: string): number | null {
   if (meta == null || typeof meta !== "object") {
      return null;
   }
   const rec = meta as { preTokenBalances?: unknown; postTokenBalances?: unknown };
   const pre = Array.isArray(rec.preTokenBalances) ? rec.preTokenBalances : [];
   const post = Array.isArray(rec.postTokenBalances) ? rec.postTokenBalances : [];
   let preAmt = 0n;
   let postAmt = 0n;
   for (const item of pre) {
      if (item == null || typeof item !== "object") {
         continue;
      }
      const row = item as { owner?: string; mint?: string; uiTokenAmount?: unknown };
      if (row.owner !== owner || row.mint !== mint) {
         continue;
      }
      preAmt += parseUiTokenAmount(row.uiTokenAmount);
   }
   for (const item of post) {
      if (item == null || typeof item !== "object") {
         continue;
      }
      const row = item as { owner?: string; mint?: string; uiTokenAmount?: unknown };
      if (row.owner !== owner || row.mint !== mint) {
         continue;
      }
      postAmt += parseUiTokenAmount(row.uiTokenAmount);
   }
   const delta = postAmt - preAmt;
   return delta > 0n ? Number(delta) : null;
}

function accountAt(accounts: readonly Address[], index: number): Address | null {
   return accounts[index] ?? null;
}

async function readBet(
   rpc: Rpc<SolanaRpcApi>,
   betPda: Address,
): Promise<{ account: BetAccountData } | { error: unknown }> {
   try {
      return { account: await withRpcRetry(() => getBetData(rpc, betPda)) };
   } catch (error) {
      return { error };
   }
}

export async function applyV1Instruction(
   rpc: Rpc<SolanaRpcApi>,
   ix: IndexedInstruction,
   ctx: IndexedTxContext,
): Promise<void> {
   if (isInstructionApplied(ctx.signature, ix.ixIndex)) {
      return;
   }
   let decoded: AggregatorInstructionData;
   try {
      decoded = decodeAggregatorInstructionData(ix.data);
   } catch (error) {
      console.error("Error decoding instruction:", error, "sig:", ctx.signature);
      withInstructionWrite(ctx.signature, ix.ixIndex, () => {});
      return;
   }
   const commit = await prepareV1(rpc, decoded, ix, ctx);
   if (commit == null) {
      return;
   }
   withInstructionWrite(ctx.signature, ix.ixIndex, commit);
}

async function prepareV1(
   rpc: Rpc<SolanaRpcApi>,
   decoded: AggregatorInstructionData,
   ix: IndexedInstruction,
   ctx: IndexedTxContext,
): Promise<(() => void) | null> {
   const meta: UpdateMeta = {
      createdAt: ctx.blockTime,
      createdSig: ctx.signature,
      lastUpdateSlot: ctx.slot,
   };
   const userAddress = accountAt(ix.accounts, 1);
   const userOwner = accountAt(ix.accounts, 2);
   const noop = () => {};

   if (
      decoded.kind === "fillBet"
      || decoded.kind === "fillRfqBet"
      || decoded.kind === "freebetFillBet"
      || decoded.kind === "freebetFillRfqBet"
      || decoded.kind === "boostedFillBet"
      || decoded.kind === "boostedFillRfqBet"
   ) {
      const data = decoded.data;
      const betPda = accountAt(ix.accounts, fillBetPdaIndex(decoded.kind));
      if (betPda == null || userAddress == null) {
         console.error("fill bet missing accounts", ctx.signature);
         return noop;
      }
      let betAccount: BetAccountData;
      let oddsScaled = 0n;
      let fromChain = true;
      const loaded = await readBet(rpc, betPda);
      if ("account" in loaded) {
         betAccount = loaded.account;
      } else {
         fromChain = false;
         if (decoded.kind === "fillRfqBet" || decoded.kind === "freebetFillRfqBet" || decoded.kind === "boostedFillRfqBet") {
            oddsScaled = (decoded.data as FillRfqBetIxData).oddsScaled;
         } else {
            oddsScaled = (decoded.data as FillBetIxData).minOddsScaled;
         }
         betAccount = {
            betId: data.betId,
            discriminator: 1,
            bump: 0,
            owner: userAddress,
            feepayer: accountAt(ix.accounts, 0) ?? SYSTEM_PROGRAM_ID,
            marketId: data.marketId,
            amount: data.amount,
            timestamp: ctx.blockTime,
            payout: data.amount * oddsScaled / ODDS_SCALE,
            result: BetResult.Pending,
            side: data.side,
            eventStateSequence: data.eventStateSequence,
            eventGameState: data.eventGameState,
            numFillers: 0,
            fillers: [],
            promoType: promoFromFill(decoded).promoType,
            promoAccount: SYSTEM_PROGRAM_ID,
         };
      }
      const filledOdds = ticketOddsScaled(betAccount.amount, betAccount.payout, oddsScaled);
      const promo = promoFromFill(decoded);
      const selections = [selectionFromMarketId(
         betAccount.marketId,
         betAccount.side,
         betAccount.eventStateSequence,
         betAccount.eventGameState,
         filledOdds > 0n ? filledOdds : null,
      )];
      return () => {
         addBetAccount(
            betPda,
            userAddress,
            "single",
            betAccount.betId,
            selections,
            data.amount,
            betAccount.amount,
            filledOdds,
            betAccount.payout,
            betAccount.timestamp,
            meta,
            promo.promoId,
            betAccount.promoType || promo.promoType,
            fromChain,
            fillersFromBetAccount(betAccount.fillers),
         );
      };
   }

   if (
      decoded.kind === "fillParlay"
      || decoded.kind === "fillRfqParlay"
      || decoded.kind === "freebetFillParlay"
      || decoded.kind === "freebetFillRfqParlay"
      || decoded.kind === "boostedFillParlay"
      || decoded.kind === "boostedFillRfqParlay"
   ) {
      const betPda = accountAt(ix.accounts, fillBetPdaIndex(decoded.kind));
      if (betPda == null || userAddress == null) {
         console.error("fill parlay missing accounts", ctx.signature);
         return noop;
      }
      let parlayAccount: ParlayBetAccountData;
      let oddsScaled = 0n;
      let fromChain = true;
      try {
         parlayAccount = await withRpcRetry(() => getParlayData(rpc, betPda));
      } catch {
         fromChain = false;
         if (decoded.kind === "fillRfqParlay" || decoded.kind === "freebetFillRfqParlay" || decoded.kind === "boostedFillRfqParlay") {
            oddsScaled = (decoded.data as FillRfqParlayIxData).oddsScaled;
         } else {
            oddsScaled = (decoded.data as FillParlayIxData).minOddsScaled;
         }
         parlayAccount = {
            betId: decoded.data.betId,
            discriminator: 2,
            bump: 0,
            owner: userAddress,
            feepayer: accountAt(ix.accounts, 0) ?? SYSTEM_PROGRAM_ID,
            amount: decoded.data.amount,
            payout: decoded.data.amount * oddsScaled / ODDS_SCALE,
            timestamp: ctx.blockTime,
            result: BetResult.Pending,
            fillerAddress: SYSTEM_PROGRAM_ID,
            numLegs: decoded.data.numLegs,
            legs: decoded.data.legs.map((leg) => ({
               result: BetResult.Pending,
               oddsScaled: (leg as ParlayLegQuoted).oddsScaled ?? undefined,
               eventStateSequence: leg.eventStateSequence ?? undefined,
               eventGameState: leg.eventGameState ?? undefined,
               marketId: leg.marketId,
               side: leg.side,
            })),
            promoType: promoFromFill(decoded).promoType,
            promoAccount: SYSTEM_PROGRAM_ID,
         };
      }
      const activeLegs = parlayAccount.legs.slice(0, parlayAccount.numLegs);
      const promo = promoFromFill(decoded);
      const amount = decoded.data.amount;
      return () => {
         addBetAccount(
            betPda,
            userAddress,
            "parlay",
            parlayAccount.betId,
            activeLegs.map(selectionFromParlayLeg),
            amount,
            parlayAccount.amount,
            ticketOddsScaled(parlayAccount.amount, parlayAccount.payout, oddsScaled),
            parlayAccount.payout,
            parlayAccount.timestamp,
            meta,
            promo.promoId,
            parlayAccount.promoType || promo.promoType,
            fromChain,
         );
      };
   }

   if (decoded.kind === "fillCashout" || decoded.kind === "fillRfqCashout") {
      return prepareSingleCashout(rpc, decoded, ix, ctx, meta, userOwner);
   }

   if (decoded.kind === "fillParlayCashout" || decoded.kind === "fillRfqParlayCashout") {
      return prepareParlayCashout(rpc, decoded, ix, ctx, meta, userOwner);
   }

   if (decoded.kind === "gradeBets") {
      const results = decoded.betResults;
      return () => {
         for (let i = 0; i < results.length; i++) {
            const ticketAddress = accountAt(ix.accounts, 2 + i);
            if (ticketAddress == null) {
               continue;
            }
            updateBetOrCashoutAccountResult(ticketAddress, results[i]! as BetResult, ctx.blockTime, ctx.signature, ctx.slot);
         }
      };
   }

   if (decoded.kind === "gradeParlay") {
      const parlayAddress = accountAt(ix.accounts, 2);
      const mask = decoded.legGradeMask;
      return () => {
         if (parlayAddress == null) {
            return;
         }
         updateParlayOrCashoutAccountResult(parlayAddress, mask, ctx.slot, ctx.blockTime, ctx.signature);
      };
   }

   if (
      decoded.kind === "settleBet"
      || decoded.kind === "settleFreebet"
      || decoded.kind === "settleBoostedBet"
      || decoded.kind === "settleParlay"
      || decoded.kind === "settleFreebetParlay"
      || decoded.kind === "settleBoostedParlay"
   ) {
      const ticketAddress = accountAt(ix.accounts, 1);
      return () => {
         if (ticketAddress == null) {
            return;
         }
         updateBetOrCashoutAccountSettled(ticketAddress, ctx.blockTime, ctx.signature, ctx.slot);
      };
   }

   if (decoded.kind === "claimCashoutEscrow") {
      const escrowAddress = accountAt(ix.accounts, 5);
      const originalBetAddress = accountAt(ix.accounts, 7);
      return () => {
         if (escrowAddress == null || originalBetAddress == null) {
            return;
         }
         updateCashoutEscrowClaimed(escrowAddress, ctx.blockTime, ctx.signature, ctx.slot);
         updateBetAccountCashedOut(
            originalBetAddress,
            ctx.blockTime,
            ctx.signature,
            ctx.slot,
            escrowPaymentForAddress(escrowAddress),
         );
      };
   }

   if (decoded.kind === "revertCashout") {
      const escrowAddress = accountAt(ix.accounts, 8);
      const originalBetAddress = accountAt(ix.accounts, 4);
      const cashoutAddress = accountAt(ix.accounts, 6);
      return () => {
         if (escrowAddress != null) {
            updateCashoutEscrowReverted(escrowAddress, ctx.blockTime, ctx.signature, ctx.slot);
         }
         if (cashoutAddress != null) {
            updateCashoutAccountReverted(cashoutAddress, ctx.blockTime, ctx.signature, ctx.slot);
         }
         if (originalBetAddress != null) {
            revertBetCashout(originalBetAddress, ctx.slot);
         }
      };
   }

   return noop;
}

async function readCashoutAccount<T>(
   load: () => Promise<T>,
   signature: string,
   label: string,
): Promise<T | null> {
   try {
      return await withRpcRetry(load);
   } catch (error) {
      console.error(label, signature, error instanceof Error ? error.message : error);
      return null;
   }
}

async function prepareSingleCashout(
   rpc: Rpc<SolanaRpcApi>,
   decoded: Extract<AggregatorInstructionData, { kind: "fillCashout" | "fillRfqCashout" }>,
   ix: IndexedInstruction,
   ctx: IndexedTxContext,
   meta: UpdateMeta,
   userOwner: Address | null,
): Promise<(() => void) | null> {
   const cashoutAddress = accountAt(ix.accounts, 6);
   const mint = accountAt(ix.accounts, CASHOUT_IX_MINT_INDEX);
   const origBet = accountAt(ix.accounts, 4);
   if (cashoutAddress == null || mint == null || userOwner == null || origBet == null) {
      console.error("cashout fill missing accounts", decoded.kind, ctx.signature);
      return () => {};
   }
   const data = decoded.data;
   let fromChain = true;
   let cashoutAccount: CashoutAccountData | null = await readCashoutAccount(
      () => getCashoutData(rpc, cashoutAddress),
      ctx.signature,
      `cashout account unavailable (${decoded.kind})`,
   );
   if (cashoutAccount == null) {
      fromChain = false;
      cashoutAccount = {
         discriminator: 8,
         bump: 0,
         mm: accountAt(ix.accounts, 18) ?? SYSTEM_PROGRAM_ID,
         feepayer: accountAt(ix.accounts, 0) ?? SYSTEM_PROGRAM_ID,
         origOwner: userOwner,
         origBetId: data.origBetId,
         cashoutId: data.cashoutId,
         marketId: {
            eventId: { sport: 0, league: 0, event: 0n },
            mkt: 0,
            period: 0,
            player: 0n,
            isPregame: true,
            operator: SYSTEM_PROGRAM_ID,
            mint,
         },
         side: 255,
         amount: data.amount,
         payout: data.minPayout,
         timestamp: ctx.blockTime,
         origEventStateSequence: data.eventStateSequence,
         origEventGameState: data.eventGameState,
         cashoutEventStateSequence: data.eventStateSequence,
         cashoutEventGameState: data.eventGameState,
         result: BetResult.Pending,
         numFillers: 0,
         fillers: [],
      };
   }
   const escrowAddress = accountAt(ix.accounts, 8);
   const delayed = escrowAddress != null && escrowAddress !== SYSTEM_PROGRAM_ID;
   const escrow = await loadEscrow(rpc, escrowAddress, userOwner, cashoutAccount.origBetId, cashoutAccount.cashoutId, false, ctx);
   const payment = escrow?.fromChain
      ? Number(escrow.account.payment)
      : delayed
         ? null
         : tokenIncreaseForOwner(ctx.meta, userOwner, mint);
   const selections = [selectionFromMarketId(
      cashoutAccount.marketId,
      cashoutAccount.side,
      cashoutAccount.cashoutEventStateSequence,
      cashoutAccount.cashoutEventGameState,
   )];
   const market = marketOperatorAndMint(selections);
   const eventStates = [{ sequence: cashoutAccount.cashoutEventStateSequence, game_state: cashoutAccount.cashoutEventGameState }];
   return () => {
      addCashoutAccount(
         cashoutAddress,
         cashoutAccount.origBetId,
         cashoutAccount.cashoutId,
         "single",
         cashoutAccount.amount,
         cashoutAccount.payout,
         selections,
         eventStates,
         cashoutAccount.mm,
         ctx.blockTime,
         meta,
         fromChain,
      );
      if (escrow != null && escrowAddress != null) {
         addCashoutEscrowAccount(escrowAddress, escrow.account, market.operator, market.mint, meta, escrow.fromChain);
      }
      applyOrigBetCashoutFill(origBet, cashoutAccount.amount, cashoutAccount.payout, delayed, payment, meta);
   };
}

async function prepareParlayCashout(
   rpc: Rpc<SolanaRpcApi>,
   decoded: Extract<AggregatorInstructionData, { kind: "fillParlayCashout" | "fillRfqParlayCashout" }>,
   ix: IndexedInstruction,
   ctx: IndexedTxContext,
   meta: UpdateMeta,
   userOwner: Address | null,
): Promise<(() => void) | null> {
   const cashoutAddress = accountAt(ix.accounts, 6);
   const mint = accountAt(ix.accounts, CASHOUT_IX_MINT_INDEX);
   const origBet = accountAt(ix.accounts, 4);
   if (cashoutAddress == null || mint == null || userOwner == null || origBet == null) {
      console.error("parlay cashout fill missing accounts", decoded.kind, ctx.signature);
      return () => {};
   }
   const data = decoded.data;
   let fromChain = true;
   let cashoutParlayAccount: CashoutParlayAccountData | null = await readCashoutAccount(
      () => getCashoutParlayData(rpc, cashoutAddress),
      ctx.signature,
      `parlay cashout account unavailable (${decoded.kind})`,
   );
   let selections: Selection[];
   if (cashoutParlayAccount == null) {
      fromChain = false;
      cashoutParlayAccount = {
         discriminator: 9,
         bump: 0,
         mm: SYSTEM_PROGRAM_ID,
         feepayer: accountAt(ix.accounts, 0) ?? SYSTEM_PROGRAM_ID,
         origOwner: userOwner,
         origBetId: data.origBetId,
         cashoutId: data.cashoutId,
         amount: data.amount,
         payout: data.minPayout,
         timestamp: ctx.blockTime,
         result: BetResult.Pending,
         originalFillerAddress: SYSTEM_PROGRAM_ID,
         numLegs: data.numLegs,
         legs: [],
      };
      selections = data.snapshots.slice(0, data.numLegs).map((snapshot) =>
         selectionFromMarketId(
            {
               eventId: { sport: 0, league: 0, event: 0n },
               mkt: 0,
               period: 0,
               player: 0n,
               isPregame: true,
               operator: SYSTEM_PROGRAM_ID,
               mint,
            },
            255,
            snapshot.eventStateSequence,
            snapshot.eventGameState,
         ));
   } else {
      selections = cashoutParlayAccount.legs.slice(0, cashoutParlayAccount.numLegs).map((leg) =>
         selectionFromMarketId(leg.marketId, leg.side, leg.cashoutEventStateSequence, leg.cashoutEventGameState, leg.oddsScaled));
   }
   const market = marketOperatorAndMint(selections);
   const escrowAddress = accountAt(ix.accounts, 8);
   const delayed = escrowAddress != null && escrowAddress !== SYSTEM_PROGRAM_ID;
   const escrow = await loadEscrow(rpc, escrowAddress, userOwner, cashoutParlayAccount.origBetId, cashoutParlayAccount.cashoutId, true, ctx);
   const payment = escrow?.fromChain
      ? Number(escrow.account.payment)
      : delayed
         ? null
         : tokenIncreaseForOwner(ctx.meta, userOwner, mint);
   const eventStates = fromChain
      ? cashoutParlayAccount.legs.slice(0, cashoutParlayAccount.numLegs).map((leg) => ({
         sequence: leg.cashoutEventStateSequence,
         game_state: leg.cashoutEventGameState,
      }))
      : data.snapshots.slice(0, data.numLegs).map((snapshot) => ({
         sequence: snapshot.eventStateSequence,
         game_state: snapshot.eventGameState,
      }));
   return () => {
      addCashoutAccount(
         cashoutAddress,
         cashoutParlayAccount.origBetId,
         cashoutParlayAccount.cashoutId,
         "parlay",
         cashoutParlayAccount.amount,
         cashoutParlayAccount.payout,
         selections,
         eventStates,
         cashoutParlayAccount.mm,
         ctx.blockTime,
         meta,
         fromChain,
      );
      if (escrow != null && escrowAddress != null) {
         addCashoutEscrowAccount(escrowAddress, escrow.account, market.operator, market.mint, meta, escrow.fromChain);
      }
      applyOrigBetCashoutFill(origBet, cashoutParlayAccount.amount, cashoutParlayAccount.payout, delayed, payment, meta);
   };
}

async function loadEscrow(
   rpc: Rpc<SolanaRpcApi>,
   escrowAddress: Address | null,
   owner: Address,
   origBetId: bigint,
   cashoutId: bigint,
   isParlay: boolean,
   ctx: IndexedTxContext,
): Promise<{ account: CashoutEscrowAccountData; fromChain: boolean } | null> {
   if (escrowAddress == null || escrowAddress === SYSTEM_PROGRAM_ID) {
      return null;
   }
   const account = await readCashoutAccount(
      () => getCashoutEscrowData(rpc, escrowAddress),
      ctx.signature,
      "cashout escrow unavailable",
   );
   if (account != null) {
      return { account, fromChain: true };
   }
   return {
      fromChain: false,
      account: {
         discriminator: 0,
         bump: 0,
         owner,
         feepayer: SYSTEM_PROGRAM_ID,
         origBetId,
         cashoutId,
         timestamp: ctx.blockTime,
         amount: 0n,
         payoutRemoved: 0n,
         payment: 0n,
         marketMaker: SYSTEM_PROGRAM_ID,
         isParlay,
      },
   };
}

export async function retryUnresolvedAccounts(rpc: Rpc<SolanaRpcApi>): Promise<void> {
   for (const row of listUnresolvedBets()) {
      await retryBet(rpc, row.id, row.type);
   }
   for (const row of listUnresolvedCashouts()) {
      await retryCashout(rpc, row.id, row.type);
   }
   for (const row of listUnresolvedEscrows()) {
      await retryEscrow(rpc, row.id);
   }
}

async function retryBet(rpc: Rpc<SolanaRpcApi>, id: string, type: "single" | "parlay"): Promise<void> {
   const accountAddress = address(id);
   try {
      if (type === "parlay") {
         const account = await withRpcRetry(() => getParlayData(rpc, accountAddress));
         const legs = account.legs.slice(0, account.numLegs);
         const odds = ticketOddsScaled(account.amount, account.payout, 0n);
         refreshBetFromChain(
            id,
            "parlay",
            account.betId,
            account.owner,
            legs.map(selectionFromParlayLeg),
            account.amount,
            odds,
            account.payout,
            account.timestamp,
            account.promoType,
            [],
         );
         return;
      }
      const account = await withRpcRetry(() => getBetData(rpc, accountAddress));
      const odds = ticketOddsScaled(account.amount, account.payout, 0n);
      refreshBetFromChain(
         id,
         "single",
         account.betId,
         account.owner,
         [selectionFromMarketId(
            account.marketId,
            account.side,
            account.eventStateSequence,
            account.eventGameState,
            odds > 0n ? odds : null,
         )],
         account.amount,
         odds,
         account.payout,
         account.timestamp,
         account.promoType,
         fillersFromBetAccount(account.fillers),
      );
   } catch (error) {
      noteUnresolvedAttempt("bet_accounts", id, isAccountNotFound(error));
      if (!isAccountNotFound(error)) {
         console.error("retry bet account failed", id, error instanceof Error ? error.message : error);
      }
   }
}

async function retryCashout(rpc: Rpc<SolanaRpcApi>, id: string, type: "single" | "parlay"): Promise<void> {
   const accountAddress = address(id);
   try {
      if (type === "parlay") {
         const account = await withRpcRetry(() => getCashoutParlayData(rpc, accountAddress));
         const selections = account.legs.slice(0, account.numLegs).map((leg) =>
            selectionFromMarketId(leg.marketId, leg.side, leg.cashoutEventStateSequence, leg.cashoutEventGameState, leg.oddsScaled));
         refreshCashoutFromChain(
            id,
            "parlay",
            account.amount,
            account.payout,
            selections,
            account.legs.slice(0, account.numLegs).map((leg) => ({ sequence: leg.cashoutEventStateSequence, game_state: leg.cashoutEventGameState })),
            account.mm,
            account.timestamp,
         );
         return;
      }
      const account = await withRpcRetry(() => getCashoutData(rpc, accountAddress));
      refreshCashoutFromChain(
         id,
         "single",
         account.amount,
         account.payout,
         [selectionFromMarketId(account.marketId, account.side, account.cashoutEventStateSequence, account.cashoutEventGameState)],
         [{ sequence: account.cashoutEventStateSequence, game_state: account.cashoutEventGameState }],
         account.mm,
         account.timestamp,
      );
   } catch (error) {
      noteUnresolvedAttempt("cashout_accounts", id, isAccountNotFound(error));
      if (!isAccountNotFound(error)) {
         console.error("retry cashout account failed", id, error instanceof Error ? error.message : error);
      }
   }
}

async function retryEscrow(rpc: Rpc<SolanaRpcApi>, id: string): Promise<void> {
   try {
      const account = await withRpcRetry(() => getCashoutEscrowData(rpc, address(id)));
      refreshEscrowFromChain(id, account);
   } catch (error) {
      noteUnresolvedAttempt("cashout_escrow_accounts", id, isAccountNotFound(error));
      if (!isAccountNotFound(error)) {
         console.error("retry escrow account failed", id, error instanceof Error ? error.message : error);
      }
   }
}
