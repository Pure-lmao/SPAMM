import { BetResult, MAX_PARLAY_LEGS, ODDS_SCALE } from "spamm-aggregator-sdk";
import { IS_DEVNET } from "../network";
import { PAGE_SIZE, SOL_FREE_MIN_LAMPORTS, STAKE_PRESETS } from "../constants";
import { extraCount, mainOutcomes, sectionOutcomes, sectionsFor } from "../markets/board";
import { legSummary } from "../markets/leg";
import { findEvent, loadSlate } from "../markets/slate";
import { matchLabel } from "../markets/search";
import type { Session } from "../session";
import { formatDollars, formatOdds, formatOddsNumber, formatUsdc, type OddsFormat } from "../usdc";
import type { Explorer } from "../network";
import { oddsCoveringStake } from "../betting/quote";
import { canCashout, canClaim, describeRow, isCashedOut, isPending, legsForRow, rowAmount, rowCashLabel, rowPayout, rowResult } from "../betting/bets";
import { escrowReady, loadEscrow } from "../betting/cashout";
import { boostLabel, boostedPayout, eligibleBoosts, eligibleFreebets, freebetLabel, loadVouchers } from "../betting/vouchers";
import { rememberSnap, shareQuery, stableId } from "../group/store";
import { t } from "../i18n";
import type { Act } from "./acts";
import { leagueFlag, sportIcon, withIcon } from "./icons";
import type { BotWallet } from "../wallet/privy";
import { readBalances } from "../wallet/balances";

export type ViewRow = {
   text: string;
   act: Act;
   share?: string;
   band?: "stake" | "pager";
};

export type View = {
   title?: string;
   text: string;
   table?: { headers: string[]; rows: string[][] };
   rows: ViewRow[];
};

function pageOf<T>(items: readonly T[], page: number): { slice: T[]; page: number; pages: number } {
   const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
   const safe = Math.min(Math.max(page, 0), pages - 1);
   return { slice: items.slice(safe * PAGE_SIZE, safe * PAGE_SIZE + PAGE_SIZE), page: safe, pages };
}

function pager(lang: string, page: number, pages: number, make: (page: number) => Act): ViewRow[] {
   const rows: ViewRow[] = [];
   if (page > 0) {
      rows.push({ text: t(lang, "prev"), act: make(page - 1), band: "pager" });
   }
   if (page + 1 < pages) {
      rows.push({ text: t(lang, "next"), act: make(page + 1), band: "pager" });
   }
   return rows;
}

function picked(on: boolean, label: string): string {
   return on ? `✅ ${label}` : label;
}

function shareButton(lang: string, id: string): ViewRow {
   return { text: t(lang, "share"), act: { t: "menu" }, share: shareQuery(id) };
}

function settingsView(session: Session, note: string): View {
   const lang = session.lang;
   const odds: { format: OddsFormat; label: string }[] = [
      { format: "decimal", label: t(lang, "oddsDecimal") },
      { format: "american", label: t(lang, "oddsAmerican") },
      { format: "percent", label: t(lang, "oddsPercent") },
   ];
   const explorers: { explorer: Explorer; label: string }[] = [
      { explorer: "solscan", label: t(lang, "explorerSolscan") },
      { explorer: "solana", label: t(lang, "explorerSolana") },
      { explorer: "orb", label: t(lang, "explorerOrb") },
   ];
   return {
      title: t(lang, "settingsTitle"),
      text: `${note}${t(lang, "settingsBody")}`.trim(),
      rows: [
         ...odds.map((item) => ({ text: picked(session.oddsFormat === item.format, item.label), act: { t: "oddsFormat" as const, format: item.format } })),
         ...explorers.map((item) => ({ text: picked(session.explorer === item.explorer, item.label), act: { t: "explorer" as const, explorer: item.explorer } })),
         { text: t(lang, "back"), act: { t: "back" } },
      ],
   };
}

