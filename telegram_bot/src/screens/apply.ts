import { address } from "@solana/kit";
import { LIVE_CASHOUT_DELAY, MAX_PARLAY_LEGS } from "spamm-aggregator-sdk";
import { txUrl } from "../network";
import { claimGraded, describeRow, fetchHistory, fetchOpenBets, rowAmount } from "../betting/bets";
import { cashoutUsesRfq, claimEscrow, escrowReady, fillCashout, fillRfqCashout, loadEscrow, quoteCashout } from "../betting/cashout";
import { placeAuction, placeRfq, type VoucherPick } from "../betting/place";
import { eligibleBoosts, eligibleFreebets, filterQuotes, loadVouchers, voucherReason, type SlipBoost, type SlipFreebet } from "../betting/vouchers";
import { oddsCoveringStake, quoteParlay, quoteSingle } from "../betting/quote";
import { quoteReject, requestRfq, rfqBody } from "../betting/rfq";
import { errorText } from "../chain/rpc";
import { debug } from "../debug";
import { mainOutcomes, sectionOutcomes, sectionsFor } from "../markets/board";
import { parlayLeg, type Leg } from "../markets/leg";
import { searchEvents } from "../markets/search";
import { findEvent, loadSlate } from "../markets/slate";
import { addComboLeg, emptySlip, go, popNav, type Session } from "../session";
import { formatDollars, oddsFromDecimal, parseUsdc } from "../usdc";
import { airdropDevnetUsdc, readBalances, withdrawUsdc } from "../wallet/balances";
import type { BotWallet } from "../wallet/privy";
import type { Act } from "./acts";

async function coversUsdc(session: Session, wallet: BotWallet, amount: bigint): Promise<boolean> {
   const { usdc } = await readBalances(wallet.address);
   if (amount <= usdc) {
      return true;
   }
   session.notice = `Not enough USDC. Wallet has ${formatDollars(usdc)}, this needs ${formatDollars(amount)}.`;
   return false;
}

function limitsOf(kind: "freebet" | "boost" | null, freebet: SlipFreebet | null, boost: SlipBoost | null) {
   if (kind === "freebet" && freebet != null) {
      return freebet.data;
   }
   if (kind === "boost" && boost != null) {
      return boost.data;
   }
   return null;
}

async function selectedVoucher(session: Session, wallet: BotWallet): Promise<{ pick: VoucherPick; freebet: SlipFreebet | null; boost: SlipBoost | null }> {
   const slip = session.slip;
   const loaded = await loadVouchers(wallet.address);
   const freebet = loaded.freebets.find((row) => `${row.data.issuerAuth}:${row.data.freebetId}` === slip?.voucherKey) ?? null;
   const boost = loaded.boosts.find((row) => `${row.data.issuerAuth}:${row.data.boostId}` === slip?.voucherKey) ?? null;
   const pick: VoucherPick = slip?.voucherKind === "freebet" && freebet != null
      ? { kind: "freebet", row: freebet }
      : slip?.voucherKind === "boost" && boost != null
         ? { kind: "boost", row: boost }
         : null;
   return { pick, freebet, boost };
}

