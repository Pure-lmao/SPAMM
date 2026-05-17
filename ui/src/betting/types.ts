/** Which column the user clicked in the lines grid. */
export type BetColumn = "main" | "spread" | "total";

export type MarketRow = {
   id: number;
   mkt_string: string;
   period_id: number;
   line_value: number | null;
};

/** Props for the bet sheet when an odds cell is opened. */
export type BetModalOpenContext = {
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