function comboRow(session: Session): ViewRow[] {
   if (session.combo.length === 0) {
      return [];
   }
   return [{ text: t(session.lang, "combo", { count: session.combo.length }), act: { t: "combo" } }];
}

export async function buildView(session: Session, wallet: BotWallet): Promise<View> {
   const lang = session.lang;
   const note = session.notice == null ? "" : `${session.notice}\n\n`;
   if (session.phase === "search") {
      return {
         title: t(lang, "searchTitle"),
         text: t(lang, "searchPrompt"),
         rows: [{ text: t(lang, "menu"), act: { t: "menu" } }],
      };
   }
   const nav = session.nav;
   if (nav.name === "help") {
      return {
         title: t(lang, "help"),
         text: t(lang, "helpBody"),
         rows: [{ text: t(lang, "menu"), act: { t: "menu" } }],
      };
   }
   if (nav.name === "alts") {
      return {
         title: t(lang, "other"),
         text: note.trim(),
         rows: [
            ...session.altLegs.map((leg, index) => ({
               text: (leg.displayedDecimalOdds == null
                  ? leg.outcomeLabel
                  : `${leg.outcomeLabel} · ${formatOddsNumber(leg.displayedDecimalOdds, session.oddsFormat)}`).slice(0, 60),
               act: { t: "alt" as const, index },
            })),
            { text: t(lang, "back"), act: { t: "back" } },
         ],
      };
   }
   if (nav.name === "events") {
      return {
         title: t(lang, "moreMarkets"),
         text: note.trim(),
         rows: [
            ...session.eventLegs.map((leg, index) => ({ text: leg.eventTitle.slice(0, 60), act: { t: "eventMarkets" as const, index } })),
            { text: t(lang, "back"), act: { t: "back" } },
         ],
      };
   }
   if (nav.name === "menu") {
      const rows: View["rows"] = [
         { text: t(lang, "browse"), act: { t: "sports", page: 0 } },
         { text: t(lang, "search"), act: { t: "search" } },
         ...comboRow(session),
         { text: t(lang, "openBets"), act: { t: "bets", tab: "pending", page: 0 } },
         { text: t(lang, "history"), act: { t: "history" } },
         { text: t(lang, "claim"), act: { t: "claim" } },
         { text: t(lang, "balance"), act: { t: "balance" } },
         { text: t(lang, "deposit"), act: { t: "deposit" } },
         { text: t(lang, "withdraw"), act: { t: "withdraw" } },
         { text: t(lang, "settings"), act: { t: "settings" } },
      ];
      if (session.heading != null && session.shareToken != null) {
         rows.unshift(shareButton(lang, session.shareToken));
      }
      const titled = session.heading != null;
      return { title: session.heading ?? undefined, text: titled ? (session.notice ?? "") : note.trim(), rows };
   }
   if (nav.name === "sports" || nav.name === "leagues" || nav.name === "games" || nav.name === "game" || nav.name === "sections" || nav.name === "section" || nav.name === "search") {
      return browse(session, note);
   }
   if (nav.name === "outcome") {
      return outcomeView(session, note);
   }
   if (nav.name === "combo") {
      return comboView(session, note);
   }
   if (nav.name === "slip" || nav.name === "rfq") {
      return slipView(session, wallet, note);
   }
   if (nav.name === "bets") {
      return betsView(session, wallet, note);
   }
   if (nav.name === "history") {
      return historyView(session, note);
   }
   if (nav.name === "balance" || nav.name === "deposit") {
      return walletView(session, wallet, note);
   }
   if (nav.name === "cashout") {
      const cash = session.cash;
      const prompt = session.phase === "cashAmount" && cash != null
         ? t(lang, "cashPrompt", { amount: formatDollars(cash.stake) })
         : "";
      const text = cash == null
         ? `${note}${t(lang, "noCashQuote")}`
         : `${note}${t(lang, "cashAmount", { amount: formatDollars(cash.amount) })}\n${t(lang, "cashReturn", { amount: formatDollars(cash.maxPayment) })}${prompt === "" ? "" : `\n\n${prompt}`}`.trim();
      return {
         title: t(lang, "cashout"),
         text,
         rows: [
            ...(cash == null ? [] : [
               { text: t(lang, "cashOk"), act: { t: "cashOk" } as Act },
               { text: t(lang, "cashEdit"), act: { t: "cashEdit" } as Act },
            ]),
            { text: t(lang, "back"), act: { t: "bets", tab: "pending", page: 0 } },
         ],
      };
   }
   if (nav.name === "settings") {
      return settingsView(session, note);
   }
   const dest = session.withdrawDest === "" ? t(lang, "withdrawDest") : t(lang, "withdrawTo", { address: session.withdrawDest });
   const amt = session.withdrawAmount == null ? "" : `\n${t(lang, "withdrawAmount", { amount: formatUsdc(session.withdrawAmount) })}`;
   return {
      title: t(lang, "withdrawTitle"),
      text: `${note}${dest}${amt}`.trim(),
      rows: [
         ...(session.withdrawAmount != null ? [{ text: t(lang, "withdrawOk"), act: { t: "withdrawOk" } as Act }] : []),
         { text: t(lang, "menu"), act: { t: "menu" } },
      ],
   };
}

