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
      .setDescription("Create a promo (DB + on-chain MM bootstrap, mkt 9)")
      .addStringOption((o) => o.setName("title").setDescription("Market title").setRequired(true))
      .addIntegerOption((o) =>
         o.setName("period_id").setDescription("Period id (0 or 1 for soccer)").setRequired(true),
      )
      .addNumberOption((o) =>
         o.setName("odds").setDescription("Yes decimal odds (e.g. 1.90)").setRequired(true),
      )
      .addNumberOption((o) =>
         o.setName("max_usdc").setDescription("Max stake per bet (USDC)").setRequired(true),
      )
      .addNumberOption((o) =>
         o.setName("max_total_usdc").setDescription("Max total stake across bets (USDC)").setRequired(true),
      )
      .addStringOption((o) =>
         o
            .setName("allow")
            .setDescription("Optional wallet allowlist (comma-separated). Omit = anyone can bet"),
      )
      .addStringOption((o) =>
         o.setName("allow2").setDescription("More allowlist pubkeys if allow hits the 600 char cap"),
      )
      .addStringOption((o) =>
         o.setName("allow3").setDescription("More allowlist pubkeys if allow+allow2 are full"),
      )
      .addIntegerOption((o) =>
         o
            .setName("event_id")
            .setDescription("Single-game: catalog id from /events-list (copies sport/league/event)"),
      )
      .addIntegerOption((o) =>
         o
            .setName("sport_id")
            .setDescription("Manual SLE: on-chain sport id in the market key"),
      )
      .addIntegerOption((o) =>
         o
            .setName("league_id")
            .setDescription("Manual SLE: on-chain league id in the market key"),
      )
      .addIntegerOption((o) =>
         o
            .setName("chain_event_id")
            .setDescription("Manual SLE: on-chain event id in the market key"),
      )
      .addStringOption((o) =>
         o
            .setName("related_event_ids")
            .setDescription("Catalog event ids from /events-list to show on the card; sets close time"),
      )
      .addStringOption((o) => o.setName("description").setDescription("Optional description"))
      .addStringOption((o) => o.setName("yes_label").setDescription("Yes label (default: Yes)")),
   new SlashCommandBuilder()
      .setName("promo-set-odds")
      .setDescription("Update promo MM odds and DB last_odds")
      .addIntegerOption((o) => o.setName("promo_id").setDescription("Promo id from promo-list").setRequired(true))
      .addNumberOption((o) => o.setName("odds").setDescription("Yes decimal odds (e.g. 1.90)").setRequired(true)),
   new SlashCommandBuilder()
      .setName("promo-set-max")
      .setDescription("Set per-bet max USDC on the promo MM")
      .addIntegerOption((o) => o.setName("promo_id").setDescription("Promo id from promo-list").setRequired(true))
      .addNumberOption((o) => o.setName("max_usdc").setDescription("Max stake per bet (USDC)").setRequired(true)),
   new SlashCommandBuilder()
      .setName("promo-set-max-total")
      .setDescription("Set total max USDC on the promo MM")
      .addIntegerOption((o) => o.setName("promo_id").setDescription("Promo id from promo-list").setRequired(true))
      .addNumberOption((o) =>
         o.setName("max_total_usdc").setDescription("Max total stake (USDC)").setRequired(true),
      ),
   new SlashCommandBuilder()
      .setName("promo-status")
      .setDescription("Read on-chain promo MM oracle (caps, allowlist, odds)")
      .addIntegerOption((o) => o.setName("promo_id").setDescription("Promo id from promo-list").setRequired(true)),
   new SlashCommandBuilder()
      .setName("promo-close-market")
      .setDescription("Close promo MM market + event PDAs (does not settle DB)")
      .addIntegerOption((o) => o.setName("promo_id").setDescription("Promo id from promo-list").setRequired(true)),
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
