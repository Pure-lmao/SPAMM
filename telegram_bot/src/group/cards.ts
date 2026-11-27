import { InlineKeyboard } from "grammy";
import type { InputMessageContent, InputRichMessage } from "grammy/types";
import type { Api } from "grammy";
import { t } from "../i18n";
import type { Session } from "../session";
import { formatDollars, formatDecimalOdds } from "../usdc";
import { chainSide } from "../markets/leg";
import type { Leg } from "../markets/leg";
import { outcomesForMarket, primaryOutcomes, sectionsFor } from "../markets/board";
import { findEvent, loadSlate } from "../markets/slate";
import type { UiEvent } from "../markets/types";
import { getSnap, rememberSnap, settleSnap, stableId, attachChat, type Snap } from "./store";
import { go } from "../session";

function priceOf(leg: Leg): string {
   return leg.displayedDecimalOdds == null ? "—" : formatDecimalOdds(BigInt(Math.round(leg.displayedDecimalOdds * 10000)));
}

function esc(value: string): string {
   return value.replace(/[\\|*_`\[]/g, (ch) => `\\${ch}`);
}

export function cardMarkdown(snap: Snap, closed = false): string {
   const who = snap.ownerName === "" ? "Bet" : snap.ownerName;
   const lines = snap.legs.map((leg) => `${leg.eventTitle} — ${leg.outcomeLabel} · ${priceOf(leg)}`);
   const money: string[] = [];
   if (snap.stake != null) {
      try {
         money.push(`Stake ${formatDollars(BigInt(snap.stake))}`);
      } catch {
         money.push(`Stake ${snap.stake}`);
      }
   }
   if (snap.payout != null) {
      try {
         money.push(`Payout ${formatDollars(BigInt(snap.payout))}`);
      } catch {
         money.push(`Payout ${snap.payout}`);
      }
   }
   const result = closed ? "Closed" : snap.result != null && snap.result !== "Pending" ? snap.result : snap.kind === "ticket" ? "Pending" : "";
   const body = [lines.join("\n"), money.join("\n"), result].filter((part) => part !== "").join("\n\n");
   return `# ${esc(who)}\n\n${body.split("\n").filter((row) => row !== "").map((row) => esc(row)).join("\n\n")}`.slice(0, 8000);
}

export function cardRich(snap: Snap, closed = false): InputRichMessage {
   return { markdown: cardMarkdown(snap, closed), skip_entity_detection: true };
}

export async function legsOpen(legs: readonly Leg[]): Promise<boolean> {
   if (legs.length === 0) {
      return false;
   }
   const tree = await loadSlate();
   for (const leg of legs) {
      const found = findEvent(tree, leg.sportApiId, leg.leagueId, leg.eventId);
      const market = found?.event.markets?.find((item) => item.id === leg.marketWireId && item.period_id === leg.periodId && (item.player_id ?? 0) === leg.playerId);
      if (found == null || market == null) {
         return false;
      }
      const hit = outcomesForMarket(found.event, market).some((item) => item.leg.id === leg.id || chainSide(item.leg) === chainSide(leg));
      if (!hit) {
         return false;
      }
   }
   return true;
}

export async function otherLegs(leg: Leg): Promise<Leg[]> {
   const tree = await loadSlate();
   const found = findEvent(tree, leg.sportApiId, leg.leagueId, leg.eventId);
   const market = found?.event.markets?.find((item) => item.id === leg.marketWireId && item.period_id === leg.periodId && (item.player_id ?? 0) === leg.playerId);
   if (found == null || market == null) {
      return [];
   }
   const side = chainSide(leg);
   return outcomesForMarket(found.event, market).map((item) => item.leg).filter((item) => chainSide(item) !== side);
}

export function cardKeyboard(snap: Snap, open: boolean): InlineKeyboard {
   const kb = new InlineKeyboard();
   const live = open && snap.kind === "ticket" && (snap.result == null || snap.result === "Pending");
   if (live) {
      kb.text(t("en", "follow"), `f:${snap.id}`).success();
      if (snap.legs.length === 1) {
         kb.text(t("en", "other"), `o:${snap.id}`).danger();
      }
      kb.row();
   }
   if (snap.kind === "ticket" && snap.legs.length > 0) {
      kb.text(t("en", "moreMarkets"), `k:${snap.id}`);
   }
   return kb;
}

export function rememberPick(ownerId: number, ownerName: string, leg: Leg): Snap {
   return rememberSnap({
      id: stableId(`pick:${ownerId}:${leg.id}`),
      ownerId,
      ownerName,
      legs: [leg],
      stake: null,
      payout: null,
      result: null,
      betAddress: null,
      kind: "pick",
   });
}

export async function closeCard(api: Api, snap: Snap, result: string): Promise<void> {
   const next = settleSnap(snap.id, result);
   if (next == null) {
      return;
   }
   const closed = result === "Closed";
   const rich = cardRich(next, closed);
   const markup = { reply_markup: { inline_keyboard: [] } };
   if (next.inlineMessageId != null) {
      await api.editMessageTextInline(next.inlineMessageId, rich, markup);
      return;
   }
   if (next.chatId != null && next.messageId != null) {
      await api.editMessageText(next.chatId, next.messageId, rich, markup);
   }
}

export async function postSnap(api: Api, chatId: number, id: string): Promise<boolean> {
   const snap = getSnap(id);
   if (snap == null) {
      return false;
   }
   const open = (snap.result == null || snap.result === "Pending") && await legsOpen(snap.legs);
   const sent = await api.sendRichMessage(chatId, cardRich(snap), { reply_markup: cardKeyboard(snap, open) });
   attachChat(snap.id, sent.chat.id, sent.message_id);
   return true;
}

export async function followSnap(session: Session, id: string): Promise<void> {
   const snap = getSnap(id);
   if (snap == null || snap.legs.length === 0) {
      session.notice = t(session.lang, "gone");
      session.nav = { name: "menu" };
      return;
   }
   if (!(await legsOpen(snap.legs))) {
      session.notice = t(session.lang, "bettingClosed");
      return;
   }
   session.trail.push(session.nav);
   session.slip = {
      legs: snap.legs,
      fromCombo: false,
      stake: null,
      minOdds: "",
      quote: null,
      quoteError: null,
      rfqRequest: null,
      rfqQuotes: [],
      rfqError: null,
      voucherKind: null,
      voucherKey: null,
   };
   session.nav = { name: "slip" };
   session.phase = "stake";
   session.notice = null;
}

export async function otherSnap(session: Session, id: string): Promise<void> {
   const snap = getSnap(id);
   const leg = snap?.legs[0];
   if (snap == null || leg == null) {
      session.notice = t(session.lang, "gone");
      return;
   }
   if (snap.legs.length !== 1) {
      return;
   }
   const alts = await otherLegs(leg);
   if (alts.length === 0) {
      session.notice = t(session.lang, "bettingClosed");
      return;
   }
   if (alts.length === 1) {
      session.trail.push(session.nav);
      session.slip = {
         legs: [alts[0]!],
         fromCombo: false,
         stake: null,
         minOdds: "",
         quote: null,
         quoteError: null,
         rfqRequest: null,
         rfqQuotes: [],
         rfqError: null,
         voucherKind: null,
         voucherKey: null,
      };
      session.nav = { name: "slip" };
      session.phase = "stake";
      session.notice = null;
      return;
   }
   session.altLegs = alts;
   session.trail.push(session.nav);
   session.nav = { name: "alts" };
   session.phase = "idle";
   session.notice = null;
}

function eventKey(leg: Leg): string {
   return `${leg.sportApiId}:${leg.leagueId}:${leg.eventId}`;
}

export async function openEventMarkets(session: Session, leg: Leg): Promise<void> {
   const tree = await loadSlate();
   const found = findEvent(tree, leg.sportApiId, leg.leagueId, leg.eventId);
   if (found == null) {
      session.notice = t(session.lang, "bettingClosed");
      return;
   }
   const sections = sectionsFor(found.event);
   go(session, sections.length > 0
      ? { name: "sections", sportId: leg.sportApiId, leagueId: leg.leagueId, eventId: leg.eventId, page: 0 }
      : { name: "game", sportId: leg.sportApiId, leagueId: leg.leagueId, eventId: leg.eventId });
   session.notice = null;
}

export async function marketsSnap(session: Session, id: string): Promise<void> {
   const snap = getSnap(id);
   if (snap == null || snap.legs.length === 0) {
      session.notice = t(session.lang, "gone");
      return;
   }
   const events: Leg[] = [];
   const seen = new Set<string>();
   for (const leg of snap.legs) {
      const key = eventKey(leg);
      if (seen.has(key)) {
         continue;
      }
      seen.add(key);
      events.push(leg);
   }
   if (events.length === 1) {
      await openEventMarkets(session, events[0]!);
      return;
   }
   session.eventLegs = events;
   go(session, { name: "events" });
   session.notice = null;
}

function moneyLine(snap: Snap): string {
   const parts: string[] = [];
   if (snap.stake != null) {
      try {
         parts.push(formatDollars(BigInt(snap.stake)));
      } catch {
         parts.push(snap.stake);
      }
   }
   if (snap.payout != null) {
      try {
         const payout = formatDollars(BigInt(snap.payout));
         parts.push(parts.length === 0 ? payout : `→ ${payout}`);
      } catch {
         parts.push(snap.payout);
      }
   }
   return parts.join(" ");
}

export function gameArticle(ownerId: number, ownerName: string, event: UiEvent) {
   const outcomes = primaryOutcomes(event);
   const kb = new InlineKeyboard();
   let pointer: string | null = null;
   for (const outcome of outcomes) {
      const snap = rememberPick(ownerId, ownerName, outcome.leg);
      pointer = pointer ?? snap.id;
      kb.text(outcome.text.slice(0, 60), `f:${snap.id}`).row();
   }
   if (pointer != null) {
      kb.text(t("en", "moreMarkets"), `k:${pointer}`);
   }
   const title = `${event.home_name} vs ${event.away_name}`;
   const body = outcomes.map((outcome) => outcome.text).join("\n\n");
   return {
      type: "article" as const,
      id: stableId(`game:${event.sport_id}:${event.league_id}:${event.id}`),
      title: title.slice(0, 120),
      description: outcomes.map((outcome) => outcome.text).join(" · ").slice(0, 180),
      input_message_content: {
         rich_message: {
            markdown: `# ${esc(title)}\n\n${body.split("\n").map((row) => esc(row)).join("\n")}`.slice(0, 8000),
            skip_entity_detection: true,
         },
      } as InputMessageContent,
      reply_markup: kb,
   };
}

export function inlineArticle(snap: Snap, open: boolean) {
   const stake = moneyLine(snap);
   const result = snap.result != null && snap.result !== "Pending" ? snap.result : "";
   const single = snap.legs.length <= 1;
   const title = single
      ? (snap.legs[0]?.eventTitle ?? "Bet")
      : `Parlay (${snap.legs.length})`;
   const sides = snap.legs.map((leg) => single
      ? `${leg.outcomeLabel} · ${priceOf(leg)}`
      : `${leg.outcomeLabel} · ${leg.eventTitle}`).join(", ");
   const description = [sides, stake, result].filter((part) => part !== "").join(" · ").slice(0, 180);
   return {
      type: "article" as const,
      id: snap.id,
      title: title.slice(0, 120),
      description,
      input_message_content: { rich_message: cardRich(snap) } as InputMessageContent,
      reply_markup: cardKeyboard(snap, open),
   };
}
