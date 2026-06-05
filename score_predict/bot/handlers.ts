import type { ChatInputCommandInteraction } from 'discord.js';
import {
   addPredictionContest,
   fetchPredictionContest,
   listPredictionContests,
   normalizeReplyToTweetId,
   predictionContestToJson,
   updatePredictionContest,
   updatePredictionContestResult,
} from '../../api/localDb.ts';
import type { PredictionContestKind } from '../../api/types.ts';
import { parseContestResult, parseDeadline } from '../client/contestParse.ts';
import { patchFromDiscordUpdate } from './contestUpdateDiscord.ts';
import {
   closePredictionPda,
   fetchContestPredictions,
   fetchUserPredictions,
} from '../client/onchainAdmin.ts';
import { ephemeralJsonBlock, formatPredictionRowsForDiscord } from './discordFormat.ts';

export async function handlePredictionCreate(interaction: ChatInputCommandInteraction): Promise<void> {
   const replyRaw = interaction.options.getString('reply_to');
   const reply_to_tweet_id = normalizeReplyToTweetId(replyRaw);
   if (replyRaw && !reply_to_tweet_id) {
      throw new Error(`Invalid reply_to: ${replyRaw}`);
   }
   const idOpt = interaction.options.getInteger('id');
   const contest = addPredictionContest({
      id: idOpt ?? undefined,
      contest_date: interaction.options.getString('date', true),
      deadline: parseDeadline(interaction.options.getString('deadline', true)),
      kind: interaction.options.getString('kind', true) as PredictionContestKind,
      title: interaction.options.getString('title', true),
      description: interaction.options.getString('description', true),
      tweet_template: interaction.options.getString('tweet_template', true),
      reply_to_tweet_id,
      event_sport_id: interaction.options.getInteger('sport_id'),
      event_league_id: interaction.options.getInteger('league_id'),
      event_id: interaction.options.getInteger('event_id'),
      home_flag_url: interaction.options.getString('home_flag'),
      away_flag_url: interaction.options.getString('away_flag'),
      image_url: interaction.options.getString('image'),
      created_at: Date.now(),
   });
   await interaction.reply({
      content: ephemeralJsonBlock('Contest created', predictionContestToJson(contest)),
      ephemeral: true,
   });
}

export async function handlePredictionUpdate(interaction: ChatInputCommandInteraction): Promise<void> {
   const id = interaction.options.getInteger('id', true);
   const patch = patchFromDiscordUpdate(interaction);
   if (Object.keys(patch).length === 0) {
      throw new Error('Provide at least one field to update');
   }
   const updated = updatePredictionContest(id, patch);
   await interaction.reply({
      content: updated
         ? ephemeralJsonBlock(`Contest ${id} updated`, predictionContestToJson(updated))
         : `Contest ${id} not found`,
      ephemeral: true,
   });
}

export async function handlePredictionGet(interaction: ChatInputCommandInteraction): Promise<void> {
   const id = interaction.options.getInteger('id', true);
   const contest = fetchPredictionContest(id);
   await interaction.reply({
      content: ephemeralJsonBlock('Contest', contest ? predictionContestToJson(contest) : null),
      ephemeral: true,
   });
}

export async function handlePredictionList(interaction: ChatInputCommandInteraction): Promise<void> {
   const rows = listPredictionContests().slice(0, 20);
   await interaction.reply({
      content: ephemeralJsonBlock('Contests', rows.map(predictionContestToJson)),
      ephemeral: true,
   });
}

export async function handlePredictionResult(interaction: ChatInputCommandInteraction): Promise<void> {
   const id = interaction.options.getInteger('id', true);
   const resultRaw = interaction.options.getString('result', true);
   const contest = fetchPredictionContest(id);
   if (!contest) {
      await interaction.reply({ content: `Contest ${id} not found`, ephemeral: true });
      return;
   }
   const updated = updatePredictionContestResult(
      id,
      parseContestResult(contest.kind, resultRaw),
      interaction.options.getString('notes'),
   );
   await interaction.reply({
      content: updated
         ? ephemeralJsonBlock(`Contest ${id} graded`, predictionContestToJson(updated))
         : `Contest ${id} not found`,
      ephemeral: true,
   });
}

export async function handlePredictionFetchUser(
   interaction: ChatInputCommandInteraction,
): Promise<void> {
   const pubkey = interaction.options.getString('pubkey', true);
   await interaction.deferReply({ ephemeral: true });
   const rows = await fetchUserPredictions(pubkey);
   await interaction.editReply({ content: formatPredictionRowsForDiscord(rows) });
}

export async function handlePredictionFetchContest(
   interaction: ChatInputCommandInteraction,
): Promise<void> {
   const contestId = interaction.options.getInteger('contest_id', true);
   await interaction.deferReply({ ephemeral: true });
   const rows = await fetchContestPredictions(contestId);
   await interaction.editReply({ content: formatPredictionRowsForDiscord(rows) });
}

export async function handlePredictionClose(interaction: ChatInputCommandInteraction): Promise<void> {
   const owner = interaction.options.getString('owner', true);
   const contestId = interaction.options.getInteger('contest_id', true);
   const useAdmin = interaction.options.getBoolean('use_admin') ?? true;
   await interaction.deferReply({ ephemeral: true });
   const { signature, authority } = await closePredictionPda({
      ownerPubkey: owner,
      contestId,
      useAdmin,
   });
   await interaction.editReply({
      content: `Closed prediction for contest **${contestId}** (owner \`${owner}\`).\nAuthority: \`${authority}\`\nSignature: \`${signature}\``,
   });
}
