import { fetchEventsGrouped } from "../../api/localDb";
import { getCloseNettingAccountIx, getEventGameState, getEventStatePda, getMmMarketDataPda, getNettingPda, ODDS_SCALE, type EventId, type MarketId } from "spamm-aggregator-sdk";
import { getCloseEventIx, getCloseMarketIx, getInitEventIx, getInitMarketIx, getUpdateEventStateIx, getUpdateOracleIx, MARKET_MAKER_PROGRAM_ID } from "spamm-market-maker-sdk";
import { deleteEvent, fetchOnchainEventAccounts, fetchStartedEvents, initMmDb, markEventStateOnchain, markMarketsOnchain, resetEventOnchain, trackEvent, type TrackedEvent } from "./mmDb";
import { createRpcClients, logSolanaError, sendAndConfirmInstructionGroups, sendAndConfirmInstructions, withRpcRetry, type RpcClients } from "../../aggregator/client/txSendV1";
import { loadKeypairSignerFromJsonFile } from "../client/utils";
import type { ESPNOdds } from "../../api/types";
import type { Instruction } from "@solana/instructions";
import { address, type Address, type KeyPairSigner } from "@solana/kit";
import { getProps } from "../../api/playerProps";
import path from "node:path";
import { fileURLToPath } from "node:url";

// read the db (instead of fetching from the api)
// check if event exists onchain, if not, create it
// check if markets exist onchain, if not, create them
// update the market odds onchain

function sleep(ms: number): Promise<void> {
   return new Promise((resolve) => setTimeout(resolve, ms));
}

const CYCLE_MS = 1000 * 60 * 5;
const GET_MULTIPLE_ACCOUNTS_LIMIT = 100;
const KEYPAIR_PATH = path.join(
   path.dirname(fileURLToPath(import.meta.url)),
   "../client/admin_keypair.json",
);

let ADMIN_SIGNER!: KeyPairSigner;

async function loadAdminSigner(): Promise<void> {
   if (ADMIN_SIGNER) {
      return;
   }
   ADMIN_SIGNER = await loadKeypairSignerFromJsonFile(KEYPAIR_PATH);
}

async function tick(): Promise<void> {
   try {
      await loadAdminSigner();
      await runMarketMakerCycle();
   } catch (error) {
      console.error("runMarketMakerCycle failed:", error instanceof Error ? error.message : error);
   }
   console.log(`Next cycle in ${CYCLE_MS / 1000}s`);
   setTimeout(() => {
      void tick();
   }, CYCLE_MS);
}

function pinEventLoop(): void {
   const keepAlive = setInterval(() => {}, 60_000);
   if (typeof keepAlive.ref === "function") {
      keepAlive.ref();
   }
   process.on("beforeExit", (code) => {
      console.error(`MM backend beforeExit code=${code} — event loop empty`);
   });
   process.on("exit", (code) => {
      console.error(`MM backend exit code=${code}`);
   });
   process.on("unhandledRejection", (reason) => {
      console.error("MM backend unhandledRejection:", reason);
   });
   process.on("uncaughtException", (error) => {
      console.error("MM backend uncaughtException:", error);
   });
   process.on("SIGHUP", () => {
      console.error("MM backend received SIGHUP; ignoring");
   });
   for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
         console.error(`MM backend received ${signal}`);
         process.exit(0);
      });
   }
}

