import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { periodCaption, resolveMarketDisplay } from "spamm-aggregator-sdk";
import type { BetColumn } from "../betting/types";
import { marketDomKey, shouldShowPeriodBadge, uiMarketDisplayCtx } from "./eventMarketsDisplay";
import { lineRawForSpreadOrTotal } from "./lineFromMarket";
import { formatMarketLineDisplay, parseOdds } from "./oddsFormat";
import { oddsTableLabels } from "./oddsTableLabels";
import { clusterPlayerPropMarkets, defaultPlayerPropMarket, inferBetColumn } from "./selectors";
import type { UiMarket } from "./types";

export type PlayerPropTeams = {
   homeName: string;
   awayName: string;
};

export type PlayerPropOddHandlers = {
   sportId: number;
   teams: PlayerPropTeams;
   oddCell: (m: UiMarket, column: BetColumn, i: number, v: number) => ReactNode;
};

function ordinal(n: number): string {
   const abs = Math.abs(n);
   const mod100 = abs % 100;
   if (mod100 >= 11 && mod100 <= 13) {
      return `${n}th`;
   }
   switch (abs % 10) {
      case 1:
         return `${n}st`;
      case 2:
         return `${n}nd`;
      case 3:
         return `${n}rd`;
      default:
         return `${n}th`;
   }
}

function playerPropLineLabel(m: UiMarket, teams: PlayerPropTeams): string {
   const ctx = uiMarketDisplayCtx(m, teams);
   const resolved = resolveMarketDisplay(m.id, ctx);
   if (resolved.layout === "playerYesNo") {
      const line = resolved.line;
      if (line == null) {
         return resolved.shortName;
      }
      if (resolved.shortName === "First/Next/Last Scorer") {
         return line === 99 ? "Last" : ordinal(line);
      }
      if (resolved.shortName === "Top Place") {
         return `Top ${line}`;
      }
      return String(line);
   }
   const raw = lineRawForSpreadOrTotal({ ...m, id: m.id }, "total");
   const shown = formatMarketLineDisplay(raw, "total");
   return shown.trim() === "" ? "—" : shown;
}

function PeriodMeta({ sportId, m }: { sportId: number; m: UiMarket }): ReactElement | null {
   if (!shouldShowPeriodBadge(sportId, m)) {
      return null;
   }
   return <span className="event-market-period">{periodCaption(m.period_id)}</span>;
}

function PlayerNameCell({
   sportId,
   name,
   market,
}: {
   sportId: number;
   name: string;
   market: UiMarket;
}): ReactElement {
   return (
      <td className="event-markets-td-player">
         <div className="event-markets-player-cell">
            <span className="event-markets-player-name" title={name}>
               {name}
            </span>
            <PeriodMeta sportId={sportId} m={market} />
         </div>
      </td>
   );
}

function LinePicker({
   markets,
   selectedKey,
   onChange,
   teams,
}: {
   markets: UiMarket[];
   selectedKey: string;
   onChange: (key: string) => void;
   teams: PlayerPropTeams;
}): ReactElement {
   if (markets.length <= 1) {
      const only = markets[0];
      const shown = only != null ? playerPropLineLabel(only, teams) : "—";
      return <span className="event-markets-line-value">{shown}</span>;
   }
   return (
      <select
         className="event-markets-line-select"
         value={selectedKey}
         aria-label="Line"
         onChange={(e) => onChange(e.target.value)}
      >
         {markets.map((m) => {
            const key = marketDomKey(m);
            return (
               <option key={key} value={key}>
                  {playerPropLineLabel(m, teams)}
               </option>
            );
         })}
      </select>
   );
}

function useSelectedPlayerMarket(markets: UiMarket[]): [UiMarket, string, (key: string) => void] {
   const keys = useMemo(() => markets.map(marketDomKey).join("|"), [markets]);
   const fallback = defaultPlayerPropMarket(markets);
   const [selKey, setSelKey] = useState(() => marketDomKey(fallback));

   useEffect(() => {
      const still = markets.some((m) => marketDomKey(m) === selKey);
      if (!still) {
         setSelKey(marketDomKey(defaultPlayerPropMarket(markets)));
      }
   }, [keys, markets, selKey]);

   const selected = markets.find((m) => marketDomKey(m) === selKey) ?? fallback;
   return [selected, marketDomKey(selected), setSelKey];
}

