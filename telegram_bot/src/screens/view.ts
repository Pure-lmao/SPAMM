import { MAX_PARLAY_LEGS, ODDS_SCALE } from "spamm-aggregator-sdk";
import { IS_DEVNET } from "../network";
import { PAGE_SIZE, SOL_FREE_MIN_LAMPORTS, STAKE_PRESETS } from "../constants";
import { extraCount, mainOutcomes, sectionOutcomes, sectionsFor } from "../markets/board";
import { legSummary } from "../markets/leg";
import { findEvent, loadSlate } from "../markets/slate";
import { matchLabel } from "../markets/search";
import type { Session } from "../session";
import { formatDollars, formatOdds, formatUsdc, type OddsFormat } from "../usdc";
import type { Explorer } from "../network";
import { oddsCoveringStake } from "../betting/quote";
import { canCashout, canClaim, describeRow, isCashedOut, isPending, rowCashLabel } from "../betting/bets";
import { escrowReady, loadEscrow } from "../betting/cashout";
import { boostLabel, boostedPayout, eligibleBoosts, eligibleFreebets, freebetLabel, loadVouchers } from "../betting/vouchers";
import type { Act } from "./acts";
import { leagueFlag, sportIcon, withIcon } from "./icons";
import type { BotWallet } from "../wallet/privy";
import { readBalances } from "../wallet/balances";

export type View = { title?: string; text: string; rows: { text: string; act: Act }[] };

