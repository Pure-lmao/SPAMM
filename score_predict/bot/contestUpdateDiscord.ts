import type { ChatInputCommandInteraction } from 'discord.js';
import {
   normalizeReplyToTweetId,
   type UpdatePredictionContestPatch,
} from '../../api/localDb.ts';
import type { PredictionContestKind, PredictionContestStatus } from '../../api/types.ts';
import { parseDeadline } from '../client/contestParse.ts';
import { parseNullableUrl } from '../client/contestUpdate.ts';

export function patchFromDiscordUpdate(
   interaction: ChatInputCommandInteraction,
): UpdatePredictionContestPatch {
   const patch: UpdatePredictionContestPatch = {};

   const date = interaction.options.getString('date');
   if (date != null) {
      patch.contest_date = date;
   }

   const deadlineRaw = interaction.options.getString('deadline');
   if (deadlineRaw != null) {
      patch.deadline = parseDeadline(deadlineRaw);
   }

   const kind = interaction.options.getString('kind');
   if (kind != null) {
      patch.kind = kind as PredictionContestKind;
   }

   const title = interaction.options.getString('title');
   if (title != null) {
      patch.title = title;
   }

   const description = interaction.options.getString('description');
   if (description != null) {
      patch.description = description;
   }

   const tweetTemplate = interaction.options.getString('tweet_template');
   if (tweetTemplate != null) {
      patch.tweet_template = tweetTemplate;
   }

   if (interaction.options.getBoolean('clear_reply_to')) {
      patch.reply_to_tweet_id = null;
   } else {
      const replyRaw = interaction.options.getString('reply_to');
      if (replyRaw != null) {
         const reply_to_tweet_id = normalizeReplyToTweetId(replyRaw);
         if (!reply_to_tweet_id) {
            throw new Error(`Invalid reply_to: ${replyRaw}`);
         }
         patch.reply_to_tweet_id = reply_to_tweet_id;
      }
   }

   if (interaction.options.getBoolean('clear_event')) {
      patch.event_sport_id = null;
      patch.event_league_id = null;
      patch.event_id = null;
   } else {
      const sportId = interaction.options.getInteger('sport_id');
      if (sportId != null) {
         patch.event_sport_id = sportId;
      }
      const leagueId = interaction.options.getInteger('league_id');
      if (leagueId != null) {
         patch.event_league_id = leagueId;
      }
      const eventId = interaction.options.getInteger('event_id');
      if (eventId != null) {
         patch.event_id = eventId;
      }
   }

   const homeFlag = interaction.options.getString('home_flag');
   if (homeFlag != null) {
      patch.home_flag_url = parseNullableUrl(homeFlag);
   }

   const awayFlag = interaction.options.getString('away_flag');
   if (awayFlag != null) {
      patch.away_flag_url = parseNullableUrl(awayFlag);
   }

   const image = interaction.options.getString('image');
   if (image != null) {
      patch.image_url = parseNullableUrl(image);
   }

   const status = interaction.options.getString('status');
   if (status != null) {
      patch.status = status as PredictionContestStatus;
   }

   const notes = interaction.options.getString('result_notes');
   if (notes != null) {
      patch.result_notes = notes.trim() === '' ? null : notes;
   }

   return patch;
}