async function runMarketMakerCycle() {
   console.log("Updating market odds onchain");
   const clients = createRpcClients({
      httpUrl: process.env.SOLANA_RPC_URL,
      wsUrl: process.env.SOLANA_WS_URL,
   });
   await closeStartedEvents(clients);
   const dbEventsAndMarkets = fetchEventsGrouped(true);
   const eventCount = dbEventsAndMarkets.reduce(
      (count, sport) => count + sport.leagues.reduce((leagueCount, league) => leagueCount + league.events.length, 0),
      0,
   );
   console.log(`Processing ${eventCount} upcoming events`);
   for (const sport of dbEventsAndMarkets) {
      for (const league of sport.leagues) {
         for (const event of league.events) {
            const eventId: EventId = {
               sport: event.sport_id,
               league: event.league_id,
               event: BigInt(event.id),
            };
            const markets = event.markets ?? [];
            const marketIds: MarketId[] = markets.map((market) => ({
               eventId,
               player: BigInt(market.player_id),
               mkt: market.id,
               period: market.period_id,
               isPregame: true,
               operator: address(market.operator),
               mint: address(market.mint),
            }));
            const [eventStatePda] = await getEventStatePda(MARKET_MAKER_PROGRAM_ID, eventId);
            const marketPdas = await Promise.all(
               marketIds.map(async (marketId) => (await getMmMarketDataPda(MARKET_MAKER_PROGRAM_ID, marketId))[0]),
            );
            trackEvent(
               eventId,
               event.start_time,
               marketIds.map((marketId, i) => ({ address: marketPdas[i]!, marketId })),
            );
            let onchain: OnchainAccounts;
            try {
               onchain = await loadOnchainAccounts(clients, eventId, eventStatePda, marketPdas);
            } catch (error) {
               logSolanaError(`Failed to load onchain accounts for event ${event.id}:`, error);
               continue;
            }

            if (!onchain.eventState) {
               try {
                  const initEventIx = await getInitEventIx(
                     ADMIN_SIGNER.address, eventId, MARKET_MAKER_PROGRAM_ID
                  );
                  const setEventStateIx = await getUpdateEventStateIx(
                     ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, eventId, 1, 
                     getEventGameState("PG", 0, 0, 0, 0)
                  )
                  await sendAndConfirmInstructions(
                     [initEventIx, setEventStateIx],
                     [ADMIN_SIGNER],
                  );
                  markEventStateOnchain(eventId);
               } catch (error) {
                  logSolanaError(`Failed to create event ${event.id} onchain:`, error);
               }
            }

            let oddsData;
            try {
               oddsData = await getESPNOdds(sport.api_id, league.api_id, event.api_id);
            } catch (error) {
               console.error(error);
            }

            const ixs: Instruction[][] = [];
            const initializedMarketPdas: Address[] = [];
            let maxInstructionsPerTransaction = 64;
            for (const [i, market] of markets.entries()) {
               const marketId = marketIds[i]!;
               // init_market and update_oracle share a group: groups run in parallel, so order is only kept within one.
               const group: Instruction[] = [];
               if (!onchain.markets.has(marketPdas[i]!)) {
                  group.push(await getInitMarketIx(
                     ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, new Uint8Array(3*4)
                  ));
                  initializedMarketPdas.push(marketPdas[i]!);
                  maxInstructionsPerTransaction--;
               }
               const sequence = BigInt(Math.floor(Date.now() / 1000));
               // get the latest odds
               if (market.id === 1 || market.id === 0) {
                  const winOdds = oddsData?.win;
                  if (winOdds) {
                     const odds0 = scaleOdds(winOdds[0]);
                     const odds1 = scaleOdds(winOdds[1]);
                     const odds2 = winOdds[2] ? scaleOdds(winOdds[2]) : undefined;
                     // console.log(market.id, odds0, odds1, odds2);
                     group.push(await getUpdateOracleIx(
                        ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                        sequence, 
                        odds0, odds1, odds2
                     ));
                  }
               } else if ( // spread markets
                  (market.id > 100 && market.id < 299) ||
                  (market.id > 300 && market.id < 499)
               ) {
                  const spreadOdds = oddsData?.spread;
                  if (spreadOdds && spreadOdds.odds) {
                     // need to make sure the line is the same as the market line
                     let apiMkt = market.sport_id === 1 ? 400 : 200;
                     apiMkt += spreadOdds.line * (sport.id === 1 ? 4 : 2);
                     if (apiMkt !== market.id) {
                        // set null odds onchain
                        group.push(await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence, 
                           0n, 0n, 0n
                        ));
                     } else {
                        // update the onchain odds
                        const odds0 = scaleOdds(spreadOdds.odds[0]);
                        const odds1 = scaleOdds(spreadOdds.odds[1]);
                        // console.log(market.id, odds0, odds1);
                        group.push(await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence, 
                           odds0, odds1, undefined
                        ));
                     }
                  }
               } else if ( // total markets
                  (market.id > 50 && market.id < 99) ||
                  (market.id > 1000 && market.id < 1999)
               ) {
                  const totalOdds = oddsData?.total;
                  if (totalOdds && totalOdds.odds) {
                     // need to make sure the line is the same as the market line
                     let apiMkt = market.sport_id === 1 ? 50 : 1000;
                     apiMkt += totalOdds.line * (sport.id === 1 ? 4 : 2);
                     if (apiMkt !== market.id) {
                        // set null odds onchain
                        group.push(await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence, 
                           0n, 0n, 0n
                        ));
                     } else {
                        // update the onchain odds
                        const odds0 = scaleOdds(totalOdds.odds[0]);
                        const odds1 = scaleOdds(totalOdds.odds[1]);
                        // console.log(market.id, odds0, odds1);
                        group.push(await getUpdateOracleIx(
                           ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                           sequence,
                           odds0, odds1, undefined
                        ));
                     }
                  }
               } else if (market.id > 11000) {
                  const propsOdds = oddsData?.props;
                  if (propsOdds) {
                     const thisProp = propsOdds.find(prop => prop.mktId === market.id && prop.athleteId === market.player_id);
                     if (thisProp) {
                        if (thisProp.odds[0]) {
                           const odds0 = scaleOdds(thisProp.odds[0]);
                           let odds1 = 0n;
                           if (thisProp.odds[1]) {
                              odds1 = scaleOdds(thisProp.odds[1]);
                           }
                           group.push(await getUpdateOracleIx(
                              ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId, 
                              sequence, odds0, odds1, undefined
                           ));
                        }
                     }
                  }
               }
               if (group.length > 0) {
                  ixs.push(group);
               }
            }
            // send the ixs
            if (ixs.length > 0) {
               try {
                  const txResult = await sendAndConfirmInstructionGroups(
                     clients, 
                     ixs, 
                     [ADMIN_SIGNER], 
                     {maxInstructionsPerTransaction: Math.max(maxInstructionsPerTransaction, 32)}
                  );
                  console.log("Markets updated onchain", eventId, txResult);
               } catch (error) {
                  logSolanaError(`Failed to update markets for event ${event.id}:`, error);
                  // Re-verify this event's accounts against chain next cycle.
                  resetEventOnchain(eventId);
               }
               if (initializedMarketPdas.length > 0) {
                  try {
                     const created = await findExistingAccounts(clients, initializedMarketPdas);
                     markMarketsOnchain([...created]);
                  } catch (error) {
                     logSolanaError(`Failed to verify new markets for event ${event.id}:`, error);
                  }
               }
            }
            await sleep(200);
         }
      }
   }
   console.log("All market odds updated onchain");
}

