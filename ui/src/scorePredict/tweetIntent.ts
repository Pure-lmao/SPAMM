import { formatPredictionForTweet, type PredictionKind } from 'spamm-score-predict-sdk';

const DEFAULT_MATCH_TWEET_TEMPLATE =
   'I am predicting a score of {prediction} in {title} in the @AutmtcSprtsMkts daily prediction contest to win $10 risk free bet.';

const DEFAULT_DAILY_TWEET_TEMPLATE =
   'I am predicting a total of {prediction} in {title} in the @AutmtcSprtsMkts daily prediction contest to win $10 risk free bet.';

function resolveTweetTemplate(tweetTemplate: string, kind: PredictionKind): string {
   const trimmed = stripEntryIdPlaceholders(tweetTemplate.trim());
   if (trimmed && trimmed.includes('{prediction}')) {
      return trimmed;
   }
   return kind === 'match_score' ? DEFAULT_MATCH_TWEET_TEMPLATE : DEFAULT_DAILY_TWEET_TEMPLATE;
}

/** Entry id is always appended in code — strip it from admin templates. */
function stripEntryIdPlaceholders(template: string): string {
   return template
      .replace(/\s*Entry id:\s*\{entry_id\}\s*/gi, ' ')
      .replace(/\{entry_id\}/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
}

function applyTweetTemplate(
   template: string,
   vars: Record<string, string>,
): string {
   let text = template;
   for (const [key, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${key}}`, value);
   }
   return text.trim();
}

function appendEntryId(body: string, predictionId: bigint): string {
   return `${body.trimEnd()} Entry id: ${predictionId.toString()}`;
}

export function buildExpectedTweetText(
   tweetTemplate: string,
   kind: PredictionKind,
   prediction: readonly [number, number],
   predictionId: bigint,
   context: { title: string; description: string },
): string {
   const template = resolveTweetTemplate(tweetTemplate, kind);
   const predictionLabel = formatPredictionForTweet(kind, prediction);
   const body = applyTweetTemplate(template, {
      prediction: predictionLabel,
      title: context.title,
      description: context.description,
   });
   return appendEntryId(body, predictionId);
}

export function replyToTweetUrl(tweetId: string): string {
   return `https://x.com/i/web/status/${tweetId.trim()}`;
}

export function buildTwitterIntentUrl(
   text: string,
   replyToTweetId?: string | null,
): string {
   const params = new URLSearchParams({ text });
   const id = replyToTweetId?.trim();
   if (id && /^\d+$/.test(id)) {
      params.set('in_reply_to', id);
   }
   return `https://twitter.com/intent/tweet?${params.toString()}`;
}