function escapeHtml(value: string): string {
   return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderView(view: View): string {
   const parts: string[] = [];
   if (view.title != null && view.title !== "") {
      parts.push(`<b>${escapeHtml(view.title)}</b>`);
   }
   const body = view.text.trim();
   if (body !== "") {
      parts.push(escapeHtml(body));
   }
   return parts.join("\n\n") || "Menu";
}

function pageOf<T>(items: readonly T[], page: number): { slice: T[]; page: number; pages: number } {
   const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
   const safe = Math.min(Math.max(page, 0), pages - 1);
   return { slice: items.slice(safe * PAGE_SIZE, safe * PAGE_SIZE + PAGE_SIZE), page: safe, pages };
}

function pager(page: number, pages: number, make: (page: number) => Act): { text: string; act: Act }[] {
   const rows: { text: string; act: Act }[] = [];
   if (page > 0) {
      rows.push({ text: "Prev", act: make(page - 1) });
   }
   if (page + 1 < pages) {
      rows.push({ text: "Next", act: make(page + 1) });
   }
   return rows;
}

function picked(on: boolean, label: string): string {
   return on ? `✅ ${label}` : label;
}

function settingsView(session: Session, note: string): View {
   const odds: { format: OddsFormat; label: string }[] = [
      { format: "decimal", label: "Decimal" },
      { format: "american", label: "American" },
      { format: "percent", label: "%" },
   ];
   const explorers: { explorer: Explorer; label: string }[] = [
      { explorer: "solscan", label: "Solscan" },
      { explorer: "solana", label: "explorer.solana.com" },
      { explorer: "orb", label: "orbmarkets.io" },
   ];
   return {
      title: "Settings",
      text: `${note}Odds format\nExplorer`.trim(),
      rows: [
         ...odds.map((item) => ({ text: picked(session.oddsFormat === item.format, `Odds · ${item.label}`), act: { t: "oddsFormat" as const, format: item.format } })),
         ...explorers.map((item) => ({ text: picked(session.explorer === item.explorer, `Explorer · ${item.label}`), act: { t: "explorer" as const, explorer: item.explorer } })),
         { text: "↩️ Back", act: { t: "back" } },
      ],
   };
}

function comboRow(session: Session): { text: string; act: Act }[] {
   if (session.combo.length === 0) {
      return [];
   }
   return [{ text: `Combo (${session.combo.length})`, act: { t: "combo" } }];
}

export async function buildView(session: Session, wallet: BotWallet): Promise<View> {
   const note = session.notice == null ? "" : `${session.notice}\n\n`;
   if (session.phase === "search") {
      return {
         title: "Search",
         text: "Send a team name.",
         rows: [{ text: "↩️ Back", act: { t: "menu" } }],
      };
   }
   const nav = session.nav;
   if (nav.name === "menu") {
      const rows: View["rows"] = [
         { text: "👁️ Browse", act: { t: "sports", page: 0 } },
         { text: "🔍 Search", act: { t: "search" } },
         ...comboRow(session),
         { text: "📖 Open bets", act: { t: "bets", tab: "pending", page: 0 } },
         { text: "📕 History", act: { t: "history" } },
         { text: "💸 Claim", act: { t: "claim" } },
         { text: "💵 Balance", act: { t: "balance" } },
         { text: "💰 Deposit", act: { t: "deposit" } },
         { text: "🤑 Withdraw", act: { t: "withdraw" } },
         { text: "⚙️ Settings", act: { t: "settings" } },
      ];
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
         ? `Send an amount above $0 and below ${formatDollars(cash.stake)}.`
         : "";
      const text = cash == null
         ? `${note}No cashout quote.`
         : `${note}Cash out amount ${formatDollars(cash.amount)}\nReturn amount ${formatDollars(cash.maxPayment)}${prompt === "" ? "" : `\n\n${prompt}`}`.trim();
      return {
         title: "Cash out",
         text,
         rows: [
            ...(cash == null ? [] : [
               { text: "✅ Confirm cashout", act: { t: "cashOk" } as Act },
               { text: "Change amount", act: { t: "cashEdit" } as Act },
            ]),
            { text: "↩️ Back", act: { t: "bets", tab: "pending", page: 0 } },
         ],
      };
   }
   if (nav.name === "settings") {
      return settingsView(session, note);
   }
   const dest = session.withdrawDest === "" ? "Send a destination address." : `To ${session.withdrawDest}`;
   const amt = session.withdrawAmount == null ? "" : `\nAmount ${formatUsdc(session.withdrawAmount)} USDC`;
   return {
      title: "Withdraw",
      text: `${note}${dest}${amt}`.trim(),
      rows: [
         ...(session.withdrawAmount != null ? [{ text: "✅ Confirm withdraw", act: { t: "withdrawOk" } as Act }] : []),
         { text: "🗒️ Menu", act: { t: "menu" } },
      ],
   };
}

async function browse(session: Session, note: string): Promise<View> {
   const tree = await loadSlate();
   const nav = session.nav;
   const back: View["rows"] = [{ text: "🗒️ Menu", act: { t: "menu" } }];
   if (nav.name === "sports") {
      const { slice, page, pages } = pageOf(tree, nav.page);
      return {
         title: "Sports",
         text: note.trim(),
         rows: [
            ...slice.map((sport) => ({ text: withIcon(sportIcon(`${sport.name} ${sport.sport}`), sport.name), act: { t: "leagues" as const, sportId: sport.id, page: 0 } })),
            ...pager(page, pages, (next) => ({ t: "sports", page: next })),
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
            ...pager(page, pages, (next) => ({ t: "leagues", sportId: nav.sportId, page: next })),
            ...comboRow(session),
            { text: "↩️ Back", act: { t: "sports", page: 0 } },
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
            ...pager(page, pages, (next) => ({ t: "games", sportId: nav.sportId, leagueId: nav.leagueId, page: next })),
            ...comboRow(session),
            { text: "↩️ Back", act: { t: "leagues", sportId: nav.sportId, page: 0 } },
         ],
      };
   }
   if (nav.name === "search") {
      const { slice, page, pages } = pageOf(session.hits, nav.page);
      return {
         title: "Search",
         text: session.hits.length === 0 ? `${note}No games matched. Try another name.`.trim() : note.trim(),
         rows: [
            ...slice.map((hit) => ({ text: withIcon(sportIcon(hit.sportName), hit.label), act: { t: "game" as const, sportId: hit.sportId, leagueId: hit.leagueId, eventId: hit.eventId } })),
            ...pager(page, pages, (next) => ({ t: "searchPage", page: next })),
            { text: "🔍 Search again", act: { t: "search" } },
            ...back,
         ],
      };
   }
   const found = nav.name === "game" || nav.name === "sections" || nav.name === "section"
      ? findEvent(tree, nav.sportId, nav.leagueId, nav.eventId)
      : null;
   if (found == null || (nav.name !== "game" && nav.name !== "sections" && nav.name !== "section")) {
      return { text: `${note}That game is no longer on the slate.`, rows: back };
   }
   if (nav.name === "game") {
      const outcomes = mainOutcomes(found.event, session.oddsFormat);
      const extra = extraCount(found.event);
      return {
         title: matchLabel(found.event),
         text: `${note}${withIcon(leagueFlag(found.leagueName), found.leagueName)}\nEnter stake to get latest odds.`.trim(),
         rows: [
            ...outcomes.map((item, index) => ({ text: item.text, act: { t: "focus" as const, index } })),
            ...(extra > 0 ? [{ text: `More markets (${extra})`, act: { t: "sections" as const, sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, page: 0 } }] : []),
            ...comboRow(session),
            { text: "↩️ Back", act: { t: "games", sportId: nav.sportId, leagueId: nav.leagueId, page: 0 } },
         ],
      };
   }
   const sections = sectionsFor(found.event);
   if (nav.name === "sections") {
      const { slice, page, pages } = pageOf(sections, nav.page);
      return {
         title: matchLabel(found.event),
         text: `${note}More markets`.trim(),
         rows: [
            ...slice.map((section, index) => ({
               text: section.title,
               act: { t: "section" as const, sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, section: page * PAGE_SIZE + index, page: 0 },
            })),
            ...pager(page, pages, (next) => ({ t: "sections", sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, page: next })),
            ...comboRow(session),
            { text: "↩️ Back", act: { t: "game", sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId } },
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
         ...pager(page, pages, (next) => ({ t: "section", sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, section: nav.section, page: next })),
         ...comboRow(session),
         { text: "↩️ Back", act: { t: "sections", sportId: nav.sportId, leagueId: nav.leagueId, eventId: nav.eventId, page: 0 } },
      ],
   };
}

function outcomeView(session: Session, note: string): View {
   const leg = session.focus;
   if (leg == null) {
      return { text: `${note}Pick a price first.`, rows: [{ text: "🗒️ Menu", act: { t: "menu" } }] };
   }
   const inCombo = session.combo.some((item) => item.id === leg.id);
   const rows: View["rows"] = [
      { text: "Place bet", act: { t: "place" } },
   ];
   if (inCombo) {
      rows.push({ text: "🗑️ Remove from combo", act: { t: "unfocus" } });
   } else {
      rows.push({ text: "Add to combo", act: { t: "add" } });
   }
   if (session.combo.some((item) => item.id !== leg.id)) {
      rows.push({ text: "Add and bet combo", act: { t: "addbet" } });
   }
   rows.push({ text: "↩️ Back", act: { t: "back" } });
   return { text: `${note}${legSummary(leg, session.oddsFormat)}`, rows };
}

function comboView(session: Session, note: string): View {
   const rows: View["rows"] = [
      { text: "Add more", act: { t: "addMore" } },
   ];
   session.combo.forEach((leg, index) => {
      rows.push({ text: `🗑️ Remove ${leg.outcomeLabel}`.slice(0, 60), act: { t: "drop", index } });
   });
   if (session.combo.length >= 2) {
      rows.push({ text: "Bet combo", act: { t: "betCombo" } });
   }
   if (session.combo.length > 0) {
      rows.push({ text: "🚫 Clear", act: { t: "clearCombo" } });
   }
   const body = session.combo.length === 0
      ? "Combo is empty."
      : session.combo.map((leg, index) => `${index + 1}. ${leg.eventTitle} — ${leg.outcomeLabel}`).join("\n");
   return { title: `Combo (${session.combo.length})`, text: `${note}${body}`.trim(), rows };
}

async function slipView(session: Session, wallet: BotWallet, note: string): Promise<View> {
   const slip = session.slip;
   if (slip == null) {
      return { text: `${note}No slip.`, rows: [{ text: "🗒️ Menu", act: { t: "menu" } }] };
   }
   const rfqOnly = slip.legs.length > MAX_PARLAY_LEGS;
   const vouchers = await loadVouchers(wallet.address);
   const quoted = slip.quote?.topMms;
   const freebets = eligibleFreebets(vouchers.freebets, slip.legs, quoted);
   const boosts = eligibleBoosts(vouchers.boosts, slip.legs, quoted);
   const lines = slip.legs.map((leg, index) => `${index + 1}. ${leg.outcomeLabel} (${leg.eventTitle})`);
   const price = slip.stake != null && slip.quote != null ? oddsCoveringStake(slip.quote.topMms, slip.stake) : null;
   const covered = slip.quote == null ? 0n : slip.quote.topMms.reduce((sum, row) => sum + row.maxAmount, 0n);
   const payout = price == null || slip.stake == null ? null : (slip.stake * price) / ODDS_SCALE;
   const boost = slip.voucherKind === "boost"
      ? vouchers.boosts.find((row) => `${row.data.issuerAuth}:${row.data.boostId}` === slip.voucherKey)
      : null;
   const shownPayout = payout == null || slip.stake == null
      ? null
      : boost == null ? payout : boostedPayout(payout, slip.stake, boost.data.boostBps);
   const priceLine = price == null ? "" : `\nQuote ${formatOdds(price, session.oddsFormat)}`;
   const payoutLine = shownPayout == null ? "" : `\nPayout ${formatDollars(shownPayout)}`;
   const coverLine = price != null && slip.stake != null && covered < slip.stake
      ? `\nBook covers ${formatDollars(covered)}`
      : "";
   const stakeLine = slip.stake == null ? "\nEnter a stake." : `\nStake ${formatDollars(slip.stake)}`;
   const err = slip.quoteError ?? slip.rfqError;
   const rows: View["rows"] = slip.legs.map((leg, index) => ({ text: `🗑️ Remove ${leg.outcomeLabel}`.slice(0, 60), act: { t: "drop", index } }));
   if (slip.stake == null) {
      for (const preset of STAKE_PRESETS) {
         rows.push({ text: `$${preset}`, act: { t: "stake", amount: String(preset) } });
      }
      rows.push({ text: "Or type stake", act: { t: "stakeType" } });
   } else if (session.nav.name === "rfq") {
      slip.rfqQuotes.forEach((quote, index) => {
         const left = Math.max(0, quote.offerExpiry - Math.floor(Date.now() / 1000));
         rows.push({
            text: `${formatOdds(BigInt(quote.oddsScaled), session.oddsFormat)} · ${formatDollars(BigInt(quote.maxStake))} · ${left}s`.slice(0, 60),
            act: { t: "rfqPick", index },
         });
      });
      rows.push({ text: "Request again", act: { t: "rfq" } });
   } else {
      if (price != null) {
         rows.push({ text: "✅ Confirm", act: { t: "confirm" } });
         rows.push({ text: "Set min odds", act: { t: "min" } });
      }
      if (slip.voucherKind !== "freebet") {
         rows.push({ text: "Change stake", act: { t: "stakeType" } });
      }
      rows.push({ text: rfqOnly || price == null ? "Request RFQ" : "Request offchain quotes", act: { t: "rfq" } });
   }
   if (freebets.length > 0) {
      rows.push({ text: `Use freebet ${freebetLabel(freebets[0]!)}`.slice(0, 60), act: { t: "freebet" } });
   }
   if (boosts.length > 0) {
      rows.push({ text: `Use boost ${boostLabel(boosts[0]!)}`.slice(0, 60), act: { t: "boost" } });
   }
   if (slip.voucherKind != null) {
      rows.push({ text: "Cash stake", act: { t: "noVoucher" } });
   }
   rows.push({ text: "↩️ Back", act: { t: "back" } });
   const head = rfqOnly ? `On-chain quotes stop at ${MAX_PARLAY_LEGS} legs.\n` : "";
   const errLine = err == null ? "" : `\n${err}`;
   return { title: "Bet Slip", text: `${note}${head}${lines.join("\n")}${stakeLine}${priceLine}${payoutLine}${coverLine}${errLine}`.trim(), rows };
}

async function betsView(session: Session, wallet: BotWallet, note: string): Promise<View> {
   const nav = session.nav;
   if (nav.name !== "bets") {
      return { text: note, rows: [] };
   }
   const indexed = session.openRows
      .map((row, index) => ({ row, index }))
      .filter((item) => nav.tab === "pending" ? isPending(item.row) || isCashedOut(item.row) : canClaim(item.row));
   const { slice, page, pages } = pageOf(indexed, nav.page);
   const blocks: string[] = [];
   const buttons: View["rows"] = [
      { text: nav.tab === "pending" ? "See graded bets" : "See open bets", act: { t: "bets", tab: nav.tab === "pending" ? "graded" : "pending", page: 0 } },
   ];
   if (nav.tab === "graded" && indexed.length > 0) {
      buttons.push({ text: "Claim all", act: { t: "claim" } });
   }
   for (let i = 0; i < slice.length; i++) {
      const item = slice[i]!;
      const n = page * PAGE_SIZE + i + 1;
      blocks.push(`${n}. ${await describeRow(item.row, session.oddsFormat)}`);
      if (nav.tab === "pending" && canCashout(item.row)) {
         buttons.push({ text: `Cash Out Bet ${n}`, act: { t: "cash", index: item.index } });
      }
      if (nav.tab === "pending" && isCashedOut(item.row)) {
         const betId = item.row.kind === "single" ? item.row.data.betId : item.row.account.betId;
         const escrow = await loadEscrow(wallet.address, betId);
         if (escrow != null && escrowReady(escrow)) {
            buttons.push({ text: `Claim cashout ${await rowCashLabel(item.row)}`.slice(0, 60), act: { t: "escrow", index: item.index } });
         }
      }
   }
   return {
      title: nav.tab === "pending" ? "Open bets" : "Graded",
      text: `${note}${blocks.join("\n\n") || "None."}`.trim(),
      rows: [
         ...buttons,
         ...pager(page, pages, (next) => ({ t: "bets", tab: nav.tab, page: next })),
         { text: "Refresh", act: { t: "bets", tab: nav.tab, page } },
         { text: "🗒️ Menu", act: { t: "menu" } },
      ],
   };
}

function historyView(session: Session, note: string): View {
   const body = session.historyRows.length === 0
      ? "No claimed bets."
      : session.historyRows.map((row) => `${row.title}\n${row.detail}\n${row.stake} → ${row.payout}`).join("\n\n");
   return {
      title: "History",
      text: `${note}${body}`.trim(),
      rows: [
         ...(session.historyNext == null ? [] : [{ text: "Older", act: { t: "older" } as Act }]),
         { text: "🗒️ Menu", act: { t: "menu" } },
      ],
   };
}

function walletLines(sol: bigint, usdc: bigint, address: string): string {
   const solText = `SOL ${(Number(sol) / 1e9).toFixed(4)}`;
   const sponsored = sol < SOL_FREE_MIN_LAMPORTS ? `${solText} · transaction sponsorship active` : solText;
   return `${sponsored}\nUSDC ${formatUsdc(usdc)}\n${address}`;
}

async function walletView(session: Session, wallet: BotWallet, note: string): Promise<View> {
   const bal = await readBalances(wallet.address);
   const lines = walletLines(bal.sol, bal.usdc, wallet.address);
   const cluster = IS_DEVNET ? "devnet" : "mainnet";
   if (session.nav.name === "deposit") {
      return {
         title: "Deposit",
         text: `${note}Send only USDC on Solana ${cluster}.\n${lines}`.trim(),
         rows: [
            ...(IS_DEVNET ? [{ text: "Get test USDC", act: { t: "airdrop" } as Act }] : []),
            { text: "🗒️ Menu", act: { t: "menu" } },
         ],
      };
   }
   return { title: "Balance", text: `${note}${lines}`.trim(), rows: [{ text: "🗒️ Menu", act: { t: "menu" } }] };
}

export { historyView };
