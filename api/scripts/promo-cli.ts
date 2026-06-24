/**
 * Promo admin CLI — same operations as Discord market commands, no bot required.
 *
 * Usage:
 *   bun run promo events
 *   bun run promo create --title "..." --period-id 1 --event-id 12345
 *   bun run promo create --title "..." --period-id 0 --sport-id 1 --league-id 2 --chain-event-id 99999 --related-event-ids "111,222"
 *   bun run promo list
 *   bun run promo get --id 1
 *   bun run promo active
 *   bun run promo for-event --sport 1 --league 2 --event 12345
 *   bun run promo settle --id 1 --result yes [--notes "..."] [--grade]
 *   bun run market-add --event-id 12345 --type spread --line -1.5
 */

import {
   fetchActivePromotionalMarkets,
   fetchPromotionalMarket,
   fetchPromotionalMarketsForEvent,
   listPromotionalMarkets,
   promotionalMarketToJson,
} from "../localDb";
import { addEventLineMarket, listUpcomingEvents, type MarketLineKind } from "../marketAdmin";
import { safeJSONStringify } from "../utils";

const EVENT_LIST_LIMIT = 40;

function opt(name: string): string | undefined {
   const i = process.argv.indexOf(name);
   if (i < 0 || i + 1 >= process.argv.length) {
      return undefined;
   }
   return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
   return process.argv.includes(name);
}

function optInt(name: string): number | undefined {
   const raw = opt(name);
   if (raw == null) {
      return undefined;
   }
   const n = Number(raw);
   if (!Number.isFinite(n)) {
      throw new Error(`Invalid number for ${name}: ${raw}`);
   }
   return n;
}

function parseEventIdList(raw: string | undefined): number[] | undefined {
   const s = raw?.trim();
   if (!s) {
      return undefined;
   }
   const ids = s
      .split(/[,\s]+/)
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
   if (ids.length === 0) {
      throw new Error(`Invalid event id list: ${raw}`);
   }
   return ids;
}

function printJson(value: unknown): void {
   console.log(safeJSONStringify(value, 2));
}

function usage(): void {
   console.log(`Promo CLI (writes to api/data.db)

Subcommands:
  events                          List upcoming events (ids for --event-id)
  market-add                      Add spread/total line to an event
  create                          Create promotional market (mkt 9)
  list                            List all promotional markets
  get --id N                      Fetch one promo by id
  active                          List open promos (not past closes_at)
  for-event --sport S --league L --event E   Promos for an event page
  settle --id N --result yes|no   Settle promo (--grade to grade on-chain bets)

Create (single game):
  --title --period-id --event-id
  Optional: --description --yes-label

Create (multi/manual):
  --title --period-id --sport-id --league-id --chain-event-id
  Optional: --related-event-ids "1,2,3" --description --yes-label

Market add:
  --event-id --type spread|total --line <number>

Settle:
  --id --result yes|no
  Optional: --notes --grade
`);
}

async function cmdEvents(): Promise<void> {
   const all = listUpcomingEvents();
   const rows = all.slice(0, EVENT_LIST_LIMIT).map((e) => ({
      id: e.id,
      sport_id: e.sport_id,
      league_id: e.league_id,
      event: e.event_name,
      start: new Date(e.start_time).toISOString(),
   }));
   printJson({
      count: all.length,
      showing: rows.length,
      events: rows,
   });
}

async function cmdMarketAdd(): Promise<void> {
   const eventId = optInt("--event-id");
   const kind = opt("--type") as MarketLineKind | undefined;
   const line = optInt("--line");
   if (eventId == null || kind == null || line == null) {
      throw new Error("Required: --event-id --type spread|total --line <number>");
   }
   if (kind !== "spread" && kind !== "total") {
      throw new Error(`Invalid --type: ${kind}`);
   }
   const market = addEventLineMarket(eventId, kind, line);
   printJson(market);
}

async function cmdCreate(): Promise<void> {
   const title = opt("--title");
   const periodId = optInt("--period-id");
   if (!title || periodId == null) {
      throw new Error("Required: --title --period-id");
   }
   const { createPromotionalMarket } = await import("../promoAdmin");
   const promo = createPromotionalMarket({
      title,
      description: opt("--description"),
      yesLabel: opt("--yes-label"),
      periodId,
      eventId: optInt("--event-id"),
      sportId: optInt("--sport-id"),
      leagueId: optInt("--league-id"),
      chainEventId: optInt("--chain-event-id"),
      relatedEventIds: parseEventIdList(opt("--related-event-ids")),
   });
   printJson(promotionalMarketToJson(promo));
}

async function cmdList(): Promise<void> {
   const rows = listPromotionalMarkets().map(promotionalMarketToJson);
   printJson({ count: rows.length, promos: rows });
}

async function cmdGet(): Promise<void> {
   const id = optInt("--id");
   if (id == null) {
      throw new Error("Required: --id");
   }
   const promo = fetchPromotionalMarket(id);
   if (!promo) {
      throw new Error(`Promotional market ${id} not found`);
   }
   printJson(promotionalMarketToJson(promo));
}

async function cmdActive(): Promise<void> {
   const rows = fetchActivePromotionalMarkets().map(promotionalMarketToJson);
   printJson({ count: rows.length, promos: rows });
}

async function cmdForEvent(): Promise<void> {
   const sport = optInt("--sport");
   const league = optInt("--league");
   const event = optInt("--event");
   if (sport == null || league == null || event == null) {
      throw new Error("Required: --sport --league --event");
   }
   const rows = fetchPromotionalMarketsForEvent(sport, league, event).map(promotionalMarketToJson);
   printJson({ sport, league, event, count: rows.length, promos: rows });
}

async function cmdSettle(): Promise<void> {
   const id = optInt("--id");
   const result = opt("--result");
   if (id == null || (result !== "yes" && result !== "no")) {
      throw new Error("Required: --id --result yes|no");
   }
   const { settlePromotionalMarketAdmin } = await import("../promoAdmin");
   const promo = settlePromotionalMarketAdmin(id, result === "yes", opt("--notes") ?? null);
   const { gradePromoBets } = await import("../promoAdmin");
   const graded = await gradePromoBets(id);
   printJson({
      promo: promotionalMarketToJson(promo),
      graded_bets: graded ?? null,
   });
}

const commands: Record<string, () => Promise<void>> = {
   events: cmdEvents,
   "market-add": cmdMarketAdd,
   create: cmdCreate,
   list: cmdList,
   get: cmdGet,
   active: cmdActive,
   "for-event": cmdForEvent,
   settle: cmdSettle,
   help: async () => usage(),
};

const sub = process.argv[2];

if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
   usage();
   process.exit(sub ? 0 : 1);
}

const run = commands[sub];
if (!run) {
   console.error(`Unknown subcommand: ${sub}\n`);
   usage();
   process.exit(1);
}

run().catch((err: unknown) => {
   const message = err instanceof Error ? err.message : String(err);
   console.error(message);
   process.exit(1);
});
