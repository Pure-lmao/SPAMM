/** Which column the user clicked in the lines grid. */
export type BetColumn = "main" | "spread" | "total";

export type MarketRow = {
   id: number;
   mkt_string: string;
   period_id: number;
   line_value: number | null;
};

/** Input when toggling a selection from an odds cell. */
export type BetSlipSelectionInput = {
   eventTitle: string;
   marketLabel: string;
   displayedDecimalOdds: number | null;
   eventId: number;
   leagueId: number;
   sportApiId: number;
   marketWireId: number;
   periodId: number;
   column: BetColumn;
   outcomeIndex: number;
   mktString: string;
};

/** One leg stored in the bet slip (includes stable `id`). */
export type BetSlipSelection = BetSlipSelectionInput & {
   id: string;
};

/** @deprecated Use {@link BetSlipSelectionInput}. */
export type BetModalOpenContext = BetSlipSelectionInput;
