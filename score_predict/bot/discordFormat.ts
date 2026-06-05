const DISCORD_CONTENT_MAX = 2000;
const CODE_BLOCK_OVERHEAD = 8;

export function ephemeralJsonBlock(label: string, value: unknown): string {
   const body = truncateForDiscord(
      typeof value === 'string' ? value : JSON.stringify(value, replacer, 2),
      DISCORD_CONTENT_MAX - label.length - 2,
   );
   return `${label}\n\`\`\`json\n${body}\n\`\`\``;
}

function replacer(_key: string, value: unknown): unknown {
   return typeof value === 'bigint' ? value.toString() : value;
}

function truncateForDiscord(text: string, max: number): string {
   if (text.length <= max) {
      return text;
   }
   const suffix = '\n… (truncated)';
   return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

export function formatPredictionRowsForDiscord(
   rows: ReadonlyArray<{
      address: unknown;
      data: {
         predictionId: bigint;
         contestId: number;
         owner: unknown;
         timestamp: number;
         prediction: readonly [number, number];
         openBet: unknown;
         tweetLink: string;
      };
   }>,
): string {
   const slim = rows.map((r) => ({
      pda: String(r.address),
      predictionId: r.data.predictionId.toString(),
      contestId: r.data.contestId,
      owner: String(r.data.owner),
      timestamp: r.data.timestamp,
      prediction: r.data.prediction,
      openBet: String(r.data.openBet),
      tweetLink: r.data.tweetLink,
   }));
   return ephemeralJsonBlock('Predictions', slim);
}
