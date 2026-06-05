import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { BetResult } from 'spamm-aggregator-sdk';

import { filledOddsScaled } from '../betting/filledOdds';
/** Open singles from the SPAMM aggregator program (`getBetsData`), not score-predict. */
import { fetchOpenWalletBets, type WalletSingleRow } from '../markets/fetchBetHistory';
import type { UiGroupedEvent, UiGroupedSport } from '../markets/types';
import { sportsDayBoundsMs } from '../../../api/sportsDay';
import type { ApiPredictionContest } from './types';

const MIN_STAKE_BASE_UNITS = 1_000_000n;
const LOG_PREFIX = '[score-predict:eligible]';

/** Dev console, or `localStorage.setItem('scorePredict.debugEligible', '1')` then reload. */
export function eligibleDebugEnabled(): boolean {
   if (import.meta.env.DEV) {
      return true;
   }
   try {
      return localStorage.getItem('scorePredict.debugEligible') === '1';
   } catch {
      return false;
   }
}

function betResultLabel(result: BetResult): string {
   return BetResult[result] ?? `Unknown(${result})`;
}

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

type EventMatchExplain =
   | { ok: true; mode: 'explicit_ids' | 'sports_day' }
   | { ok: false; reason: string; detail: Record<string, unknown> };

function explainContestEventMatch(
   row: WalletSingleRow,
   contest: ApiPredictionContest,
   eventByKey: Map<string, UiGroupedEvent>,
): EventMatchExplain {
   const m = row.data.marketId.eventId;
   const key = `${m.sport}:${m.league}:${m.event}`;
   const ev = eventByKey.get(key);
   if (!ev) {
      return {
         ok: false,
         reason: 'event_not_in_api_tree',
         detail: { eventKey: key, eventsIndexSize: eventByKey.size },
      };
   }
   if (
      contest.event_id != null &&
      contest.event_sport_id != null &&
      contest.event_league_id != null
   ) {
      const sportOk = Number(m.sport) === contest.event_sport_id;
      const leagueOk = Number(m.league) === contest.event_league_id;
      const eventOk = Number(m.event) === contest.event_id;
      if (sportOk && leagueOk && eventOk) {
         return { ok: true, mode: 'explicit_ids' };
      }
      return {
         ok: false,
         reason: 'explicit_event_id_mismatch',
         detail: {
            bet: { sport: Number(m.sport), league: Number(m.league), event: Number(m.event) },
            contest: {
               sport: contest.event_sport_id,
               league: contest.event_league_id,
               event: contest.event_id,
            },
            sportOk,
            leagueOk,
            eventOk,
            eventLabel: eventLabel(ev),
            eventStartTime: ev.start_time,
         },
      };
   }
   const { start, end } = sportsDayBoundsMs(contest.contest_date);
   const inDay = ev.start_time >= start && ev.start_time < end;
   if (inDay) {
      return { ok: true, mode: 'sports_day' };
   }
   return {
      ok: false,
      reason: 'outside_contest_sports_day',
      detail: {
         contestDate: contest.contest_date,
         sportsDayStartMs: start,
         sportsDayEndMs: end,
         sportsDayStartIso: new Date(start).toISOString(),
         sportsDayEndIso: new Date(end).toISOString(),
         eventStartTimeMs: ev.start_time,
         eventStartTimeIso: new Date(ev.start_time).toISOString(),
         eventLabel: eventLabel(ev),
         eventKey: key,
      },
   };
}

function explainSingleRejection(
   row: WalletSingleRow,
   contest: ApiPredictionContest,
   eventByKey: Map<string, UiGroupedEvent>,
): string | null {
   if (row.kind !== 'single') {
      return 'not_single';
   }
   if (row.data.result !== BetResult.Pending) {
      return `result_${betResultLabel(row.data.result)}`;
   }
   if (row.data.amount < MIN_STAKE_BASE_UNITS) {
      return `stake_below_min (${row.data.amount.toString()} < ${MIN_STAKE_BASE_UNITS.toString()})`;
   }
   const eventMatch = explainContestEventMatch(row, contest, eventByKey);
   if (!eventMatch.ok) {
      return eventMatch.reason;
   }
   return null;
}

function logEligibleDebug(
   contest: ApiPredictionContest,
   allOpen: readonly { kind: string }[],
   singles: readonly WalletSingleRow[],
   eventByKey: Map<string, UiGroupedEvent>,
   picked: QualifyingOpenBet | null,
): void {
   const explicitIds =
      contest.event_id != null &&
      contest.event_sport_id != null &&
      contest.event_league_id != null;
   const bounds = sportsDayBoundsMs(contest.contest_date);

   console.group(`${LOG_PREFIX} resolve`);
   console.log('contest', {
      id: contest.id,
      title: contest.title,
      contest_date: contest.contest_date,
      matchMode: explicitIds ? 'explicit_event_ids' : 'sports_day',
      event_sport_id: contest.event_sport_id,
      event_league_id: contest.event_league_id,
      event_id: contest.event_id,
      sportsDayStart: new Date(bounds.start).toISOString(),
      sportsDayEnd: new Date(bounds.end).toISOString(),
      eventsInTree: eventByKey.size,
   });
   console.log('open bets', {
      total: allOpen.length,
      singles: singles.length,
      parlays: allOpen.length - singles.length,
   });

   for (const row of singles) {
      const m = row.data.marketId.eventId;
      const key = `${m.sport}:${m.league}:${m.event}`;
      const rejection = explainSingleRejection(row, contest, eventByKey);
      const eventMatch = explainContestEventMatch(row, contest, eventByKey);
      const odds = filledOddsScaled(row.data.amount, row.data.payout);
      console.log(rejection ? '✗ single' : '✓ single', {
         address: row.address,
         betId: row.data.betId.toString(),
         amountBaseUnits: row.data.amount.toString(),
         amountUsdc: `${Number(row.data.amount) / 1e6}`,
         oddsScaled: odds.toString(),
         result: betResultLabel(row.data.result),
         eventKey: key,
         rejection: rejection ?? 'qualifies',
         ...(eventMatch.ok
            ? { eventMatchMode: eventMatch.mode }
            : { eventMatchDetail: eventMatch.detail }),
      });
   }

   console.log('picked', picked ?? null);
   console.groupEnd();
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
   options?: { debug?: boolean; allOpenForDebug?: readonly { kind: string }[] },
): QualifyingOpenBet | null {
   const eventByKey = buildEventIndex(eventTree);
   const qualifying: QualifyingOpenBet[] = [];

   for (const row of rows) {
      if (explainSingleRejection(row, contest, eventByKey) != null) {
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

   const picked =
      qualifying.length === 0
         ? null
         : qualifying.reduce((best, cur) => (compareQualifyingBets(cur, best) > 0 ? cur : best));

   if (options?.debug && options.allOpenForDebug) {
      logEligibleDebug(contest, options.allOpenForDebug, rows, eventByKey, picked);
   }

   return picked;
}

export async function resolveQualifyingOpenBet(params: {
   rpc: Rpc<SolanaRpcApi>;
   userAddress: string;
   contest: ApiPredictionContest;
   eventTree: UiGroupedSport[];
}): Promise<QualifyingOpenBet | null> {
   const open = await fetchOpenWalletBets(params.rpc, params.userAddress);
   const singles = open.filter((r): r is WalletSingleRow => r.kind === 'single');
   const debug = eligibleDebugEnabled();
   if (debug) {
      console.log(`${LOG_PREFIX} wallet`, params.userAddress);
   }
   return pickLargestQualifyingOpenBet(singles, params.contest, params.eventTree, {
      debug,
      allOpenForDebug: open,
   });
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