async function browse(session: Session, note: string): Promise<View> {
   const lang = session.lang;
   const tree = await loadSlate();
   const nav = session.nav;
   const back: View["rows"] = [{ text: t(lang, "menu"), act: { t: "menu" } }];
   if (nav.name === "sports") {
      const { slice, page, pages } = pageOf(tree, nav.page);
      return {
         title: t(lang, "sports"),
         text: note.trim(),
         rows: [
            ...slice.map((sport) => ({ text: withIcon(sportIcon(`${sport.name} ${sport.sport}`), sport.name), act: { t: "leagues" as const, sportId: sport.id, page: 0 } })),
            ...pager(lang, page, pages, (next) => ({ t: "sports", page: next })),
            ...comboRow(session),
            ...back,
         ],
      };
   }
   if (nav.name === "leagues") {
      const sport = tree.find((item) => item.id === nav.sportId);
      const leagues = sport?.leagues ?? [];
      const { slice, page, pages } = pageOf(leagues, nav.page);
      return {
         title: withIcon(sportIcon(`${sport?.name ?? ""} ${sport?.sport ?? ""}`), sport?.name ?? "Sport"),
         text: note.trim(),
         rows: [
            ...slice.map((league) => ({ text: withIcon(leagueFlag(league.name), league.name), act: { t: "games" as const, sportId: nav.sportId, leagueId: league.id, page: 0 } })),
            ...pager(lang, page, pages, (next) => ({ t: "leagues", sportId: nav.sportId, page: next })),
            ...comboRow(session),
            { text: t(lang, "back"), act: { t: "sports", page: 0 } },
         ],
      };
   }
   if (nav.name === "games") {
      const sport = tree.find((item) => item.id === nav.sportId);
      const league = sport?.leagues.find((item) => item.id === nav.leagueId);
      const events = league?.events ?? [];
      const { slice, page, pages } = pageOf(events, nav.page);
      return {
         title: withIcon(leagueFlag(league?.name ?? ""), league?.name ?? "League"),
         text: note.trim(),
         rows: [
            ...slice.map((ev) => ({ text: matchLabel(ev), act: { t: "game" as const, sportId: nav.sportId, leagueId: nav.leagueId, eventId: ev.id } })),
            ...pager(lang, page, pages, (next) => ({ t: "games", sportId: nav.sportId, leagueId: nav.leagueId, page: next })),
            ...comboRow(session),
            { text: t(lang, "back"), act: { t: "leagues", sportId: nav.sportId, page: 0 } },
         ],
      };
   }
   if (nav.name === "search") {
      const { slice, page, pages } = pageOf(session.hits, nav.page);
      return {
         title: t(lang, "searchTitle"),
         text: session.hits.length === 0 ? `${note}${t(lang, "searchEmpty")}`.trim() : note.trim(),
         rows: [
            ...slice.map((hit) => ({ text: withIcon(sportIcon(hit.sportName), hit.label), act: { t: "game" as const, sportId: hit.sportId, leagueId: hit.leagueId, eventId: hit.eventId } })),
            ...pager(lang, page, pages, (next) => ({ t: "searchPage", page: next })),
            { text: t(lang, "searchAgain"), act: { t: "search" } },
            ...back,
         ],
      };
   }
   const found = nav.name === "game" || nav.name === "sections" || nav.name === "section"
      ? findEvent(tree, nav.sportId, nav.leagueId, nav.eventId)
      : null;
   if (found == null || (nav.name !== "game" && nav.name !== "sections" && nav.name !== "section")) {
      return { text: `${note}${t(lang, "slateEmpty")}`, rows: back };
   }
   if (nav.name === "game") {
      const outcomes = mainOutcomes(found.event, session.oddsFormat);
      const extra = extraCount(found.event);
      return {
         title: matchLabel(found.event),
         text: `${note}${withIcon(leagueFlag(found.leagueName), found.leagueName)}\n${t(lang, "stakeHint")}`.trim(),
         rows: [
            ...outcomes.map((item, index) => ({ text: item.text, act: { t: "focus" as const, index } })),
            ...(extra > 0 ? [{ text: t(lang, "moreMarketsCount", { count: extra }), act: { t: "sections" as const, sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, page: 0 } }] : []),
            ...comboRow(session),
            { text: t(lang, "back"), act: { t: "games", sportId: nav.sportId, leagueId: nav.leagueId, page: 0 } },
         ],
      };
   }
   const sections = sectionsFor(found.event);
   if (nav.name === "sections") {
      const { slice, page, pages } = pageOf(sections, nav.page);
      return {
         title: matchLabel(found.event),
         text: `${note}${t(lang, "moreMarkets")}`.trim(),
         rows: [
            ...slice.map((section, index) => ({
               text: section.title,
               act: { t: "section" as const, sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, section: page * PAGE_SIZE + index, page: 0 },
            })),
            ...pager(lang, page, pages, (next) => ({ t: "sections", sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, page: next })),
            ...comboRow(session),
            { text: t(lang, "back"), act: { t: "game", sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId } },
         ],
      };
   }
   const section = sections[nav.section];
   const outcomes = section == null ? [] : sectionOutcomes(found.event, section.rows, session.oddsFormat);
   const { slice, page, pages } = pageOf(outcomes, nav.page);
   return {
      text: `${note}${section?.title ?? "Market"}`,
      rows: [
         ...slice.map((item, index) => ({ text: item.text, act: { t: "focus" as const, index: page * PAGE_SIZE + index } })),
         ...pager(lang, page, pages, (next) => ({ t: "section", sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, section: nav.section, page: next })),
         ...comboRow(session),
         { text: t(lang, "back"), act: { t: "sections", sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, page: 0 } },
      ],
   };
}