async function refreshQuote(session: Session, wallet: BotWallet): Promise<void> {
   const slip = session.slip;
   if (slip == null || slip.stake == null) {
      return;
   }
   slip.quote = null;
   slip.quoteError = null;
   slip.rfqQuotes = [];
   slip.rfqRequest = null;
   if (slip.legs.length > MAX_PARLAY_LEGS) {
      slip.quoteError = `On-chain quotes stop at ${MAX_PARLAY_LEGS} legs. Request an RFQ.`;
      return;
   }
   const { freebet, boost } = await selectedVoucher(session, wallet);
   const limits = limitsOf(slip.voucherKind, freebet, boost);
   if (slip.voucherKind === "freebet" && freebet != null && slip.stake !== freebet.data.amount) {
      slip.stake = freebet.data.amount;
   }
   if (slip.voucherKind === "boost" && boost != null && slip.stake > boost.data.maxStake) {
      slip.quoteError = "Stake is above the boost maximum.";
      return;
   }
   const allowed = limits != null && limits.allowedMms.length > 0 ? limits.allowedMms : undefined;
   const raw = slip.legs.length === 1
      ? await quoteSingle(wallet.address, parlayLeg(slip.legs[0]!).marketId, parlayLeg(slip.legs[0]!).side, slip.stake, allowed)
      : await quoteParlay(wallet.address, slip.legs.map(parlayLeg), slip.stake, allowed);
   const top = filterQuotes(raw.topMms, limits);
   slip.quote = { topMms: top, errors: raw.errors };
   if (top.length === 0) {
      const why = limits == null
         ? (raw.errors[0] ?? "No quote for this stake. Request an RFQ or change the stake.")
         : (voucherReason(limits, slip.legs, raw.topMms, session.oddsFormat) ?? "No quote for this voucher.");
      if (limits != null) {
         const wasFreebet = slip.voucherKind === "freebet";
         slip.voucherKind = null;
         slip.voucherKey = null;
         if (wasFreebet) {
            slip.stake = null;
         }
         slip.quoteError = `${why} Switched back to a cash stake.`;
      } else {
         slip.quoteError = why;
      }
   }
}

async function focusLeg(session: Session, index: number): Promise<Leg | null> {
   const nav = session.nav;
   if (nav.name !== "game" && nav.name !== "section") {
      return session.focus;
   }
   const tree = await loadSlate();
   const found = findEvent(tree, nav.sportId, nav.leagueId, nav.eventId);
   if (found == null) {
      return null;
   }
   if (nav.name === "game") {
      return mainOutcomes(found.event)[index]?.leg ?? null;
   }
   const section = sectionsFor(found.event)[nav.section];
   if (section == null) {
      return null;
   }
   return sectionOutcomes(found.event, section.rows)[index]?.leg ?? null;
}

function openSlip(session: Session, legs: Leg[], fromCombo: boolean): void {
   session.trail.push(session.nav);
   session.slip = emptySlip(legs, fromCombo);
   session.nav = { name: "slip" };
   session.phase = "stake";
   session.notice = null;
}

