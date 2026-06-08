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
];

export const marketDiscordCommands = marketCommandBuilders.map((c) => c.toJSON());