function outcomeView(session: Session, note: string): View {
   const lang = session.lang;
   const leg = session.focus;
   if (leg == null) {
      return { text: `${note}${t(lang, "pickPrice")}`, rows: [{ text: t(lang, "menu"), act: { t: "menu" } }] };
   }
   const inCombo = session.combo.some((item) => item.id === leg.id);
   const rows: View["rows"] = [
      { text: t(lang, "place"), act: { t: "place" } },
   ];
   if (inCombo) {
      rows.push({ text: t(lang, "removeCombo"), act: { t: "unfocus" } });
   } else {
      rows.push({ text: t(lang, "addCombo"), act: { t: "add" } });
   }
   if (session.combo.some((item) => item.id !== leg.id)) {
      rows.push({ text: t(lang, "addBet"), act: { t: "addbet" } });
   }
   rows.push({ text: t(lang, "back"), act: { t: "back" } });
   return { text: `${note}${legSummary(leg, session.oddsFormat)}`, rows };
}

function comboView(session: Session, note: string): View {
   const lang = session.lang;
   const rows: View["rows"] = [
      { text: t(lang, "addMore"), act: { t: "addMore" } },
   ];
   session.combo.forEach((leg, index) => {
      rows.push({ text: t(lang, "remove", { label: leg.outcomeLabel }).slice(0, 60), act: { t: "drop", index } });
   });
   if (session.combo.length >= 2) {
      rows.push({ text: t(lang, "betCombo"), act: { t: "betCombo" } });
   }
   if (session.combo.length > 0) {
      rows.push({ text: t(lang, "clear"), act: { t: "clearCombo" } });
   }
   const body = session.combo.length === 0
      ? t(lang, "comboEmpty")
      : session.combo.map((leg, index) => `${index + 1}. ${leg.eventTitle} — ${leg.outcomeLabel}`).join("\n");
   return { title: t(lang, "comboTitle", { count: session.combo.length }), text: `${note}${body}`.trim(), rows };
}