export async function applyAct(session: Session, wallet: BotWallet, act: Act): Promise<void> {
   debug("act", act.t);
   if (act.t === "menu") {
      go(session, { name: "menu" });
      return;
   }
   if (act.t === "back") {
      popNav(session);
      return;
   }
   if (act.t === "sports") {
      go(session, { name: "sports", page: act.page });
      return;
   }
   if (act.t === "leagues") {
      go(session, { name: "leagues", sportId: act.sportId, page: act.page });
      return;
   }
   if (act.t === "games") {
      go(session, { name: "games", sportId: act.sportId, leagueId: act.leagueId, page: act.page });
      return;
   }
   if (act.t === "game") {
      go(session, { name: "game", sportId: act.sportId, leagueId: act.leagueId, eventId: act.eventId });
      return;
   }
   if (act.t === "sections") {
      go(session, { name: "sections", sportId: act.sportId, leagueId: act.leagueId, eventId: act.eventId, page: act.page });
      return;
   }
   if (act.t === "section") {
      go(session, { name: "section", sportId: act.sportId, leagueId: act.leagueId, eventId: act.eventId, section: act.section, page: act.page });
      return;
   }
   if (act.t === "searchPage") {
      session.nav = { name: "search", page: act.page };
      session.phase = "idle";
      return;
   }
   if (act.t === "search") {
      const tree = await loadSlate();
      if (tree.length === 0) {
         session.phase = "idle";
         session.notice = "No events on the slate.";
         return;
      }
      session.phase = "search";
      session.notice = null;
      return;
   }
   if (act.t === "focus") {
      const leg = await focusLeg(session, act.index);
      if (leg == null) {
         session.notice = "That price is gone. Open the game again.";
         return;
      }
      session.focus = leg;
      go(session, { name: "outcome" });
      return;
   }
   if (act.t === "place" && session.focus != null) {
      openSlip(session, [session.focus], false);
      return;
   }
   if (act.t === "add" && session.focus != null) {
      const err = addComboLeg(session, session.focus);
      session.notice = err;
      go(session, { name: "combo" });
      return;
   }
   if (act.t === "addbet" && session.focus != null) {
      const err = addComboLeg(session, session.focus);
      if (err != null) {
         session.notice = err;
         return;
      }
      openSlip(session, [...session.combo], true);
      return;
   }
   if (act.t === "unfocus" && session.focus != null) {
      session.combo = session.combo.filter((leg) => leg.id !== session.focus?.id);
      session.notice = "Removed.";
      return;
   }
   if (act.t === "combo") {
      go(session, { name: "combo" });
      return;
   }
   if (act.t === "drop") {
      if (session.slip != null && (session.nav.name === "slip" || session.nav.name === "rfq")) {
         const removed = session.slip.legs[act.index];
         session.slip.legs = session.slip.legs.filter((_, index) => index !== act.index);
         if (session.slip.fromCombo && removed != null) {
            session.combo = session.combo.filter((leg) => leg.id !== removed.id);
         }
         if (session.slip.legs.length === 0) {
            session.slip = null;
            popNav(session);
            return;
         }
         await refreshQuote(session, wallet);
         return;
      }
      session.combo = session.combo.filter((_, index) => index !== act.index);
      if (session.combo.length === 0 && session.nav.name === "combo") {
         session.nav = session.pickFrom ?? { name: "menu" };
         session.phase = "idle";
      }
      return;
   }
   if (act.t === "addMore") {
      session.nav = session.pickFrom ?? { name: "menu" };
      session.trail = session.trail.filter((nav) => nav.name !== "outcome" && nav.name !== "combo");
      const top = session.trail[session.trail.length - 1];
      if (top != null && top.name === session.nav.name) {
         session.trail.pop();
      }
      session.phase = "idle";
      return;
   }
   if (act.t === "clearCombo") {
      session.combo = [];
      session.notice = "Combo cleared.";
      return;
   }
   if (act.t === "betCombo") {
      if (session.combo.length < 2) {
         session.notice = "Add at least two legs.";
         return;
      }
      openSlip(session, [...session.combo], true);
      return;
   }
   if (act.t === "stake") {
      await setStake(session, wallet, act.amount);
      return;
   }
   if (act.t === "stakeType") {
      session.phase = "stake";
      session.notice = "Send a stake, like 10 or 2.5.";
      return;
   }
   if (act.t === "min") {
      session.phase = "minOdds";
      session.notice = minOddsPrompt(session.oddsFormat);
      return;
   }
   if (act.t === "settings") {
      go(session, { name: "settings" });
      return;
   }
   if (act.t === "oddsFormat") {
      session.oddsFormat = act.format;
      return;
   }
   if (act.t === "explorer") {
      session.explorer = act.explorer;
      return;
   }
   if (act.t === "confirm") {
      await confirmAuction(session, wallet);
      return;
   }
   if (act.t === "rfq") {
      await runRfq(session, wallet);
      return;
   }
   if (act.t === "rfqPick") {
      await acceptRfq(session, wallet, act.index);
      return;
   }
   if (act.t === "freebet" || act.t === "boost" || act.t === "noVoucher") {
      await pickVoucher(session, wallet, act.t);
      return;
   }
   if (act.t === "bets") {
      session.openRows = await fetchOpenBets(wallet.address);
      go(session, { name: "bets", tab: act.tab, page: act.page });
      return;
   }
   if (act.t === "claim") {
      if (session.openRows.length === 0) {
         session.openRows = await fetchOpenBets(wallet.address);
      }
      const count = await claimGraded(wallet, session.openRows);
      session.openRows = await fetchOpenBets(wallet.address);
      session.notice = count === 0 ? "Nothing to claim." : `Claimed ${count}.`;
      return;
   }
   if (act.t === "cash") {
      const row = session.openRows[act.index];
      if (row == null) {
         session.notice = "That bet is gone.";
         return;
      }
      await openCashout(session, wallet, act.index, rowAmount(row));
      return;
   }
   if (act.t === "cashEdit" && session.cash != null) {
      session.phase = "cashAmount";
      session.notice = null;
      return;
   }
   if (act.t === "cashOk" && session.cash != null) {
      const row = session.openRows[session.cash.index];
      if (row == null) {
         session.notice = "That bet is gone.";
         return;
      }
      const sig = await fillCashout(wallet, row, session.cash.amount, {
         maxPayment: session.cash.maxPayment,
         fillingMm: address(session.cash.fillingMm),
         mmPrograms: session.cash.mmPrograms.map((item) => address(item)),
      });
      session.notice = `Cashout ${formatLink(session, sig)}`;
      session.cash = null;
      session.openRows = await fetchOpenBets(wallet.address);
      go(session, { name: "bets", tab: "pending", page: 0 });
      return;
   }
   if (act.t === "escrow") {
      const row = session.openRows[act.index];
      if (row == null) {
         session.notice = "That bet is gone.";
         return;
      }
      const betId = row.kind === "single" ? row.data.betId : row.account.betId;
      const feepayer = row.kind === "single" ? row.data.feepayer : row.account.feepayer;
      const escrow = await loadEscrow(wallet.address, betId);
      if (escrow == null) {
         session.notice = "No cashout escrow on this bet.";
         return;
      }
      if (!escrowReady(escrow)) {
         const left = escrow.timestamp + LIVE_CASHOUT_DELAY - Math.floor(Date.now() / 1000);
         session.notice = `Claim cashout in ${Math.max(left, 0)}s.`;
         return;
      }
      const sig = await claimEscrow(wallet, escrow, feepayer);
      session.notice = `Claimed cashout ${formatLink(session, sig)}`;
      session.openRows = await fetchOpenBets(wallet.address);
      return;
   }
   if (act.t === "history") {
      const page = await fetchHistory(wallet.address);
      session.historyRows = [...page.rows];
      session.historyNext = page.next;
      go(session, { name: "history", page: 0 });
      return;
   }
   if (act.t === "older") {
      if (session.historyNext == null) {
         return;
      }
      const page = await fetchHistory(wallet.address, session.historyNext);
      session.historyRows = [...session.historyRows, ...page.rows];
      session.historyNext = page.next;
      return;
   }
   if (act.t === "balance") {
      go(session, { name: "balance" });
      return;
   }
   if (act.t === "deposit") {
      go(session, { name: "deposit" });
      return;
   }
   if (act.t === "airdrop") {
      const sig = await airdropDevnetUsdc(wallet);
      session.notice = `Test USDC ${formatLink(session, sig)}`;
      return;
   }
   if (act.t === "withdraw") {
      session.phase = "withdrawAddress";
      session.withdrawAmount = null;
      session.withdrawDest = "";
      go(session, { name: "withdraw" });
      session.phase = "withdrawAddress";
      session.notice = "Send the destination Solana address.";
      return;
   }
   if (act.t === "withdrawOk" && session.withdrawAmount != null) {
      if (!(await coversUsdc(session, wallet, session.withdrawAmount))) {
         return;
      }
      const sig = await withdrawUsdc(wallet, address(session.withdrawDest), session.withdrawAmount);
      session.notice = `Withdrew ${formatLink(session, sig)}`;
      session.withdrawAmount = null;
      go(session, { name: "balance" });
   }
}

