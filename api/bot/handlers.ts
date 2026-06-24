import type { ChatInputCommandInteraction } from "discord.js";
import { addEventLineMarket, listUpcomingEvents, type MarketLineKind } from "../marketAdmin";
import { createPromotionalMarket, gradePromoBets, settlePromotionalMarketAdmin } from "../promoAdmin";
import { listPromotionalMarkets, promotionalMarketToJson } from "../localDb";
import { ephemeralJsonBlock } from "./discordFormat";

const EVENT_LIST_LIMIT = 40;
const PROMO_LIST_LIMIT = 25;

function parseEventIds(raw: string | null): number[] | undefined {
   const s = raw?.trim();
   if (!s) {
      return undefined;
   }
   const ids = s.split(/[,\s]+/).map((p) => Number(p.trim())).filter((n) => Number.isFinite(n) && n > 0);
   if (ids.length === 0) {
      throw new Error(`Invalid event id list: ${raw}`);
   }
   return ids;
}

export async function handleEventsList(interaction: ChatInputCommandInteraction): Promise<void> {
   const all = listUpcomingEvents();
   const rows = all.slice(0, EVENT_LIST_LIMIT);
   const payload = rows.map((e) => ({
      id: e.id,
      sport_id: e.sport_id,
      league_id: e.league_id,
      event: e.event_name,
      start: new Date(e.start_time).toISOString(),
   }));
   const suffix =
      all.length > EVENT_LIST_LIMIT ? `\n(Showing first ${EVENT_LIST_LIMIT} of ${all.length})` : "";
   await interaction.reply({
      content: ephemeralJsonBlock("Upcoming events", payload) + suffix,
      ephemeral: true,
   });
}

export async function handleMarketAdd(interaction: ChatInputCommandInteraction): Promise<void> {
   const eventId = interaction.options.getInteger("event_id", true);
   const kind = interaction.options.getString("type", true) as MarketLineKind;
   const line = interaction.options.getNumber("line", true);
   const market = addEventLineMarket(eventId, kind, line);
   await interaction.reply({
      content: ephemeralJsonBlock("Market added", market),
      ephemeral: true,
   });
}

export async function handlePromoCreate(interaction: ChatInputCommandInteraction): Promise<void> {
   const eventId = interaction.options.getInteger("event_id");
   const sportId = interaction.options.getInteger("sport_id");
   const leagueId = interaction.options.getInteger("league_id");
   const chainEventId = interaction.options.getInteger("chain_event_id");
   const periodId = interaction.options.getInteger("period_id", true);
   const promo = createPromotionalMarket({
      title: interaction.options.getString("title", true),
      description: interaction.options.getString("description") ?? undefined,
      yesLabel: interaction.options.getString("yes_label") ?? undefined,
      periodId,
      eventId: eventId ?? undefined,
      sportId: sportId ?? undefined,
      leagueId: leagueId ?? undefined,
      chainEventId: chainEventId ?? undefined,
      relatedEventIds: parseEventIds(interaction.options.getString("related_event_ids")),
   });
   await interaction.reply({
      content: ephemeralJsonBlock("Promotional market created", promotionalMarketToJson(promo)),
      ephemeral: true,
   });
}

export async function handlePromoSettle(interaction: ChatInputCommandInteraction): Promise<void> {
   const promoId = interaction.options.getInteger("promo_id", true);
   const result = interaction.options.getString("result", true) as "yes" | "no";
   const promo = settlePromotionalMarketAdmin(promoId, result === "yes", interaction.options.getString("notes"));
   const graded = await gradePromoBets(promoId);
   await interaction.reply({
      content:
         ephemeralJsonBlock(`Promotional market ${promoId} settled`, promotionalMarketToJson(promo)) +
         `\nGraded ${graded} bet(s).`,
      ephemeral: true,
   });
}

export async function handlePromoList(interaction: ChatInputCommandInteraction): Promise<void> {
   const all = listPromotionalMarkets();
   const rows = all.slice(0, PROMO_LIST_LIMIT);
   const suffix =
      all.length > PROMO_LIST_LIMIT ? `\n(Showing first ${PROMO_LIST_LIMIT} of ${all.length})` : "";
   await interaction.reply({
      content: ephemeralJsonBlock("Promotional markets", rows.map(promotionalMarketToJson)) + suffix,
      ephemeral: true,
   });
}

export const marketHandlers: Record<
   string,
   (interaction: ChatInputCommandInteraction) => Promise<void>
> = {
   "events-list": handleEventsList,
   "market-add": handleMarketAdd,
   "promo-create": handlePromoCreate,
   "promo-settle": handlePromoSettle,
   "promo-list": handlePromoList,
};