async function slipView(session: Session, wallet: BotWallet, note: string): Promise<View> {
   const lang = session.lang;
   const slip = session.slip;
   if (slip == null) {
      return { text: `${note}${t(lang, "noSlip")}`, rows: [{ text: t(lang, "menu"), act: { t: "menu" } }] };
   }
   const rfqOnly = slip.legs.length > MAX_PARLAY_LEGS;
   const vouchers = await loadVouchers(wallet.address);
   const quoted = slip.quote?.topMms;
   const freebets = eligibleFreebets(vouchers.freebets, slip.legs, quoted);
   const boosts = eligibleBoosts(vouchers.boosts, slip.legs, quoted);
   const price = slip.stake != null && slip.quote != null ? oddsCoveringStake(slip.quote.topMms, slip.stake) : null;
   const covered = slip.quote == null ? 0n : slip.quote.topMms.reduce((sum, row) => sum + row.maxAmount, 0n);
   const payout = price == null || slip.stake == null ? null : (slip.stake * price) / ODDS_SCALE;
   const boost = slip.voucherKind === "boost"
      ? vouchers.boosts.find((row) => `${row.data.issuerAuth}:${row.data.boostId}` === slip.voucherKey)
      : null;
   const shownPayout = payout == null || slip.stake == null
      ? null
      : boost == null ? payout : boostedPayout(payout, slip.stake, boost.data.boostBps);
   const lines = [
      slip.stake == null ? t(lang, "enterStake") : t(lang, "stake", { amount: formatDollars(slip.stake) }),
   ];
   if (price != null) {
      lines.push(t(lang, "quote", { odds: formatOdds(price, session.oddsFormat) }));
   }
   if (shownPayout != null) {
      lines.push(t(lang, "payout", { amount: formatDollars(shownPayout) }));
   }
   if (price != null && slip.stake != null && covered < slip.stake) {
      lines.push(t(lang, "covers", { amount: formatDollars(covered) }));
   }
   const err = slip.quoteError ?? slip.rfqError;
   if (err != null) {
      lines.push(err);
   }
   const rows: View["rows"] = slip.legs.map((leg, index) => ({ text: t(lang, "remove", { label: leg.outcomeLabel }).slice(0, 60), act: { t: "drop" as const, index } }));
   if (slip.stake == null) {
      for (const preset of STAKE_PRESETS) {
         rows.push({ text: `$${preset}`, act: { t: "stake", amount: String(preset) }, band: "stake" });
      }
      rows.push({ text: t(lang, "typeStake"), act: { t: "stakeType" } });
   } else if (session.nav.name === "rfq") {
      slip.rfqQuotes.forEach((quote, index) => {
         const left = Math.max(0, quote.offerExpiry - Math.floor(Date.now() / 1000));
         rows.push({
            text: `${formatOdds(BigInt(quote.oddsScaled), session.oddsFormat)} · ${formatDollars(BigInt(quote.maxStake))} · ${left}s`.slice(0, 60),
            act: { t: "rfqPick", index },
         });
      });
      rows.push({ text: t(lang, "requestAgain"), act: { t: "rfq" } });
   } else {
      if (price != null) {
         rows.push({ text: t(lang, "confirm"), act: { t: "confirm" } });
         rows.push({ text: t(lang, "minOdds"), act: { t: "min" } });
      }
      if (slip.voucherKind !== "freebet") {
         rows.push({ text: t(lang, "changeStake"), act: { t: "stakeType" } });
      }
      rows.push({ text: rfqOnly || price == null ? t(lang, "requestRfq") : t(lang, "requestOffchain"), act: { t: "rfq" } });
   }
   if (freebets.length > 0) {
      rows.push({ text: t(lang, "useFreebet", { label: freebetLabel(freebets[0]!) }).slice(0, 60), act: { t: "freebet" } });
   }
   if (boosts.length > 0) {
      rows.push({ text: t(lang, "useBoost", { label: boostLabel(boosts[0]!) }).slice(0, 60), act: { t: "boost" } });
   }
   if (slip.voucherKind != null) {
      rows.push({ text: t(lang, "cashStake"), act: { t: "noVoucher" } });
   }
   rows.push({ text: t(lang, "back"), act: { t: "back" } });
   const head = rfqOnly ? `${t(lang, "rfqCap", { count: MAX_PARLAY_LEGS })}\n` : "";
   return {
      title: t(lang, "slip"),
      table: {
         headers: [t(lang, "leg"), t(lang, "price")],
         rows: slip.legs.map((leg) => [
            leg.outcomeLabel,
            leg.displayedDecimalOdds == null ? "—" : formatOddsNumber(leg.displayedDecimalOdds, session.oddsFormat),
         ]),
      },
      text: `${note}${head}${lines.join("\n")}`.trim(),
      rows,
   };
}

