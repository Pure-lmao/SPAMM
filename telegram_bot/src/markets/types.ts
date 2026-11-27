export type UiMarket = {
   id: number;
   event_id: number;
   league_id: number;
   sport_id: number;
   period_id: number;
   player_id: number;
   player_name: string;
   line_value: number | null;
   last_odds: string;
   mkt_string: string;
   operator: string;
   mint: string;
};

export type UiEvent = {
   id: number;
   league_id: number;
   sport_id: number;
   home_name: string;
   away_name: string;
   event_name: string;
   start_time: number;
   markets?: UiMarket[];
};

export type UiLeague = {
   id: number;
   sport_id: number;
   name: string;
   events: UiEvent[];
};

export type UiSport = {
   id: number;
   sport: string;
   name: string;
   leagues: UiLeague[];
};

export type EventRef = {
   sportId: number;
   leagueId: number;
   eventId: number;
};
