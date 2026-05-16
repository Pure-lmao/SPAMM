

export type Sport = {
   id: number;
   name: string;
   api_id: string;
};

export type League = {
   id: number;
   sport_id: number;
   name: string;
   abbr: string;
   country_code: string;
   country_name: string;
   country_rank: number;
   variation: number;
   api_id: string;
};

export type Event = {
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
};

export type Market = {
   id: number;
   event_id: number;
   league_id: number;
   sport_id: number;
   last_odds: string;
   last_update: number;
   mkt_string: string;
};

/** One event inside `GroupedLeague.events`; `markets` set when fetched with `withMarkets`. */
export type GroupedEvent = Event & { markets?: Market[] };

export type GroupedLeague = {
   id: number;
   sport_id: number;
   name: string;
   abbr: string;
   country_name: string;
   country_code: string;
   country_rank: number;
   api_id: string;
   events: GroupedEvent[];
};

/** One sport branch for UI: sport → leagues → events → optional markets. */
export type GroupedSport = {
   id: number;
   /** Display label; same as `name` from DB. */
   sport: string;
   name: string;
   api_id: string;
   leagues: GroupedLeague[];
};

export type ESPNEvent = {
   id: string;
   uid: string;
   date: string;
   name: string;
   shortName: string;
   season: any;
   competitions: ESPNCompetition[];
   links: any;
   status: {
      displayClock: string;
      period: number;
      clock: number;
      type: any;
   }
};

export type ESPNCompetition = {
   id: string;
   uid: string;
   date: string; //ISO String
   attendance: number;
   type: {id: string; abbreviation: string};
   timeValid: boolean;
   neutralSite: boolean;
   conferenceCompetition: boolean;
   playByPlayAvailable: boolean;
   recent: boolean;
   wasSuspended: boolean;
   venue: {id: string; fullName: string; address: {city: string; state: string; country: string}, indoor: boolean};
   competitors: ESPNCompetitor[];
   notes: any;
   status: {
      displayClock: string;
      period: number;
      clock: number;
      type: any;
   };
   startDate: string;   
};

export type ESPNCompetitor = {
   id: string;
   uid: string;
   type: string;
   order: number;
   homeAway: string;
   winner: boolean;
   team: ESPNTeam;
   score: string;
};

export type ESPNTeam = {
   id: string;
   uid: string;
   location: string;
   name: string;
   abbreviation: string;
   displayName: string;
   shortDisplayName: string;
   color: string;
   alternateColor: string;
   isActive: boolean;
   links: any;
   logo: string;
};

export type ESPNOdds = {
   count: number;
   pageIndex: number;
   pageSize: number;
   pageCount: number;
   items: {
      provider: any;
      details: string;
      overUnder: number;
      spread: number;
      initialSpread: number;
      initialOverUnder: number;
      price: number;
      overOdds: number;
      underOdds: number;
      awayTeamOdds: any;
      homeTeamOdds: any;
      links: any;
      moneylineWinner: false | string;
      spreadWinner: false | string;
      open: any;
      close: any;
      current: any;
   }[]
}