async function betsView(session: Session, wallet: BotWallet, note: string): Promise<View> {
   const lang = session.lang;
   const nav = session.nav;
   if (nav.name !== "bets") {
      return { text: note, rows: [] };
   }
   const indexed = session.openRows
      .map((row, index) => ({ row, index }))
      .filter((item) => nav.tab === "pending" ? isPending(item.row) || isCashedOut(item.row) : canClaim(item.row));
   const { slice, page, pages } = pageOf(indexed, nav.page);
   const tableRows: string[][] = [];
   const buttons: View["rows"] = [
      { text: nav.tab === "pending" ? t(lang, "seeGraded") : t(lang, "seeOpen"), act: { t: "bets", tab: nav.tab === "pending" ? "graded" : "pending", page: 0 } },
   ];
   if (nav.tab === "graded" && indexed.length > 0) {
      buttons.push({ text: t(lang, "claimAll"), act: { t: "claim" } });
   }
   for (let i = 0; i < slice.length; i++) {
      const item = slice[i]!;
      const n = page * PAGE_SIZE + i + 1;
      const described = (await describeRow(item.row, session.oddsFormat)).replace(/\n/g, " · ");
      tableRows.push([String(n), described]);
      const legs = await legsForRow(item.row);
      const pending = isPending(item.row);
      const result = BetResult[rowResult(item.row)] ?? String(rowResult(item.row));
      const id = stableId(`bet:${item.row.address}`);
      rememberSnap({
         id,
         ownerId: session.userId,
         ownerName: session.userName,
         legs,
         stake: rowAmount(item.row).toString(),
         payout: rowPayout(item.row).toString(),
         result: pending ? "Pending" : result,
         betAddress: item.row.address,
         kind: "ticket",
      });
      buttons.push({ text: `${t(lang, "share")} ${n}`, act: { t: "menu" }, share: shareQuery(id) });
      if (nav.tab === "pending" && canCashout(item.row)) {
         buttons.push({ text: t(lang, "cashOut", { n }), act: { t: "cash", index: item.index } });
      }
      if (nav.tab === "pending" && isCashedOut(item.row)) {
         const betId = item.row.kind === "single" ? item.row.data.betId : item.row.account.betId;
         const escrow = await loadEscrow(wallet.address, betId);
         if (escrow != null && escrowReady(escrow)) {
            buttons.push({ text: t(lang, "claimCashout", { label: await rowCashLabel(item.row) }).slice(0, 60), act: { t: "escrow", index: item.index } });
         }
      }
   }
   return {
      title: nav.tab === "pending" ? t(lang, "openBets") : t(lang, "graded"),
      text: `${note}${tableRows.length === 0 ? t(lang, "none") : ""}`.trim(),
      table: tableRows.length === 0 ? undefined : { headers: ["#", t(lang, "ticket")], rows: tableRows },
      rows: [
         ...buttons,
         ...pager(lang, page, pages, (next) => ({ t: "bets", tab: nav.tab, page: next })),
         { text: t(lang, "refresh"), act: { t: "bets", tab: nav.tab, page } },
         { text: t(lang, "menu"), act: { t: "menu" } },
      ],
   };
}

