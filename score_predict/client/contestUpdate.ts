import {
   normalizeReplyToTweetId,
   type UpdatePredictionContestPatch,
} from '../../api/localDb.ts';
import type { PredictionContestKind, PredictionContestStatus } from '../../api/types.ts';
import { parseDeadline } from './contestParse.ts';

export function parseNullableUrl(raw: string): string | null {
   const s = raw.trim();
   if (!s || s === 'none' || s === 'null') {
      return null;
   }
   return s;
}

function hasFlag(name: string): boolean {
   return process.argv.includes(name);
}

function opt(name: string): string | undefined {
   const i = process.argv.indexOf(name);
   if (i < 0 || i + 1 >= process.argv.length) {
      return undefined;
   }
   return process.argv[i + 1];
}

export function patchFromCliUpdate(): UpdatePredictionContestPatch {
   const patch: UpdatePredictionContestPatch = {};

   const date = opt('--date');
   if (date != null) {
      patch.contest_date = date;
   }

   const deadlineRaw = opt('--deadline');
   if (deadlineRaw != null) {
      patch.deadline = parseDeadline(deadlineRaw);
   }

   const kind = opt('--kind');
   if (kind != null) {
      patch.kind = kind as PredictionContestKind;
   }

   const title = opt('--title');
   if (title != null) {
      patch.title = title;
   }

   const description = opt('--description');
   if (description != null) {
      patch.description = description;
   }

   const tweetTemplate = opt('--tweet-template');
   if (tweetTemplate != null) {
      patch.tweet_template = tweetTemplate;
   }

   if (hasFlag('--clear-reply-to')) {
      patch.reply_to_tweet_id = null;
   } else {
      const replyRaw = opt('--reply-to');
      if (replyRaw != null) {
         const reply_to_tweet_id = normalizeReplyToTweetId(replyRaw);
         if (replyRaw.trim() && !reply_to_tweet_id) {
            throw new Error(`Invalid --reply-to: ${replyRaw}`);
         }
         patch.reply_to_tweet_id = reply_to_tweet_id;
      }
   }

   if (hasFlag('--clear-event')) {
      patch.event_sport_id = null;
      patch.event_league_id = null;
      patch.event_id = null;
   } else {
      if (hasFlag('--sport-id')) {
         patch.event_sport_id = Number(opt('--sport-id'));
      }
      if (hasFlag('--league-id')) {
         patch.event_league_id = Number(opt('--league-id'));
      }
      if (hasFlag('--event-id')) {
         patch.event_id = Number(opt('--event-id'));
      }
   }

   if (hasFlag('--home-flag')) {
      patch.home_flag_url = parseNullableUrl(opt('--home-flag') ?? '');
   }
   if (hasFlag('--away-flag')) {
      patch.away_flag_url = parseNullableUrl(opt('--away-flag') ?? '');
   }
   if (hasFlag('--image')) {
      patch.image_url = parseNullableUrl(opt('--image') ?? '');
   }

   const status = opt('--status');
   if (status != null) {
      patch.status = status as PredictionContestStatus;
   }

   if (hasFlag('--result-notes')) {
      const notes = opt('--result-notes');
      patch.result_notes = notes?.trim() === '' ? null : (notes ?? null);
   }

   return patch;
}
