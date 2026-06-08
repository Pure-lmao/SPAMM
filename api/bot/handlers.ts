import type { ChatInputCommandInteraction } from "discord.js";
import { addEventLineMarket, listUpcomingEvents, type MarketLineKind } from "../marketAdmin";
import { ephemeralJsonBlock } from "./discordFormat";

const EVENT_LIST_LIMIT = 40;

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

export const marketHandlers: Record<
   string,
   (interaction: ChatInputCommandInteraction) => Promise<void>
> = {
   "events-list": handleEventsList,
   "market-add": handleMarketAdd,
};
