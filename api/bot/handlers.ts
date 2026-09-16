import type { ChatInputCommandInteraction } from "discord.js";
import { addEventLineMarket, listUpcomingEvents, type MarketLineKind } from "../marketAdmin";
import {
   closePromoMarket,
   createPromotionalMarket,
   gradePromoBets,
   parseAllowAddresses,
   promoMarketStatus,
   setPromoMaxTotalUsdc,
   setPromoMaxUsdc,
   setPromoOdds,
   settlePromotionalMarketAdmin,
} from "../promoAdmin";
import { listPromotionalMarkets, promotionalMarketToJson } from "../localDb";
import { ephemeralJsonBlock, ephemeralLineList } from "./discordFormat";

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

function collectAllow(interaction: ChatInputCommandInteraction) {
   const parts = [
      interaction.options.getString("allow") ?? "",
      interaction.options.getString("allow2") ?? "",
      interaction.options.getString("allow3") ?? "",
   ].filter((s) => s.trim() !== "");
   return parseAllowAddresses(parts.join(","));
}

export async function handleEventsList(interaction: ChatInputCommandInteraction): Promise<void> {
   const all = listUpcomingEvents();
   const lines = all.slice(0, EVENT_LIST_LIMIT).map((e) => {
      const start = new Date(e.start_time).toISOString().slice(0, 16);
      return `${e.id}  ${e.sport_id}:${e.league_id}  ${start}  ${e.event_name}`;
   });
   await interaction.reply({
      content: ephemeralLineList("Upcoming events", lines, all.length),
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
   await interaction.deferReply({ ephemeral: true });
   const eventId = interaction.options.getInteger("event_id");
   const sportId = interaction.options.getInteger("sport_id");
   const leagueId = interaction.options.getInteger("league_id");
   const chainEventId = interaction.options.getInteger("chain_event_id");
   const periodId = interaction.options.getInteger("period_id", true);
   const promo = await createPromotionalMarket({
      title: interaction.options.getString("title", true),
      description: interaction.options.getString("description") ?? undefined,
      yesLabel: interaction.options.getString("yes_label") ?? undefined,
      periodId,
      eventId: eventId ?? undefined,
      sportId: sportId ?? undefined,
      leagueId: leagueId ?? undefined,
      chainEventId: chainEventId ?? undefined,
      relatedEventIds: parseEventIds(interaction.options.getString("related_event_ids")),
      allow: collectAllow(interaction),
      odds: interaction.options.getNumber("odds", true),
      maxUsdc: interaction.options.getNumber("max_usdc", true),
      maxTotalUsdc: interaction.options.getNumber("max_total_usdc", true),
   });
   await interaction.editReply({
      content: ephemeralJsonBlock("Promotional market created", promotionalMarketToJson(promo)),
   });
}

export async function handlePromoSetOdds(interaction: ChatInputCommandInteraction): Promise<void> {
   await interaction.deferReply({ ephemeral: true });
   const promo = await setPromoOdds(
      interaction.options.getInteger("promo_id", true),
      interaction.options.getNumber("odds", true),
   );
   await interaction.editReply({
      content: ephemeralJsonBlock("Promo odds updated", promotionalMarketToJson(promo)),
   });
}

export async function handlePromoSetMax(interaction: ChatInputCommandInteraction): Promise<void> {
   await interaction.deferReply({ ephemeral: true });
   const promoId = interaction.options.getInteger("promo_id", true);
   await setPromoMaxUsdc(promoId, interaction.options.getNumber("max_usdc", true));
   await interaction.editReply({ content: `Promo ${promoId} max USDC updated.` });
}

export async function handlePromoSetMaxTotal(interaction: ChatInputCommandInteraction): Promise<void> {
   await interaction.deferReply({ ephemeral: true });
   const promoId = interaction.options.getInteger("promo_id", true);
   await setPromoMaxTotalUsdc(promoId, interaction.options.getNumber("max_total_usdc", true));
   await interaction.editReply({ content: `Promo ${promoId} max total USDC updated.` });
}

export async function handlePromoStatus(interaction: ChatInputCommandInteraction): Promise<void> {
   await interaction.deferReply({ ephemeral: true });
   const status = await promoMarketStatus(interaction.options.getInteger("promo_id", true));
   await interaction.editReply({
      content: ephemeralJsonBlock("Promo MM on-chain status", status),
   });
}

export async function handlePromoCloseMarket(interaction: ChatInputCommandInteraction): Promise<void> {
   await interaction.deferReply({ ephemeral: true });
   const promoId = interaction.options.getInteger("promo_id", true);
   await closePromoMarket(promoId);
   await interaction.editReply({
      content: `Promo ${promoId} on-chain market closed. DB row is still open until /promo-settle.`,
   });
}

export async function handlePromoSettle(interaction: ChatInputCommandInteraction): Promise<void> {
   await interaction.deferReply({ ephemeral: true });
   const promoId = interaction.options.getInteger("promo_id", true);
   const result = interaction.options.getString("result", true) as "yes" | "no";
   const promo = settlePromotionalMarketAdmin(promoId, result === "yes", interaction.options.getString("notes"));
   const graded = await gradePromoBets(promoId);
   await interaction.editReply({
      content: ephemeralJsonBlock(
         `Promotional market ${promoId} settled`,
         promotionalMarketToJson(promo),
         `\nGraded ${graded} bet(s).`,
      ),
   });
}

export async function handlePromoList(interaction: ChatInputCommandInteraction): Promise<void> {
   const all = listPromotionalMarkets();
   const rows = all.slice(0, PROMO_LIST_LIMIT);
   const extra =
      all.length > PROMO_LIST_LIMIT ? `\n(Showing first ${PROMO_LIST_LIMIT} of ${all.length})` : "";
   await interaction.reply({
      content: ephemeralJsonBlock("Promotional markets", rows.map(promotionalMarketToJson), extra),
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
   "promo-set-odds": handlePromoSetOdds,
   "promo-set-max": handlePromoSetMax,
   "promo-set-max-total": handlePromoSetMaxTotal,
   "promo-status": handlePromoStatus,
   "promo-close-market": handlePromoCloseMarket,
   "promo-settle": handlePromoSettle,
   "promo-list": handlePromoList,
};
