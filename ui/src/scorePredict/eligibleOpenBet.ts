import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { BetResult } from 'spamm-aggregator-sdk';

import { filledOddsScaled } from '../betting/filledOdds';
/** Open singles from the SPAMM aggregator program (`getBetsData`), not score-predict. */
import { fetchOpenWalletBets, type WalletSingleRow } from '../markets/fetchBetHistory';
import type { UiGroupedEvent, UiGroupedSport } from '../markets/types';
import { sportsDayBoundsMs } from '../../../api/sportsDay';
import type { ApiPredictionContest } from './types';

const MIN_STAKE_BASE_UNITS = 1_000_000n;

export type QualifyingOpenBet = Readonly<{
   address: string;
   amount: bigint;
   row: WalletSingleRow;
   eventLabel: string;
}>;

function buildEventIndex(tree: UiGroupedSport[]): Map<string, UiGroupedEvent> {
   const map = new Map<string, UiGroupedEvent>();
   for (const sport of tree) {
      for (const league of sport.leagues) {
         for (const ev of league.events) {
            map.set(`${sport.id}:${league.id}:${ev.id}`, ev);
         }
      }
   }
   return map;
}

function eventLabel(ev: UiGroupedEvent): string {
   return ev.event_name || `${ev.home_name} vs ${ev.away_name}`;
}

function rowMatchesContestEvent(
   row: WalletSingleRow,
   contest: ApiPredictionContest,
   eventByKey: Map<string, UiGroupedEvent>,
): boolean {
   const m = row.data.marketId.eventId;
   const key = `${m.sport}:${m.league}:${m.event}`;
   const ev = eventByKey.get(key);
   if (!ev) {
      return false;
   }
   if (
      contest.event_id != null &&
      contest.event_sport_id != null &&
      contest.event_league_id != null
   ) {
      return (
         Number(m.sport) === contest.event_sport_id &&
         Number(m.league) === contest.event_league_id &&
         Number(m.event) === contest.event_id
      );
   }
   const { start, end } = sportsDayBoundsMs(contest.contest_date);
   return ev.start_time >= start && ev.start_time < end;
}

/** Prefer higher stake, then higher filled odds, then earlier placement (`timestamp`). */
function compareQualifyingBets(a: QualifyingOpenBet, b: QualifyingOpenBet): number {
   if (a.amount !== b.amount) {
      return a.amount > b.amount ? 1 : -1;
   }
   const oddsA = filledOddsScaled(a.row.data.amount, a.row.data.payout);
   const oddsB = filledOddsScaled(b.row.data.amount, b.row.data.payout);
   if (oddsA !== oddsB) {
      return oddsA > oddsB ? 1 : -1;
   }
   if (a.row.data.timestamp !== b.row.data.timestamp) {
      return a.row.data.timestamp < b.row.data.timestamp ? 1 : -1;
   }
   return 0;
}

/**
 * Among qualifying open singles (pending, stake >= $1, event rules), pick best by stake,
 * then filled odds, then earliest placement (`timestamp`).
 */
export function pickLargestQualifyingOpenBet(
   rows: readonly WalletSingleRow[],
   contest: ApiPredictionContest,
   eventTree: UiGroupedSport[],
): QualifyingOpenBet | null {
   const eventByKey = buildEventIndex(eventTree);
   const qualifying: QualifyingOpenBet[] = [];

   for (const row of rows) {
      if (row.kind !== 'single') {
         continue;
      }
      if (row.data.result !== BetResult.Pending) {
         continue;
      }
      if (row.data.amount < MIN_STAKE_BASE_UNITS) {
         continue;
      }
      if (!rowMatchesContestEvent(row, contest, eventByKey)) {
         continue;
      }
      const m = row.data.marketId.eventId;
      const key = `${m.sport}:${m.league}:${m.event}`;
      const ev = eventByKey.get(key);
      qualifying.push({
         address: row.address,
         amount: row.data.amount,
         row,
         eventLabel: ev ? eventLabel(ev) : key,
      });
   }

   if (qualifying.length === 0) {
      return null;
   }

   return qualifying.reduce((best, cur) => (compareQualifyingBets(cur, best) > 0 ? cur : best));
}

export async function resolveQualifyingOpenBet(params: {
   rpc: Rpc<SolanaRpcApi>;
   userAddress: string;
   contest: ApiPredictionContest;
   eventTree: UiGroupedSport[];
}): Promise<QualifyingOpenBet | null> {
   const open = await fetchOpenWalletBets(params.rpc, params.userAddress);
   const singles = open.filter((r): r is WalletSingleRow => r.kind === 'single');
   return pickLargestQualifyingOpenBet(singles, params.contest, params.eventTree);
}

export async function fetchEventsTree(): Promise<UiGroupedSport[]> {
   const apiDomain = import.meta.env.VITE_API_DOMAIN?.trim() ?? '';
   const res = await fetch(`${apiDomain}/api/events?all=true`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const data = await res.json();
   return Array.isArray(data) ? (data as UiGroupedSport[]) : [];
}