async function setStake(session: Session, wallet: BotWallet, raw: string): Promise<void> {
   const slip = session.slip;
   if (slip == null) {
      return;
   }
   const amount = parseUsdc(raw);
   if (amount == null || amount <= 0n) {
      session.notice = "Send a stake, like 10 or 2.5.";
      session.phase = "stake";
      return;
   }
   if (slip.voucherKind !== "freebet" && !(await coversUsdc(session, wallet, amount))) {
      session.phase = "stake";
      return;
   }
   slip.stake = amount;
   session.phase = "idle";
   session.nav = { name: "slip" };
   await refreshQuote(session, wallet);
}

async function confirmAuction(session: Session, wallet: BotWallet): Promise<void> {
   const slip = session.slip;
   if (slip == null || slip.stake == null || slip.quote == null || slip.quote.topMms.length === 0) {
      session.notice = "No on-chain quote. Request an RFQ or change the stake.";
      return;
   }
   const covering = oddsCoveringStake(slip.quote.topMms, slip.stake);
   const typed = slip.minOdds.trim() === "" || slip.minOdds.trim() === "-" ? null : parseOddsToScaled(slip.minOdds, session.oddsFormat);
   const min = typed ?? covering;
   if (min == null || min <= 10000n) {
      session.notice = "Min odds must be above 1.00.";
      return;
   }
   const { pick } = await selectedVoucher(session, wallet);
   if (pick?.kind !== "freebet" && !(await coversUsdc(session, wallet, slip.stake))) {
      return;
   }
   const sig = await placeAuction(wallet, slip.legs, slip.stake, min, slip.quote.topMms, pick);
   await finishBet(session, wallet, sig);
}

