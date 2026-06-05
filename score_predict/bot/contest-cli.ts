/**
 * Contest admin CLI — writes to api/data.db via localDb.
 *
 * Usage:
 *   bun run contest-cli.ts create --date 2026-06-03 --deadline 2026-06-03T18:00:00Z ...
 *   bun run contest-cli.ts set-result --id 1 --result 2-1 --notes "Final"
 *   bun run contest-cli.ts list
 *   bun run contest-cli.ts get --id 1
 *   bun run contest-cli.ts update --id 1 --title "New title"
 */

import {
   addPredictionContest,
   fetchPredictionContest,
   listPredictionContests,
   normalizeReplyToTweetId,
   predictionContestToJson,
   updatePredictionContest,
   updatePredictionContestResult,
   type AddPredictionContestInput,
} from '../../api/localDb.ts';
import type { PredictionContestKind } from '../../api/types.ts';
import { jsonStringify, parseContestResult, parseDeadline } from '../client/contestParse.ts';
import { patchFromCliUpdate } from '../client/contestUpdate.ts';

function opt(name: string): string | undefined {
   const i = process.argv.indexOf(name);
   if (i < 0 || i + 1 >= process.argv.length) {
      return undefined;
   }
   return process.argv[i + 1];
}

async function cmdCreate(): Promise<void> {
   const date = opt('--date');
   const deadlineRaw = opt('--deadline');
   const kind = opt('--kind') as PredictionContestKind | undefined;
   const title = opt('--title');
   const description = opt('--description');
   const tweetTemplate = opt('--tweet-template');
   if (!date || !deadlineRaw || !kind || !title || !description || !tweetTemplate) {
      console.error(
         'Required: --date YYYY-MM-DD (US Eastern sports day) --deadline ISO|ms --kind match_score|daily_total --title --description --tweet-template',
      );
      console.error('Optional: --reply-to TWEET_ID_OR_STATUS_URL (in_reply_to on post intent)');
      process.exit(1);
   }
   const replyRaw = opt('--reply-to');
   const reply_to_tweet_id = normalizeReplyToTweetId(replyRaw);
   if (replyRaw && !reply_to_tweet_id) {
      throw new Error(`Invalid --reply-to: ${replyRaw} (numeric id or .../status/123)`);
   }
   const input: AddPredictionContestInput = {
      contest_date: date,
      deadline: parseDeadline(deadlineRaw),
      kind,
      title,
      description,
      tweet_template: tweetTemplate,
      reply_to_tweet_id,
      event_sport_id: opt('--sport-id') != null ? Number(opt('--sport-id')) : null,
      event_league_id: opt('--league-id') != null ? Number(opt('--league-id')) : null,
      event_id: opt('--event-id') != null ? Number(opt('--event-id')) : null,
      home_flag_url: opt('--home-flag') ?? null,
      away_flag_url: opt('--away-flag') ?? null,
      image_url: opt('--image') ?? null,
      created_at: Date.now(),
   };
   if (opt('--id') != null) {
      input.id = Number(opt('--id'));
   }
   const contest = addPredictionContest(input);
   console.log(jsonStringify(predictionContestToJson(contest)));
}

async function cmdSetResult(): Promise<void> {
   const id = Number(opt('--id'));
   const resultRaw = opt('--result');
   if (!Number.isFinite(id) || !resultRaw) {
      console.error('Required: --id --result VALUE [--notes text]');
      console.error('  match_score: HOME-AWAY (e.g. 2-1); daily_total: integer (e.g. 500)');
      process.exit(1);
   }
   const contest = fetchPredictionContest(id);
   if (!contest) {
      console.error(`Contest ${id} not found`);
      process.exit(1);
   }
   const updated = updatePredictionContestResult(
      id,
      parseContestResult(contest.kind, resultRaw),
      opt('--notes') ?? null,
   );
   console.log(jsonStringify(updated ? predictionContestToJson(updated) : null));
}

async function cmdGet(): Promise<void> {
   const id = Number(opt('--id'));
   if (!Number.isFinite(id)) {
      console.error('Required: --id');
      process.exit(1);
   }
   const c = fetchPredictionContest(id);
   console.log(jsonStringify(c ? predictionContestToJson(c) : null));
}

async function cmdList(): Promise<void> {
   const rows = listPredictionContests();
   console.log(jsonStringify(rows.map(predictionContestToJson)));
}

async function cmdUpdate(): Promise<void> {
   const id = Number(opt('--id'));
   if (!Number.isFinite(id)) {
      console.error('Required: --id');
      console.error(
         'Optional: --date --deadline --kind --title --description --tweet-template --reply-to --status',
      );
      console.error(
         '  --sport-id --league-id --event-id --home-flag --away-flag --image --result-notes',
      );
      console.error('  --clear-reply-to --clear-event (omit value flags to leave unchanged)');
      process.exit(1);
   }
   const patch = patchFromCliUpdate();
   if (Object.keys(patch).length === 0) {
      console.error('Provide at least one field to update');
      process.exit(1);
   }
   const updated = updatePredictionContest(id, patch);
   console.log(jsonStringify(updated ? predictionContestToJson(updated) : null));
}

const sub = process.argv[2];
if (sub === 'create') {
   await cmdCreate();
} else if (sub === 'set-result') {
   await cmdSetResult();
} else if (sub === 'get') {
   await cmdGet();
} else if (sub === 'list') {
   await cmdList();
} else if (sub === 'update') {
   await cmdUpdate();
} else {
   console.log(`Unknown command: ${sub ?? '(none)'}`);
   console.log('Commands: create | update | set-result | get | list');
   process.exit(1);
}
