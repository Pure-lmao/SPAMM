import { MAX_RFQ_PARLAY_LEGS } from "spamm-aggregator-sdk";
import type { RfqHttpRequestJson, RfqQuoteJson } from "spamm-aggregator-sdk";
import type { QuoteFlowResult } from "./betting/quote";
import type { HistoryRow, WalletBetRow } from "./betting/bets";
import type { SearchHit } from "./markets/search";
import type { Leg } from "./markets/leg";
import { sameMarket } from "./markets/leg";
import type { Explorer } from "./network";
import type { OddsFormat } from "./usdc";
import type { Act } from "./screens/acts";

export type Nav =
   | { name: "menu" }
   | { name: "sports"; page: number }
   | { name: "leagues"; sportId: number; page: number }
   | { name: "games"; sportId: number; leagueId: number; page: number }
   | { name: "game"; sportId: number; leagueId: number; eventId: number }
   | { name: "sections"; sportId: number; leagueId: number; eventId: number; page: number }
   | { name: "section"; sportId: number; leagueId: number; eventId: number; section: number; page: number }
   | { name: "outcome" }
   | { name: "combo" }
   | { name: "slip" }
   | { name: "rfq" }
   | { name: "bets"; tab: "pending" | "graded"; page: number }
   | { name: "history"; page: number }
   | { name: "balance" }
   | { name: "deposit" }
   | { name: "search"; page: number }
   | { name: "cashout" }
   | { name: "withdraw" }
   | { name: "settings" }
   | { name: "help" }
   | { name: "alts" }
   | { name: "events" };

export type Phase = "idle" | "search" | "stake" | "minOdds" | "withdrawAddress" | "withdrawAmount" | "cashAmount";

export type Btn = { text: string; id: string };

export type SlipState = {
   legs: Leg[];
   fromCombo: boolean;
   stake: bigint | null;
   minOdds: string;
   quote: QuoteFlowResult | null;
   quoteError: string | null;
   rfqRequest: RfqHttpRequestJson | null;
   rfqQuotes: RfqQuoteJson[];
   rfqError: string | null;
   voucherKind: "freebet" | "boost" | null;
   voucherKey: string | null;
};

export type CashQuote = {
   index: number;
   /** Stake still on the bet. A typed cash out must be below this. */
   stake: bigint;
   amount: bigint;
   maxPayment: bigint;
   fillingMm: string;
   mmPrograms: string[];
   rfq: boolean;
};

export type Surface = "dm" | "group";

export type EphemeralPanel = { chatId: number; id: number };

export type Session = {
   userId: number;
   userName: string;
   lang: string;
   surface: Surface;
   canPost: boolean;
   nav: Nav;
   /** Screens under the current one. Back pops this. */
   trail: Nav[];
   /** Game or market list to return to when adding another combo leg. */
   pickFrom: Nav | null;
   /** Bold card title for the next menu render, such as Bet Placed. */
   heading: string | null;
   phase: Phase;
   combo: Leg[];
   focus: Leg | null;
   slip: SlipState | null;
   buttons: Btn[];
   acts: Act[];
   anchorId: number | null;
   ephemeral: EphemeralPanel | null;
   shareToken: string | null;
   altLegs: Leg[];
   eventLegs: Leg[];
   busy: boolean;
   notice: string | null;
   hits: SearchHit[];
   openRows: WalletBetRow[];
   historyRows: HistoryRow[];
   historyNext: string | null;
   historyCursor: string | null;
   cash: CashQuote | null;
   withdrawDest: string;
   withdrawAmount: bigint | null;
   oddsFormat: OddsFormat;
   explorer: Explorer;
};

export function emptySlip(legs: Leg[], fromCombo: boolean): SlipState {
   return {
      legs,
      fromCombo,
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
}

export function freshSession(): Session {
   return {
      userId: 0,
      userName: "",
      lang: "en",
      surface: "dm",
      canPost: false,
      nav: { name: "menu" },
      trail: [],
      pickFrom: null,
      heading: null,
      phase: "idle",
      combo: [],
      focus: null,
      slip: null,
      buttons: [],
      acts: [],
      anchorId: null,
      ephemeral: null,
      shareToken: null,
      altLegs: [],
      eventLegs: [],
      busy: false,
      notice: null,
      hits: [],
      openRows: [],
      historyRows: [],
      historyNext: null,
      historyCursor: null,
      cash: null,
      withdrawDest: "",
      withdrawAmount: null,
      oddsFormat: "decimal",
      explorer: "solscan",
   };
}

const sessions = new Map<number, Session>();

export function sessionFor(userId: number): Session {
   const existing = sessions.get(userId);
   if (existing != null) {
      existing.userId = userId;
      return existing;
   }
   const created = freshSession();
   created.userId = userId;
   sessions.set(userId, created);
   return created;
}

export function addComboLeg(session: Session, leg: Leg): string | null {
   if (session.combo.length >= MAX_RFQ_PARLAY_LEGS && !session.combo.some((item) => sameMarket(item, leg))) {
      return `Combo is full (${MAX_RFQ_PARLAY_LEGS})`;
   }
   session.combo = [...session.combo.filter((item) => !sameMarket(item, leg) && item.id !== leg.id), leg];
   return null;
}

export function go(session: Session, nav: Nav): void {
   session.trail.push(session.nav);
   session.nav = nav;
   session.phase = "idle";
   if (nav.name === "game" || nav.name === "section") {
      session.pickFrom = nav;
   }
}

export function popNav(session: Session): void {
   session.nav = session.trail.pop() ?? { name: "menu" };
   session.phase = "idle";
}