async function getESPNOdds(sport: string, league: string, event: string): Promise<{
   win: [number, number, number] | [number, number] | null,
   spread: {line: number, odds: [number, number] | null} | null,
   total: {line: number, odds: [number, number] | null} | null,
   props: {mktId: number, athleteId: number, line: number | null, odds: number[]}[] | null,
}> {
   const url = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${event}/competitions/${event}/odds`
   const response = await fetch(url);
   const linesData = await response.json() as ESPNOdds;

   // const propsData = await getProps(sport, league, event);
   const propsData = null;

   let win = null;
   let spread = null;
   let total = null;
   let props = null;
   if (linesData.error) {
      return {win, spread, total, props};
   }

   try {
      const d = linesData.items[0];
      if (!d) {
         return {win, spread, total, props};
      }

      const homeOdds = d.homeTeamOdds.current.moneyLine.decimal;
      const awayOdds = d.awayTeamOdds.current.moneyLine.decimal;
      const drawOdds = d.current.draw?.decimal;
      if (homeOdds && awayOdds && drawOdds) {
         win = revigOdds([homeOdds, awayOdds, drawOdds]) as [number, number, number];
      } else if (homeOdds && awayOdds) {
         win = revigOdds([homeOdds, awayOdds]) as [number, number];
      }

      const spreadLine = d.spread;
      const spreadHomeOdds = d.homeTeamOdds.current.spread.decimal;
      const spreadAwayOdds = d.awayTeamOdds.current.spread.decimal;
      if (spreadLine && spreadHomeOdds && spreadAwayOdds) {
         spread = {line: spreadLine, odds: revigOdds([spreadHomeOdds, spreadAwayOdds]) as [number, number]};
      }

      const totalLine = d.overUnder;
      const totalOverOdds = d.current.over.decimal;
      const totalUnderOdds = d.current.under.decimal;
      if (totalLine && totalOverOdds && totalUnderOdds) {
         total = {line: totalLine, odds: revigOdds([totalOverOdds, totalUnderOdds]) as [number, number]};
      }
      return {win, spread, total, props: propsData};
   } catch (error) {
      console.error(error, linesData.items[0]!, url);
      return {win, spread, total, props: propsData};
   }
}

function scaleOdds(odds: number): bigint {
   return BigInt(Math.floor(odds * Number(ODDS_SCALE)));
}

function revigOdds(odds: number[]): number[] {
   const vig = odds.reduce((acc, curr) => acc + 1/curr, 0);
   return odds.map(odds => odds * vig / 1.05);
}
type OnchainAccounts = { eventState: boolean; markets: Set<Address> };

/** What the MM db knows exists onchain for this event, plus anything not yet known that is found onchain. */
async function loadOnchainAccounts(
   clients: RpcClients,
   eventId: EventId,
   eventStatePda: Address,
   marketPdas: readonly Address[],
): Promise<OnchainAccounts> {
   const known = fetchOnchainEventAccounts(eventId);
   const onchain: OnchainAccounts = { eventState: known.eventState, markets: new Set(known.markets) };
   const unknown = [
      ...(onchain.eventState ? [] : [eventStatePda]),
      ...marketPdas.filter((pda) => !onchain.markets.has(pda)),
   ];
   if (unknown.length === 0) {
      return onchain;
   }
   const existing = await findExistingAccounts(clients, unknown);
   if (existing.has(eventStatePda)) {
      onchain.eventState = true;
      markEventStateOnchain(eventId);
   }
   const foundMarkets = marketPdas.filter((pda) => existing.has(pda));
   markMarketsOnchain(foundMarkets);
   for (const pda of foundMarkets) {
      onchain.markets.add(pda);
   }
   return onchain;
}

async function findExistingAccounts(clients: RpcClients, addresses: Address[]): Promise<Set<Address>> {
   const existing = new Set<Address>();
   for (let i = 0; i < addresses.length; i += GET_MULTIPLE_ACCOUNTS_LIMIT) {
      const chunk = addresses.slice(i, i + GET_MULTIPLE_ACCOUNTS_LIMIT);
      const { value } = await withRpcRetry(() =>
         clients.rpc.getMultipleAccounts(chunk, {
            encoding: "base64",
            dataSlice: { offset: 0, length: 0 },
         }).send(),
      );
      value.forEach((account, j) => {
         if (account) {
            existing.add(chunk[j]!);
         }
      });
   }
   return existing;
}

async function closeStartedEvents(clients: RpcClients) {
   const events = fetchStartedEvents(Date.now());
   console.log(`Checking ${events.length} started events for open accounts`);
   for (const event of events) {
      try {
         await closeEventAndMarkets(event, clients);
      } catch (error) {
         logSolanaError(`Failed to close event ${event.eventId.event} onchain:`, error);
      }
   }
}

/** Close every account for a started event; its MM db rows are deleted once none remain onchain. */
async function closeEventAndMarkets({ eventId, marketIds }: TrackedEvent, clients: RpcClients) {
   const nettingScopes = new Map<string, { operator: Address; mint: Address }>();
   for (const { operator, mint } of marketIds) {
      nettingScopes.set(`${operator}:${mint}`, { operator, mint });
   }
   const scopes = [...nettingScopes.values()];

   const [eventStatePda] = await getEventStatePda(MARKET_MAKER_PROGRAM_ID, eventId);
   const marketPdas = await Promise.all(
      marketIds.map(async (marketId) => (await getMmMarketDataPda(MARKET_MAKER_PROGRAM_ID, marketId))[0]),
   );
   const nettingPdas = await Promise.all(
      scopes.map(async ({ operator, mint }) => (await getNettingPda(MARKET_MAKER_PROGRAM_ID, eventId, operator, mint))[0]),
   );
   const allPdas = [eventStatePda, ...marketPdas, ...nettingPdas];
   const existing = await findExistingAccounts(clients, allPdas);
   if (existing.size === 0) {
      deleteEvent(eventId);
      return;
   }

   const ixs: Instruction[][] = [];
   for (const [i, marketId] of marketIds.entries()) {
      if (existing.has(marketPdas[i]!)) {
         ixs.push([await getCloseMarketIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, marketId)]);
      }
   }
   if (existing.has(eventStatePda)) {
      ixs.push([await getCloseEventIx(ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID, eventId)]);
   }
   if (ixs.length > 0) {
      const txResult = await sendAndConfirmInstructionGroups(clients, ixs, [ADMIN_SIGNER]);
      console.log(`Event ${eventId.event}: closed ${ixs.length} accounts onchain`, txResult);
   }

   // Netting closes fail while open profit remains, so they must not block the closes above.
   for (const [i, { operator, mint }] of scopes.entries()) {
      if (!existing.has(nettingPdas[i]!)) {
         continue;
      }
      try {
         const closeNettingIx = await getCloseNettingAccountIx(
            eventId, operator, mint, ADMIN_SIGNER.address, MARKET_MAKER_PROGRAM_ID,
         );
         const txResult = await sendAndConfirmInstructions([closeNettingIx], [ADMIN_SIGNER]);
         console.log(`Event ${eventId.event}: closed netting account for ${operator} / ${mint}`, txResult);
      } catch (error) {
         logSolanaError(`Event ${eventId.event}: netting account for ${operator} / ${mint} not closed:`, error);
      }
   }

   // Rows stay (and closing is retried next cycle) until nothing for the event is left onchain.
   if ((await findExistingAccounts(clients, allPdas)).size === 0) {
      deleteEvent(eventId);
   }
}

function main() {
   console.log("MM backend starting (5 min cycle)");
   initMmDb();
   pinEventLoop();
   void tick();
}

if (import.meta.main) {
   main();
}