function PlayerOverUnderRow({
   cluster,
   handlers,
}: {
   cluster: ReturnType<typeof clusterPlayerPropMarkets>[number];
   handlers: PlayerPropOddHandlers;
}): ReactElement | null {
   const { sportId, teams, oddCell } = handlers;
   const [selected, selKey, setSelKey] = useSelectedPlayerMarket(cluster.markets);
   const values = parseOdds(selected.last_odds);
   const column = inferBetColumn(selected.mkt_string, selected.id);
   return (
      <tr>
         <PlayerNameCell sportId={sportId} name={cluster.playerName} market={selected} />
         {oddCell(selected, column, 0, values[0] ?? 0)}
         <td className="event-markets-td-line event-markets-td-line--mid">
            <LinePicker markets={cluster.markets} selectedKey={selKey} onChange={setSelKey} teams={teams} />
         </td>
         {oddCell(selected, column, 1, values[1] ?? 0)}
      </tr>
   );
}

function PlayerYesNoRow({
   cluster,
   handlers,
   showLineCol,
}: {
   cluster: ReturnType<typeof clusterPlayerPropMarkets>[number];
   handlers: PlayerPropOddHandlers;
   showLineCol: boolean;
}): ReactElement {
   const { sportId, teams, oddCell } = handlers;
   const [selected, selKey, setSelKey] = useSelectedPlayerMarket(cluster.markets);
   const values = parseOdds(selected.last_odds);
   const column = inferBetColumn(selected.mkt_string, selected.id);
   return (
      <tr>
         <PlayerNameCell sportId={sportId} name={cluster.playerName} market={selected} />
         {showLineCol ? (
            <td className="event-markets-td-line event-markets-td-line--mid">
               <LinePicker markets={cluster.markets} selectedKey={selKey} onChange={setSelKey} teams={teams} />
            </td>
         ) : null}
         {[0, 1].map((i) => oddCell(selected, column, i, values[i] ?? 0))}
      </tr>
   );
}

export function PlayerOverUnderTable({
   title,
   tooltip,
   rows,
   handlers,
}: {
   title: string;
   tooltip: string;
   rows: UiMarket[];
   handlers: PlayerPropOddHandlers;
}): ReactElement {
   const clusters = clusterPlayerPropMarkets(rows);
   return (
      <table className="event-markets-table event-markets-table--player-ou">
         <caption className="event-market-section-caption" title={tooltip}>
            {title}
         </caption>
         <thead>
            <tr>
               <th className="event-markets-th-player">Player</th>
               <th>{oddsTableLabels.over}</th>
               <th className="event-markets-th-line">Line</th>
               <th>{oddsTableLabels.under}</th>
            </tr>
         </thead>
         <tbody>
            {clusters.map((c) => (
               <PlayerOverUnderRow key={c.playerKey} cluster={c} handlers={handlers} />
            ))}
         </tbody>
      </table>
   );
}

export function PlayerYesNoTable({
   title,
   tooltip,
   rows,
   handlers,
}: {
   title: string;
   tooltip: string;
   rows: UiMarket[];
   handlers: PlayerPropOddHandlers;
}): ReactElement {
   const clusters = clusterPlayerPropMarkets(rows);
   const anyMulti = clusters.some((c) => c.markets.length > 1);
   return (
      <table className="event-markets-table event-markets-table--player-yn">
         <caption className="event-market-section-caption" title={tooltip}>
            {title}
         </caption>
         <thead>
            <tr>
               <th className="event-markets-th-player">Player</th>
               {anyMulti ? <th className="event-markets-th-line">Line</th> : null}
               <th>{oddsTableLabels.yes}</th>
               <th>{oddsTableLabels.no}</th>
            </tr>
         </thead>
         <tbody>
            {clusters.map((c) => (
               <PlayerYesNoRow key={c.playerKey} cluster={c} handlers={handlers} showLineCol={anyMulti} />
            ))}
         </tbody>
      </table>
   );
}