function historyView(session: Session, note: string): View {
   const lang = session.lang;
   const rows: View["rows"] = [];
   const tableRows: string[][] = [];
   session.historyRows.forEach((row, index) => {
      tableRows.push([row.title, `${row.detail} · ${row.stake} → ${row.payout}`]);
      if (row.legs.length === 0) {
         return;
      }
      const id = stableId(`hist:${row.recordId ?? `${index}:${row.title}:${row.stake}`}`);
      const pending = row.result === "Pending";
      rememberSnap({
         id,
         ownerId: session.userId,
         ownerName: session.userName,
         legs: row.legs,
         stake: row.stakeRaw,
         payout: row.payoutRaw,
         result: pending ? "Pending" : row.result,
         betAddress: row.recordId,
         kind: "ticket",
      });
      rows.push({ text: `${t(lang, "share")} ${index + 1}`, act: { t: "menu" }, share: shareQuery(id) });
   });
   return {
      title: t(lang, "history"),
      text: `${note}${tableRows.length === 0 ? t(lang, "noHistory") : ""}`.trim(),
      table: tableRows.length === 0 ? undefined : { headers: [t(lang, "pick"), t(lang, "ticket")], rows: tableRows },
      rows: [
         ...rows,
         ...(session.historyNext == null ? [] : [{ text: t(lang, "older"), act: { t: "older" } as Act }]),
         { text: t(lang, "menu"), act: { t: "menu" } },
      ],
   };
}

function walletTable(lang: string, sol: bigint, usdc: bigint, address: string): NonNullable<View["table"]> {
   const solText = (Number(sol) / 1e9).toFixed(4);
   return {
      headers: [t(lang, "field"), t(lang, "value")],
      rows: [
         [t(lang, "sol"), solText],
         [t(lang, "usdc"), formatUsdc(usdc)],
         [t(lang, "address"), address],
      ],
   };
}

async function walletView(session: Session, wallet: BotWallet, note: string): Promise<View> {
   const lang = session.lang;
   const bal = await readBalances(wallet.address);
   const table = walletTable(lang, bal.sol, bal.usdc, wallet.address);
   const sponsored = bal.sol < SOL_FREE_MIN_LAMPORTS
      ? t(lang, "sponsored", { sol: `${t(lang, "sol")} ${(Number(bal.sol) / 1e9).toFixed(4)}` })
      : "";
   const cluster = IS_DEVNET ? "devnet" : "mainnet";
   if (session.nav.name === "deposit") {
      return {
         title: t(lang, "deposit"),
         text: `${note}${t(lang, "depositHint", { cluster })}${sponsored === "" ? "" : `\n${sponsored}`}`.trim(),
         table,
         rows: [
            ...(IS_DEVNET ? [{ text: t(lang, "testUsdc"), act: { t: "airdrop" } as Act }] : []),
            { text: t(lang, "menu"), act: { t: "menu" } },
         ],
      };
   }
   return {
      title: t(lang, "balance"),
      text: `${note}${sponsored}`.trim(),
      table,
      rows: [{ text: t(lang, "menu"), act: { t: "menu" } }],
   };
}