async function runRfq(session: Session, wallet: BotWallet): Promise<void> {
   const slip = session.slip;
   if (slip == null || slip.stake == null) {
      session.notice = "Enter a stake first.";
      session.phase = "stake";
      return;
   }
   const { freebet, boost } = await selectedVoucher(session, wallet);
   if (slip.voucherKind !== "freebet" && !(await coversUsdc(session, wallet, slip.stake))) {
      return;
   }
   const limits = limitsOf(slip.voucherKind, freebet, boost);
   const body = rfqBody(wallet.address, slip.stake, slip.legs);
   const res = await requestRfq(body);
   slip.rfqRequest = body;
   slip.rfqQuotes = res.quotes.filter((quote) => quoteReject(quote, slip.stake!, limits) == null);
   slip.rfqError = slip.rfqQuotes.length === 0
      ? (res.mmCount === 0 ? "No RFQ market makers connected." : "No offchain quote for this stake.")
      : null;
   session.nav = { name: "rfq" };
   session.phase = "idle";
}

async function acceptRfq(session: Session, wallet: BotWallet, index: number): Promise<void> {
   const slip = session.slip;
   const request = slip?.rfqRequest;
   const quote = slip?.rfqQuotes[index];
   if (slip == null || slip.stake == null || request == null || quote == null) {
      session.notice = "Request quotes again.";
      return;
   }
   if (quote.offerExpiry <= Math.floor(Date.now() / 1000)) {
      session.notice = "That quote expired. Request again.";
      return;
   }
   const { pick } = await selectedVoucher(session, wallet);
   if (pick?.kind !== "freebet" && !(await coversUsdc(session, wallet, slip.stake))) {
      return;
   }
   const sig = await placeRfq(wallet, request, quote, pick);
   await finishBet(session, wallet, sig);
}

async function pickVoucher(session: Session, wallet: BotWallet, kind: "freebet" | "boost" | "noVoucher"): Promise<void> {
   const slip = session.slip;
   if (slip == null) {
      return;
   }
   const loaded = await loadVouchers(wallet.address);
   if (kind === "noVoucher") {
      slip.voucherKind = null;
      slip.voucherKey = null;
   } else if (kind === "freebet") {
      const row = eligibleFreebets(loaded.freebets, slip.legs, slip.quote?.topMms)[0];
      if (row == null) {
         return;
      }
      slip.voucherKind = "freebet";
      slip.voucherKey = `${row.data.issuerAuth}:${row.data.freebetId}`;
      slip.stake = row.data.amount;
   } else {
      const row = eligibleBoosts(loaded.boosts, slip.legs, slip.quote?.topMms)[0];
      if (row == null) {
         return;
      }
      slip.voucherKind = "boost";
      slip.voucherKey = `${row.data.issuerAuth}:${row.data.boostId}`;
   }
   if (slip.stake != null) {
      await refreshQuote(session, wallet);
   }
}

async function finishBet(session: Session, wallet: BotWallet, signature: string): Promise<void> {
   if (session.slip?.fromCombo) {
      session.combo = [];
   }
   session.slip = null;
   session.phase = "idle";
   session.heading = "Bet Placed";
   session.nav = { name: "menu" };
   session.trail = [];
   const link = formatLink(session, signature);
   try {
      session.openRows = await fetchOpenBets(wallet.address);
      const newest = session.openRows[0];
      session.notice = newest == null ? `Bet sent\n${link}` : `${await describeRow(newest, session.oddsFormat)}\n${link}`;
   } catch {
      session.notice = `Bet sent\n${link}`;
   }
}

function formatLink(session: Session, signature: string): string {
   return txUrl(session.explorer, signature);
}

