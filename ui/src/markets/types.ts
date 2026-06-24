/** Mirrors API `Market` for UI bundles. */
export type UiMarket = {
   id: number;
   event_id: number;
   league_id: number;
   sport_id: number;
   period_id: number;
   line_value: number | null;
   last_odds: string;
   last_update: number;
   mkt_string: string;
};

export type UiGroupedEvent = {
   id: number;
   league_id: number;
   sport_id: number;
   home_name: string;
   away_name: string;
   event_name: string;
   start_time: number;
   api_id: string;
   home_score: number | null;
   away_score: number | null;
   markets?: UiMarket[];
};

export type UiGroupedLeague = {
   id: number;
   sport_id: number;
   name: string;
   abbr: string;
   country_name: string;
   country_code: string;
   country_rank: number;
   api_id: string;
   events: UiGroupedEvent[];
};

export type UiGroupedSport = {
   id: number;
   sport: string;
   name: string;
   api_id: string;
   leagues: UiGroupedLeague[];
};

export type UiPromotionalMarket = {
   id: number;
   title: string;
   description: string;
   sport_id: number;
   league_id: number;
   event_id: number;
   mkt_id: number;
   period_id: number;
   yes_label: string;
   last_odds: string;
   status: "open" | "settled";
   winning_side: number | null;
   related_events: {
      sport_id: number;
      league_id: number;
      event_id: number;
      event_name?: string;
   }[];
   closes_at: number | null;
   created_at: number;
   settled_at: number | null;
   settled_notes: string | null;
};
