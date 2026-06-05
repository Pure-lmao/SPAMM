import { SlashCommandBuilder } from 'discord.js';

export const discordCommands = [
   new SlashCommandBuilder()
      .setName('prediction-create')
      .setDescription('Create a prediction contest (DB)')
      .addStringOption((o) => o.setName('date').setDescription('YYYY-MM-DD US sports day').setRequired(true))
      .addStringOption((o) => o.setName('deadline').setDescription('ISO datetime or unix ms').setRequired(true))
      .addStringOption((o) =>
         o.setName('kind').setDescription('match_score or daily_total').addChoices(
            { name: 'match_score', value: 'match_score' },
            { name: 'daily_total', value: 'daily_total' },
         ).setRequired(true),
      )
      .addStringOption((o) => o.setName('title').setDescription('Contest title shown in UI').setRequired(true))
      .addStringOption((o) =>
         o.setName('description').setDescription('Contest body text shown in UI').setRequired(true),
      )
      .addStringOption((o) =>
         o.setName('tweet_template').setDescription('Use {prediction}, {title}, {description}').setRequired(true),
      )
      .addStringOption((o) =>
         o.setName('reply_to').setDescription('Tweet id or status URL for in_reply_to').setRequired(false),
      )
      .addIntegerOption((o) => o.setName('id').setDescription('Optional fixed contest id').setRequired(false))
      .addIntegerOption((o) => o.setName('sport_id').setDescription('Linked event sport id').setRequired(false))
      .addIntegerOption((o) => o.setName('league_id').setDescription('Linked event league id').setRequired(false))
      .addIntegerOption((o) => o.setName('event_id').setDescription('Linked event id').setRequired(false))
      .addStringOption((o) => o.setName('home_flag').setDescription('Home team flag image URL').setRequired(false))
      .addStringOption((o) => o.setName('away_flag').setDescription('Away team flag image URL').setRequired(false))
      .addStringOption((o) => o.setName('image').setDescription('Contest hero image URL').setRequired(false)),
   new SlashCommandBuilder()
      .setName('prediction-get')
      .setDescription('Get a contest by id (DB)')
      .addIntegerOption((o) => o.setName('id').setDescription('Contest id').setRequired(true)),
   new SlashCommandBuilder()
      .setName('prediction-list')
      .setDescription('List prediction contests (DB)'),
   new SlashCommandBuilder()
      .setName('prediction-result')
      .setDescription('Set graded result for a contest (DB)')
      .addIntegerOption((o) => o.setName('id').setDescription('Contest id').setRequired(true))
      .addStringOption((o) =>
         o
            .setName('result')
            .setDescription('match_score: 2-1; daily_total: 500 (or 4 hex chars)')
            .setRequired(true),
      )
      .addStringOption((o) => o.setName('notes').setDescription('Optional grading notes').setRequired(false)),
   new SlashCommandBuilder()
      .setName('prediction-fetch-user')
      .setDescription('List on-chain predictions for a wallet')
      .addStringOption((o) => o.setName('pubkey').setDescription('Owner wallet address').setRequired(true)),
   new SlashCommandBuilder()
      .setName('prediction-fetch-contest')
      .setDescription('List on-chain predictions for a contest')
      .addIntegerOption((o) =>
         o.setName('contest_id').setDescription('Contest id to filter by').setRequired(true),
      ),
   new SlashCommandBuilder()
      .setName('prediction-close')
      .setDescription('Close a prediction PDA and reclaim rent')
      .addStringOption((o) => o.setName('owner').setDescription('Owner wallet address').setRequired(true))
      .addIntegerOption((o) =>
         o.setName('contest_id').setDescription('Contest id of the prediction').setRequired(true),
      )
      .addBooleanOption((o) =>
         o
            .setName('use_admin')
            .setDescription('Close as program admin (default true)')
            .setRequired(false),
      ),
].map((c) => c.toJSON());
