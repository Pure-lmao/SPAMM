import type { PredictionKind } from 'spamm-score-predict-sdk';

const STORAGE_KEY = 'scorePredict.entryDraft.v1';

export type ScorePredictEntryDraft = {
   contestId: number;
   contestDate: string;
   wallet: string | null;
   kind: PredictionKind;
   homeScore: number;
   awayScore: number;
   dailyTotal: number;
   tweetUrl: string;
};

function readStore(): ScorePredictEntryDraft | null {
   try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
         return null;
      }
      const parsed = JSON.parse(raw) as ScorePredictEntryDraft;
      if (
         typeof parsed.contestId !== 'number' ||
         typeof parsed.contestDate !== 'string' ||
         typeof parsed.kind !== 'string'
      ) {
         return null;
      }
      return parsed;
   } catch {
      return null;
   }
}

export function loadEntryDraft(
   contestId: number,
   contestDate: string,
): ScorePredictEntryDraft | null {
   const draft = readStore();
   if (!draft || draft.contestId !== contestId || draft.contestDate !== contestDate) {
      return null;
   }
   return draft;
}

export function saveEntryDraft(draft: ScorePredictEntryDraft): void {
   try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
   } catch {
      // quota / private mode
   }
}

export function clearEntryDraft(): void {
   try {
      localStorage.removeItem(STORAGE_KEY);
   } catch {
      // ignore
   }
}
