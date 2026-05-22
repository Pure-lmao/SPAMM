import { type ReactElement } from "react";
import { decimalOddsFromDb, fmtOdd, formatMarketLineDisplay } from "./oddsFormat";
import { type MarketLineSource, spreadLineDisplayForOutcome } from "./lineFromMarket";

export function OddButtons({
   values,
   className,
   onPickIndex,
   isIndexSelected,
}: {
   values: number[];
   className?: string;
   onPickIndex?: (index: number) => void;
   isIndexSelected?: (index: number) => boolean;
}): ReactElement {
   const cols = Math.max(values.length, 1);
   const gridStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } as const;
   const cls = ["odds-buttons", className].filter(Boolean).join(" ");

   return (
      <div className={cls} style={gridStyle}>
         {values.length > 0 ? (
            values.map((v, i) =>
               v === 0 ? (
                  <button key={i} type="button" className="odd-btn odd-btn--empty" disabled>
                     —
                  </button>
               ) : (
                  <button
                     key={i}
                     type="button"
                     className={["odd-btn", isIndexSelected?.(i) ? "odd-btn--selected" : ""].filter(Boolean).join(" ")}
                     onClick={() => onPickIndex?.(i)}
                  >
                     <span className="odds-value">{fmtOdd(v)}</span>
                  </button>
               ),
            )
         ) : (
            <button type="button" className="odd-btn odd-btn--empty" disabled>
               —
            </button>
         )}
      </div>
   );
}

/** Home list: no ML/1X2 — same line + odds grid as empty total (grey slot + muted dashes). */
export function EmptyMainOddsPlaceholder({ sportId }: { sportId: number }): ReactElement {
   const rowMod = sportId === 1 ? " odds-line-with-buttons--soccer" : "";
   const values = sportId === 1 ? [0, 0, 0] : [0, 0];
   return (
      <div className={`odds-line-with-buttons odds-line-with-buttons--total${rowMod}`}>
         <span className="odds-line-value odds-line-value--empty">—</span>
         <OddButtons values={values} />
      </div>
   );
}

/** Home list: no total market — line slot + O/U buttons (spread has no outer line; use empty spread markup in HomePage). */
export function EmptyTotalOddsPlaceholder({ sportId }: { sportId: number }): ReactElement {
   const rowMod = sportId === 1 ? " odds-line-with-buttons--soccer" : "";
   return (
      <div className={`odds-line-with-buttons odds-line-with-buttons--total${rowMod}`}>
         <span className="odds-line-value odds-line-value--empty">—</span>
         <OddButtons values={[0, 0]} />
      </div>
   );
}

/** Two-way markets always show two cells; missing JSON slots pad as 0 → “—”. */
function padTwoWayOdds(values: number[]): [number, number] {
   return [values[0] ?? 0, values[1] ?? 0];
}

export function LineWithOddsCell({
   line,
   values,
   sportId,
   lineKind,
   market,
   onPick,
   isIndexSelected,
}: {
   line: string;
   values: number[];
   sportId: number;
   lineKind: "spread" | "total";
   /** Required for spread: used to show home/away handicap in each paired button. */
   market?: MarketLineSource;
   onPick: (outcomeIndex: number, decimalOdds: number) => void;
   isIndexSelected?: (outcomeIndex: number) => boolean;
}): ReactElement {
   const displayLine = formatMarketLineDisplay(line, lineKind);
   const lineClass =
      sportId === 1 ? "odds-line-value odds-line-value--soccer-asian" : "odds-line-value";
   const rowMod = sportId === 1 ? " odds-line-with-buttons--soccer" : "";
   const pair = padTwoWayOdds(values);

   if (lineKind === "spread" && market != null) {
      return (
         <div
            className={`odds-line-with-buttons odds-line-with-buttons--spread odds-line-with-buttons--spread-paired${rowMod}`}
         >
            {([0, 1] as const).map((i) => {
               const lineDisp = spreadLineDisplayForOutcome(market, i);
               const noPick = pair[i] === 0 || lineDisp === "—";
               return (
                  <button
                     key={i}
                     type="button"
                     className={["odd-btn", isIndexSelected?.(i) ? "odd-btn--selected" : ""].filter(Boolean).join(" ")}
                     disabled={noPick}
                     onClick={() => onPick(i, decimalOddsFromDb(pair[i]))}
                  >
                     <span className={lineDisp === "—" ? "odd-btn__line odd-btn__line--na" : "odd-btn__line"}>
                        {lineDisp}
                     </span>
                     <span className={`odd-btn__odds odds-value${pair[i] === 0 ? " odds-value--na" : ""}`}>
                        {fmtOdd(pair[i])}
                     </span>
                  </button>
               );
            })}
         </div>
      );
   }

   const totalValues = lineKind === "total" ? pair : values;
   const totalLineUnavailable =
      lineKind === "total" && (displayLine.trim() === "—" || displayLine.trim() === "");
   const lineClassFinal = totalLineUnavailable ? `${lineClass} odds-line-value--empty` : lineClass;

   return (
      <div className={`odds-line-with-buttons odds-line-with-buttons--${lineKind}${rowMod}`}>
         <span className={lineClassFinal}>{displayLine}</span>
         <OddButtons
            values={totalValues}
            className="odds-buttons--inline"
            isIndexSelected={isIndexSelected}
            onPickIndex={(i) => {
               const v = totalValues[i]!;
               onPick(i, decimalOddsFromDb(v));
            }}
         />
      </div>
   );
}

export function MainOddsCell({
   detail,
   sportId,
   onPick,
   isIndexSelected,
}: {
   detail: { values: number[] } | null;
   sportId: number;
   onPick: (outcomeIndex: number, decimalOdds: number) => void;
   isIndexSelected?: (outcomeIndex: number) => boolean;
}): ReactElement {
   if (!detail) {
      return <EmptyMainOddsPlaceholder sportId={sportId} />;
   }
   return (
      <div className="odds-stack">
         <OddButtons
            values={detail.values}
            isIndexSelected={isIndexSelected}
            onPickIndex={(i) => {
               const v = detail.values[i]!;
               onPick(i, decimalOddsFromDb(v));
            }}
         />
      </div>
   );
}