function minOddsPrompt(format: OddsFormat): string {
   if (format === "american") {
      return "Send American min odds, like -118. Send - to keep the quote.";
   }
   if (format === "percent") {
      return "Send a percent min odds, like 54%. Send - to keep the quote.";
   }
   return "Send a decimal min odds, like 1.85. Send - to keep the quote.";
}

function minOddsInvalid(format: OddsFormat): string {
   if (format === "american") {
      return "Send American odds like +150 or -120, or - to keep the quote.";
   }
   if (format === "percent") {
      return "Send a percent like 54, or - to keep the quote.";
   }
   return "Send a decimal like 1.91, or - to keep the quote.";
}

export async function applyText(session: Session, wallet: BotWallet, text: string): Promise<void> {
   if (session.phase === "search") {
      const tree = await loadSlate();
      session.hits = tree.length === 0 ? [] : searchEvents(tree, text);
      session.phase = "idle";
      session.notice = tree.length === 0 ? "No events on the slate." : null;
      session.nav = { name: "search", page: 0 };
      return;
   }
   if (session.phase === "stake") {
      await setStake(session, wallet, text);
      return;
   }
   if (session.phase === "minOdds" && session.slip != null) {
      const raw = text.trim();
      if (raw !== "-" && parseOddsToScaled(raw, session.oddsFormat) == null) {
         session.notice = minOddsInvalid(session.oddsFormat);
         return;
      }
      session.slip.minOdds = raw === "-" ? "" : raw;
      session.phase = "idle";
      session.notice = raw === "-" ? "Using the quoted price." : `Min odds ${raw}`;
      return;
   }
   if (session.phase === "cashAmount" && session.cash != null) {
      const amount = parseUsdc(text);
      const stake = session.cash.stake;
      if (amount == null || amount <= 0n || amount >= stake) {
         session.notice = `Send an amount above $0 and below ${formatDollars(stake)}.`;
         return;
      }
      await openCashout(session, wallet, session.cash.index, amount);
      return;
   }
   if (session.phase === "withdrawAddress") {
      try {
         session.withdrawDest = String(address(text.trim()));
      } catch {
         session.notice = "That is not a Solana address.";
         return;
      }
      session.phase = "withdrawAmount";
      session.notice = "Send a USDC amount, or max.";
      return;
   }
   if (session.phase === "withdrawAmount") {
      if (text.trim().toLowerCase() === "max") {
         const bal = await readBalances(wallet.address);
         if (bal.usdc <= 0n) {
            session.notice = `Not enough USDC. Wallet has ${formatDollars(0n)}.`;
            return;
         }
         session.withdrawAmount = bal.usdc;
      } else {
         const amount = parseUsdc(text);
         if (amount == null || amount <= 0n) {
            session.notice = "Send an amount like 5, or max.";
            return;
         }
         if (!(await coversUsdc(session, wallet, amount))) {
            return;
         }
         session.withdrawAmount = amount;
      }
      session.phase = "idle";
      session.notice = null;
      session.nav = { name: "withdraw" };
      return;
   }
   session.notice = "Use the buttons, or /menu.";
}

async function openCashout(session: Session, wallet: BotWallet, index: number, amount: bigint): Promise<void> {
   const row = session.openRows[index];
   if (row == null) {
      session.notice = "That bet is gone.";
      return;
   }
   const stake = rowAmount(row);
   if (cashoutUsesRfq(row)) {
      const filled = await fillRfqCashout(wallet, row, amount);
      session.notice = `Cashout sent ${formatLink(session, filled.signature)} for ${formatDollars(filled.maxPayment)}.`;
      session.cash = null;
      session.phase = "idle";
      session.openRows = await fetchOpenBets(wallet.address);
      return;
   }
   const quote = await quoteCashout(wallet.address, row, amount);
   session.cash = {
      index,
      stake,
      amount,
      maxPayment: quote.maxPayment,
      fillingMm: String(quote.fillingMm),
      mmPrograms: quote.mmPrograms.map(String),
      rfq: false,
   };
   session.phase = "idle";
   session.notice = null;
   if (session.nav.name !== "cashout") {
      go(session, { name: "cashout" });
   }
}

export function explain(error: unknown): string {
   return errorText(error);
}
