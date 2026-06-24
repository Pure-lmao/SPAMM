import { SlashCommandBuilder } from "discord.js";

export const marketCommandBuilders = [
   new SlashCommandBuilder()
      .setName("events-list")
      .setDescription("List upcoming events with ids (markets DB)"),
   new SlashCommandBuilder()
      .setName("market-add")
      .setDescription("Add a spread or total line market to an event (markets DB)")
      .addIntegerOption((o) => o.setName("event_id").setDescription("Event id from events-list").setRequired(true))
      .addStringOption((o) =>
         o
            .setName("type")
            .setDescription("Market type")
            .addChoices(
               { name: "spread", value: "spread" },
               { name: "total", value: "total" },
            )
            .setRequired(true),
      )
      .addNumberOption((o) =>
         o.setName("line").setDescription("Line value (e.g. -1.5 spread or 2.5 total)").setRequired(true),
      ),
   new SlashCommandBuilder()
      .setName("promo-create")
      .setDescription("Create a promotional market (mkt 9)")
      .addStringOption((o) => o.setName("title").setDescription("Market title").setRequired(true))
      .addIntegerOption((o) =>
         o.setName("period_id").setDescription("Period id (0 or 1 for soccer)").setRequired(true),
      )
      .addIntegerOption((o) =>
         o.setName("event_id").setDescription("Single-game: event id from events-list"),
      )
      .addIntegerOption((o) => o.setName("sport_id").setDescription("Multi/manual: on-chain sport id"))
      .addIntegerOption((o) => o.setName("league_id").setDescription("Multi/manual: on-chain league id"))
      .addIntegerOption((o) =>
         o.setName("chain_event_id").setDescription("Multi/manual: on-chain event id"),
      )
      .addStringOption((o) =>
         o
            .setName("related_event_ids")
            .setDescription("Optional comma-separated event ids to link in UI (multi-game)"),
      )
      .addStringOption((o) => o.setName("description").setDescription("Optional description"))
      .addStringOption((o) => o.setName("yes_label").setDescription("Yes label (default: Yes)")),
   new SlashCommandBuilder()
      .setName("promo-settle")
      .setDescription("Settle a promotional market and grade its bets")
      .addIntegerOption((o) => o.setName("promo_id").setDescription("Promo id from promo-list").setRequired(true))
      .addStringOption((o) =>
         o
            .setName("result")
            .setDescription("Did Yes win?")
            .addChoices({ name: "yes", value: "yes" }, { name: "no", value: "no" })
            .setRequired(true),
      )
      .addStringOption((o) => o.setName("notes").setDescription("Optional notes")),
   new SlashCommandBuilder()
      .setName("promo-list")
      .setDescription("List promotional markets"),
];

export const marketDiscordCommands = marketCommandBuilders.map((c) => c.toJSON());
